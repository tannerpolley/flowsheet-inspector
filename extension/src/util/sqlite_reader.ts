/**
 * Centralised SQLite reader for the IDAES report database.
 *
 * Uses node-sqlite3-wasm (pure WebAssembly) so the user never needs the
 * sqlite3 CLI installed, and there are no native-module ABI issues across
 * different VS Code / Electron / Node.js versions.
 * All queries open the file with readOnly:true so concurrent Python writes
 * never cause locking errors.
 */
import { Database } from 'node-sqlite3-wasm';
import * as fs from 'fs';
import * as path from 'path';
import { getIdaesDbPath } from './platform_config';

// ── Types ────────────────────────────────────────────────────────────────────

export interface IHistoryRow {
    id: number;
    created: number;
    name: string;
    filename: string;
    status: number;
    rawError: string | null;
    tags: string | null;
}

/**
 * One per-step status row from the `status` table, written live by fi-run as
 * each flowsheet step finishes.
 *
 * `errcode` reflects whether the step's *code* raised (0 = no exception,
 * non-zero = exception). `solve_ok` is separate and reflects whether the
 * *solver* actually found a solution on a solve step:
 *   - null  → not a solve step, or solver status unknown (never an error)
 *   - 1     → solver reached an optimal solution
 *   - 0     → solve step ran without raising but did NOT find a solution
 *             (e.g. infeasible, max iterations exceeded) — still a failure
 *
 * A step is therefore "failed" when `errcode !== 0` OR `solve_ok === 0`.
 */
export interface IStepStatusRow {
    step_num: number;
    step_name: string;
    errcode: number;
    errmsg: string;
    solve_ok: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * node-sqlite3-wasm returns TEXT columns as string on most platforms but can
 * return Uint8Array when the column affinity is BLOB.  This converts either
 * to a plain JS string so downstream code always gets a string.
 */
function toStr(value: unknown): string {
    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('utf-8');
    }
    return String(value ?? '');
}

/** Same as toStr but preserves null/undefined as null. */
function toStrNullable(value: unknown): string | null {
    if (value == null) { return null; }
    return toStr(value);
}

/**
 * Python's json.dumps() can emit bare Infinity, -Infinity, and NaN which are
 * not valid JSON.  Replace them with null before calling JSON.parse.
 */
export function sanitizeJsonString(raw: string): string {
    return raw
        .replace(/:\s*-Infinity/g, ': null')
        .replace(/:\s*Infinity/g, ': null')
        .replace(/:\s*NaN/g, ': null');
}

/**
 * Returns true when the reports table has the modern schema columns
 * (run_status, run_exception).  Legacy schema only has status.
 */
function hasModernSchema(db: Database): boolean {
    const cols = db.all('PRAGMA table_info(reports)') as { name: string }[];
    return cols.some((c) => c.name === 'run_status');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the last 100 history rows from the IDAES report database.
 *
 * Handles both the modern schema (run_status / run_exception columns) and the
 * legacy schema (status column) transparently via a PRAGMA column check.
 * Returns an empty array when the database file does not exist yet.
 *
 * @returns Array of history rows ordered newest-first, or [] if DB is absent.
 * @throws  If the database exists but the reports table is missing or
 *          the query otherwise fails.
 */
export function queryHistory(): IHistoryRow[] {
    const dbPath = getIdaesDbPath();
    if (!fs.existsSync(dbPath)) {
        return [];
    }

    const db = new Database(dbPath, { readOnly: true });
    try {
        const sql = hasModernSchema(db)
            ? `SELECT id, created, name, filename,
                   CASE WHEN run_status = 1 THEN 1 ELSE 0 END AS status,
                   COALESCE(NULLIF(run_exception, ''), SUBSTR(report, INSTR(report, 'EXIT:'), 100)) AS rawError,
                   tags
               FROM reports ORDER BY id DESC LIMIT 100`
            : `SELECT id, created, name, filename,
                   status,
                   SUBSTR(report, INSTR(report, 'EXIT:'), 100) AS rawError,
                   tags
               FROM reports ORDER BY id DESC LIMIT 100`;
        return (db.all(sql) as unknown as Record<string, unknown>[]).map((r) => ({
            id: Number(r.id),
            created: Number(r.created),
            name: toStr(r.name),
            filename: toStr(r.filename),
            status: Number(r.status ?? 0),
            rawError: toStrNullable(r.rawError),
            tags: toStrNullable(r.tags),
        }));
    } finally {
        db.close();
    }
}

/**
 * Reads and parses the JSON report blob for a single run by its row ID.
 *
 * @param id  The primary-key ID of the reports row to fetch.
 * @returns   The parsed report object, or null if no row with that ID exists.
 * @throws    If the database cannot be opened or JSON parsing fails.
 */
export function queryReportById(id: number): unknown {
    const dbPath = getIdaesDbPath();
    const db = new Database(dbPath, { readOnly: true });
    try {
        const row = db.get('SELECT report FROM reports WHERE id = ?', id) as { report: unknown } | null;
        if (!row) {
            return null;
        }
        return JSON.parse(sanitizeJsonString(toStr(row.report)));
    } finally {
        db.close();
    }
}

/**
 * Reads the source flowsheet file path recorded for a single run by its row ID.
 *
 * Used when loading a historical run, so UI surfaces (e.g. the results panel
 * tab title) can show the file that run actually belongs to rather than
 * whatever file happens to be active in the editor.
 *
 * @param id  The primary-key ID of the reports row to fetch.
 * @returns   The stored flowsheet file path (`filedir` joined with `filename`),
 *            or '' if the DB/row is absent.
 */
export function queryReportFilePathById(id: number): string {
    const dbPath = getIdaesDbPath();
    if (!fs.existsSync(dbPath)) {
        return '';
    }
    const db = new Database(dbPath, { readOnly: true });
    try {
        const row = db.get('SELECT filedir, filename FROM reports WHERE id = ?', id) as { filedir: unknown; filename: unknown } | null;
        return row ? path.join(toStr(row.filedir), toStr(row.filename)) : '';
    } catch {
        // reports table may not exist yet on a brand-new DB.
        return '';
    } finally {
        db.close();
    }
}

/**
 * Reads the highest report id currently in the database.
 *
 * Captured as a baseline just before fi-run starts so the step-status poller
 * can distinguish the in-progress report row (created by fi-run up front) from
 * previous runs. Returns 0 when the database or reports table does not exist
 * yet (first ever run).
 *
 * @returns The current MAX(id) of the reports table, or 0 if unavailable.
 */
export function queryMaxReportId(): number {
    const dbPath = getIdaesDbPath();
    if (!fs.existsSync(dbPath)) {
        return 0;
    }
    let db: Database | undefined;
    try {
        db = new Database(dbPath, { readOnly: true });
        const row = db.get('SELECT COALESCE(MAX(id), 0) AS maxId FROM reports') as { maxId: unknown } | null;
        return row ? Number(row.maxId) : 0;
    } catch (e) {
        // reports table may not exist yet on a brand-new DB, or the open/read
        // raced a concurrent write.
        console.warn(`queryMaxReportId failed (non-fatal): ${e instanceof Error ? e.message : e}`);
        return 0;
    } finally {
        db?.close();
    }
}

/**
 * Reads the per-step status rows for the currently in-progress (or just
 * finished) run — the one whose report id is greater than `baselineId`.
 *
 * fi-run writes one `status` row per step as it completes, so this reveals in
 * real time which steps have finished and whether each succeeded or failed.
 * Only rows for a report id greater than the baseline are returned, so stale
 * rows from the previous run are never included. Returns an empty array when
 * the DB or the `status` table (older, un-migrated schema) is absent.
 *
 * @param baselineId  MAX(id) of reports captured before fi-run launched.
 * @returns Step status rows ordered by step number, or [] if none/unavailable.
 */
export function queryStepStatuses(baselineId: number): IStepStatusRow[] {
    // The in-progress run is the one with the highest report id greater than
    // the baseline; scope the status rows to that run.
    return readStatusRows('run_id = (SELECT MAX(id) FROM reports WHERE id > ?)', baselineId);
}

/**
 * Reads the per-step status rows for a specific past run by its report id.
 *
 * Used when loading a historical run from the History view, so the tree
 * view can show that run's per-step icons (the `status` table's `run_id`
 * equals the report row id).
 *
 * @param runId  The report row id of the run to load.
 * @returns Step status rows ordered by step number, or [] if none/unavailable.
 */
export function queryStepStatusesByRunId(runId: number): IStepStatusRow[] {
    return readStatusRows('run_id = ?', runId);
}

/**
 * Shared reader for the `status` table: applies the given WHERE clause and
 * bind value, tolerating a missing `solve_ok` column (older schema) and a
 * missing `status` table entirely.
 *
 * @param whereClause  SQL WHERE condition on the `status` table, using `?` for
 *   the single bind value.
 * @param bindValue    Value bound to the `?` placeholder in `whereClause`.
 * @returns Mapped step status rows ordered by step number, or [] on any error.
 */
function readStatusRows(whereClause: string, bindValue: number): IStepStatusRow[] {
    const dbPath = getIdaesDbPath();
    if (!fs.existsSync(dbPath)) {
        return [];
    }
    let db: Database | undefined;
    try {
        // Open inside the try: on Windows the open itself can fail while the
        // fi-run process holds the file, and a throw here must not escape the
        // polling interval.
        db = new Database(dbPath, { readOnly: true });
        // `solve_ok` was added to the status table in a later fi-run version.
        // Select it only when present so older, un-migrated databases don't
        // fail the query with "no such column"; treat it as NULL otherwise.
        const cols = db.all('PRAGMA table_info(status)') as { name: string }[];
        const solveOkExpr = cols.some((c) => c.name === 'solve_ok') ? 'solve_ok' : 'NULL AS solve_ok';
        const rows = db.all(
            `SELECT step_num, step_name, errcode, errmsg, ${solveOkExpr} FROM status
             WHERE ${whereClause}
             ORDER BY step_num`,
            bindValue,
        ) as unknown as Record<string, unknown>[];
        return rows.map((r) => ({
            step_num: Number(r.step_num),
            step_name: toStr(r.step_name),
            errcode: Number(r.errcode ?? 0),
            errmsg: toStr(r.errmsg),
            // Preserve null (unknown / non-solve step); only 0 and 1 are meaningful.
            solve_ok: r.solve_ok == null ? null : Number(r.solve_ok),
        }));
    } catch (e) {
        // `status` table may not exist (DB created by an older schema), or the
        // read raced a write from fi-run. Non-fatal, but log it so a platform
        // where this *always* fails (e.g. Windows locking issues) is visible
        // in the extension host console instead of silently showing no icons.
        console.warn(`readStatusRows failed (non-fatal): ${e instanceof Error ? e.message : e}`);
        return [];
    } finally {
        db?.close();
    }
}

/**
 * Checks whether the report database contains the `status` table at all.
 *
 * The `status` table is written by newer versions of flowsheet-inspector-lib
 * (one row per completed flowsheet step). Older lib versions never create it,
 * in which case per-step icons can never appear — this lets callers surface a
 * precise "upgrade the lib" message instead of failing silently.
 *
 * @returns True if the `status` table exists in the database; false when the
 *   database file is absent, unreadable, or the table is missing.
 */
export function queryStatusTableExists(): boolean {
    const dbPath = getIdaesDbPath();
    if (!fs.existsSync(dbPath)) {
        return false;
    }
    let db: Database | undefined;
    try {
        db = new Database(dbPath, { readOnly: true });
        const row = db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'status'");
        return !!row;
    } catch (e) {
        console.warn(`queryStatusTableExists failed (non-fatal): ${e instanceof Error ? e.message : e}`);
        return false;
    } finally {
        db?.close();
    }
}

/**
 * Reads the overall run exception (type + traceback) recorded for a run.
 *
 * The `status` table stores only `str(exception)` per step, which is empty for
 * exceptions with no message (e.g. a bare `assert`). The reports table's
 * `run_exception` column holds the full, human-readable traceback for the run
 * that failed, so it is used to give the step-failure message real detail.
 *
 * @param runId  The report row id of the run.
 * @returns The run exception text, or '' if none / unavailable (e.g. a legacy
 *   schema without the `run_exception` column).
 */
export function queryRunException(runId: number): string {
    const dbPath = getIdaesDbPath();
    if (!fs.existsSync(dbPath)) {
        return '';
    }
    let db: Database | undefined;
    try {
        db = new Database(dbPath, { readOnly: true });
        const row = db.get('SELECT run_exception FROM reports WHERE id = ?', runId) as { run_exception: unknown } | null;
        return row ? toStr(row.run_exception).trim() : '';
    } catch (e) {
        // Legacy schema without a run_exception column, or a read race.
        console.warn(`queryRunException failed (non-fatal): ${e instanceof Error ? e.message : e}`);
        return '';
    } finally {
        db?.close();
    }
}

/**
 * Reads and parses the most recently inserted JSON report blob.
 *
 * @returns The parsed report object, or null if the table is empty.
 * @throws  If the database cannot be opened or JSON parsing fails.
 */
export function queryLatestReport(): unknown {
    const dbPath = getIdaesDbPath();
    const db = new Database(dbPath, { readOnly: true });
    try {
        const row = db.get('SELECT report FROM reports ORDER BY id DESC LIMIT 1') as { report: unknown } | null;
        if (!row) {
            return null;
        }
        return JSON.parse(sanitizeJsonString(toStr(row.report)));
    } finally {
        db.close();
    }
}

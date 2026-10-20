import { useContext, useRef } from 'react';
import { AppContext } from '../context';
import Table from '../util/table';
import type { TableCellValue } from '../util/table';
import type {
    FlowsheetStreamTable,
    UnitStreamTable,
    UnitReport,
} from '../interface/flowsheet_result_interface';
import css from '../css/stream_table.module.css'

/**
 * Formats a raw cell value for table display.
 *
 * Non-integer numbers are rounded to 5 significant digits (matches the
 * design mock, e.g. 0.037695, 449.67); integers and strings pass through,
 * null/undefined become null so the Table component renders "-".
 *
 * @param value - raw value from the report data
 * @returns display-ready cell value
 */
function formatCellValue(value: unknown): TableCellValue {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Number.isInteger(value)) return value;
        return Number(value.toPrecision(5));
    }
    if (value === null || value === undefined) return null;
    return String(value);
}

/**
 * Converts the flowsheet-level stream table (pandas split orientation:
 * index/units/columns/data, cells are [value, fixed-flag] pairs) into
 * headers + rows for the Table component.
 *
 * @param table - actions.stream_table from the runner result
 * @returns headers and rows ready to pass to Table
 */
function flowsheetTableToProps(table: FlowsheetStreamTable): {
    headers: TableCellValue[];
    rows: TableCellValue[][];
} {
    const headers: TableCellValue[] = ['State variables', 'Units', ...table.columns];
    const rows = table.index.map((label, rowIdx) => [
        label,
        table.units[rowIdx] ?? null,
        ...(table.data[rowIdx] ?? []).map((cell) => formatCellValue(cell?.[0])),
    ]);
    return { headers, rows };
}

/**
 * Converts a per-unit stream table (column-oriented: "Units" plus one
 * key per port, each mapping row label → value) into headers + rows for
 * the Table component.
 *
 * Row order follows the "Units" mapping; port column order follows the
 * object key order from the report.
 *
 * @param table - a unit's stream_table from model_reports
 * @returns headers and rows ready to pass to Table
 */
function unitTableToProps(table: UnitStreamTable): {
    headers: TableCellValue[];
    rows: TableCellValue[][];
} {
    const units = table.Units ?? {};
    const portNames = Object.keys(table).filter((key) => key !== 'Units');
    const rowLabels = Object.keys(units);
    const headers: TableCellValue[] = ['Parameter', 'Units', ...portNames];
    const rows = rowLabels.map((label) => [
        label,
        units[label] ?? null,
        ...portNames.map((port) => formatCellValue(table[port]?.[label])),
    ]);
    return { headers, rows };
}

/**
 * Formats a bounds pair for display, e.g. [null, null] → "(None, None)".
 *
 * @param bounds - lower/upper bound pair from a performance variable
 * @returns the formatted bounds string
 */
function formatBounds(bounds: (number | null)[] | undefined): string {
    const [lb, ub] = bounds ?? [null, null];
    const fmt = (b: number | null) => (b === null ? 'None' : String(formatCellValue(b)));
    return `(${fmt(lb)}, ${fmt(ub)})`;
}

/**
 * Converts a unit's performance contents (vars/exprs/params sections) into
 * headers + rows for the "Other Performance Variables" table.
 *
 * The "Port Type" column has no counterpart in the report data yet and is
 * rendered as "-"; exprs and params have no fixed/bounds info so those
 * cells are also "-".
 *
 * @param performance - a unit's performance object from model_reports
 * @returns headers and rows ready to pass to Table; rows is empty when the
 *          unit has no performance data
 */
function performanceToProps(performance: UnitReport['performance']): {
    headers: TableCellValue[];
    rows: TableCellValue[][];
} {
    const headers: TableCellValue[] = ['Variables', 'Port Type', 'Value', 'Units', 'Fixed', 'Bounds'];
    const rows: TableCellValue[][] = [];
    for (const [name, v] of Object.entries(performance?.vars ?? {})) {
        rows.push([name, null, formatCellValue(v.value), v.units, v.fixed ? 'True' : 'False', formatBounds(v.bounds)]);
    }
    for (const [name, v] of Object.entries(performance?.exprs ?? {})) {
        rows.push([name, null, formatCellValue(v.value), v.units, null, null]);
    }
    for (const [name, v] of Object.entries(performance?.params ?? {})) {
        rows.push([name, null, formatCellValue(v.value), v.units, null, null]);
    }
    return { headers, rows };
}

/**
 * Counts cells (headers included) across a set of tables that contain the
 * search term, case-insensitively. Drives the "Found N items" counter shown
 * under the search bar in table mode.
 *
 * @param tables - header/row props of every rendered table
 * @param term - normalized (lowercased) search term
 * @returns number of matching cells; 0 when the term is empty
 */
function countMatches(
    tables: { headers: TableCellValue[]; rows: TableCellValue[][] }[],
    term: string,
): number {
    if (!term) return 0;
    let count = 0;
    for (const { headers, rows } of tables) {
        for (const cell of headers) {
            if (cell !== null && String(cell).toLowerCase().includes(term)) count++;
        }
        for (const row of rows) {
            for (const cell of row) {
                if (cell !== null && String(cell).toLowerCase().includes(term)) count++;
            }
        }
    }
    return count;
}

/**
 * Stream table view for the variable page, rendered when "View in Tree
 * Layout" is toggled off.
 *
 * Layout is a two-column structure: a contents nav on the left listing the
 * flowsheet-level stream table and each unit, and the stacked tables on the
 * right. Clicking a contents entry scrolls its section into view.
 *
 * Data sources: the flowsheet table comes from actions.stream_table; unit
 * tables come from actions.model_reports at the last completed step. Units
 * without stream table data (e.g. skipped by the report collector) are
 * omitted.
 *
 * @param highlight - search term from the toolbar; matching text in every
 *                    table is highlighted (no filtering)
 * @returns the stream table view element
 */
export default function StreamTable({ highlight }: { highlight?: string }) {
    const { flowsheetRunnerResult, highlightedStream } = useContext(AppContext);
    const actions = flowsheetRunnerResult?.actions;
    const flowsheetTable = actions?.stream_table;
    // Stream picked in the process-flow view; +2 skips the label and units columns
    const streamColumn = flowsheetTable && highlightedStream ? flowsheetTable.columns.indexOf(highlightedStream) : -1;

    // Unit reports from the last completed step, e.g. "solve_initial"
    const modelReports = actions?.model_reports;
    const unitReports = modelReports?.step_reports?.[modelReports.last_step]?.reports ?? {};

    // [display name, stream table] pairs; "fs.M101" → "M101"
    const unitTables = Object.entries(unitReports)
        .filter(([, report]) =>
            report.stream_table && Object.keys(report.stream_table).length > 0
        )
        .map(([path, report]) => ({
            name: path.replace(/^fs\./, ''),
            tableProps: unitTableToProps(report.stream_table as UnitStreamTable),
            performance: performanceToProps(report.performance),
        }));

    const flowsheetProps = flowsheetTable ? flowsheetTableToProps(flowsheetTable) : null;

    // Live match counter for the search term across every rendered table
    const term = (highlight ?? '').trim().toLowerCase();
    const matchCount = countMatches(
        [
            ...(flowsheetProps ? [flowsheetProps] : []),
            ...unitTables.flatMap((u) => [u.tableProps, u.performance]),
        ],
        term,
    );

    // One ref per section so the contents nav can scroll to it
    const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

    /**
     * Scrolls the section registered under the given key into view.
     *
     * @param key - section key ("flowsheet" or a unit name)
     */
    const scrollToSection = (key: string) => {
        sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    if (!flowsheetTable && unitTables.length === 0) {
        return (
            <p className={css.no_data}>
                No stream table data available. Run the flowsheet to generate it.
            </p>
        );
    }

    return (
        <>
            {/* Live search result counter, shown right under the search bar */}
            {term && (
                <p className={css.match_count}>
                    Found {matchCount} {matchCount === 1 ? 'item' : 'items'}
                </p>
            )}
        <div className={css.stream_table_container}>
            {/* Left: contents nav */}
            <nav className={css.contents_nav}>
                <p className={css.contents_title}>CONTENTS</p>
                <ul>
                    {flowsheetTable && (
                        <li onClick={() => scrollToSection('flowsheet')}>
                            Flowsheet Stream Table
                        </li>
                    )}
                    {unitTables.map(({ name }) => (
                        <li key={name} onClick={() => scrollToSection(name)}>
                            Unit - {name}
                        </li>
                    ))}
                </ul>
            </nav>

            {/* Right: flowsheet table followed by per-unit tables */}
            <div className={css.table_sections}>
                {flowsheetProps && (
                    <section
                        ref={(el) => { sectionRefs.current['flowsheet'] = el; }}
                        className={css.table_section}
                    >
                        <h3 className={css.section_title}>Flowsheet Stream Table</h3>
                        <Table
                            {...flowsheetProps}
                            highlight={highlight}
                            highlightColumn={streamColumn >= 0 ? streamColumn + 2 : undefined}
                        />
                    </section>
                )}

                {unitTables.map(({ name, tableProps, performance }) => (
                    <section
                        key={name}
                        ref={(el) => { sectionRefs.current[name] = el; }}
                        className={css.table_section}
                    >
                        <h3 className={css.section_title}>Unit - {name}</h3>
                        <div className={css.unit_table}>
                            <h4 className={css.section_subtitle}>Stream Table</h4>
                            <Table {...tableProps} highlight={highlight} />
                        </div>
                        {performance.rows.length > 0 && (
                            <div className={css.unit_table}>
                                <h4 className={css.section_subtitle}>Other Performance Variables</h4>
                                <Table {...performance} highlight={highlight} />
                            </div>
                        )}
                    </section>
                ))}
            </div>
        </div>
        </>
    );
}

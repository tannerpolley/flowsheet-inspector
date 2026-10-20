import * as fs from 'fs';
import * as path from 'path';

/**
 * Saved process-flow diagram positions live next to the flowsheet file as
 * `<flowsheet stem>.fi-layout.json`: `{ "<unit name>": { "x": 0, "y": 0 } }`.
 */
export type Positions = Record<string, { x: number; y: number }>;

// Flowsheet file of the report last sent to the results panel; layouts are
// read and written for it, never for a path the webview sends.
let displayedFlowsheet = '';

export function setDisplayedFlowsheet(flowsheetFile: string): void {
    displayedFlowsheet = flowsheetFile;
}

export function getDisplayedFlowsheet(): string {
    return displayedFlowsheet;
}

export function layoutPath(flowsheetFile: string): string {
    const parsed = path.parse(flowsheetFile);
    return path.join(parsed.dir, `${parsed.name}.fi-layout.json`);
}

/** True for an object mapping unit names to finite numeric `x` and `y`. */
export function isPositions(value: unknown): value is Positions {
    const isObject = (v: unknown): v is Record<string, unknown> =>
        typeof v === 'object' && v !== null && !Array.isArray(v);
    return isObject(value) && Object.values(value).every(
        (p) => isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y),
    );
}

/** Saved positions, or `{}` when nothing has been saved yet. Throws on invalid stored data. */
export function readLayout(flowsheetFile: string): Positions {
    const file = layoutPath(flowsheetFile);
    if (!fs.existsSync(file)) {
        return {};
    }
    const positions: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!isPositions(positions)) {
        throw new Error(`${file} is not a map of unit names to numeric x and y`);
    }
    return positions;
}

/** Replaces the saved positions. Throws, leaving the file untouched, on invalid positions. */
export function writeLayout(flowsheetFile: string, positions: unknown): void {
    if (!isPositions(positions)) {
        throw new Error('positions must map unit names to numeric x and y');
    }
    fs.writeFileSync(layoutPath(flowsheetFile), JSON.stringify(positions, null, 2) + '\n');
}

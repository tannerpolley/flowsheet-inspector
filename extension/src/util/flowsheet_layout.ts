import * as fs from 'fs';
import * as path from 'path';

/**
 * Saved process-flow diagram positions live next to the flowsheet file as
 * `<flowsheet stem>.fi-layout.json`: `{ "<unit name>": { "x": 0, "y": 0 } }`.
 */
export function layoutPath(flowsheetFile: string): string {
    const parsed = path.parse(flowsheetFile);
    return path.join(parsed.dir, `${parsed.name}.fi-layout.json`);
}

/** Saved positions, or `{}` when nothing has been saved yet. */
export function readLayout(flowsheetFile: string): Record<string, { x: number; y: number }> {
    const file = layoutPath(flowsheetFile);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
}

export function writeLayout(flowsheetFile: string, positions: Record<string, { x: number; y: number }>): void {
    fs.writeFileSync(layoutPath(flowsheetFile), JSON.stringify(positions, null, 2) + '\n');
}

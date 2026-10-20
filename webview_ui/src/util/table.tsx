import css from '../css/table.module.css'

/** A single cell value; null renders as "-" */
export type TableCellValue = string | number | null;

/**
 * Renders one cell's content, wrapping the first case-insensitive match of
 * the highlight term in a <mark> so search hits stand out.
 *
 * @param cell - the raw cell value; null/undefined renders as "-"
 * @param highlight - search term to highlight; no-op when empty or unmatched
 * @returns the cell content, with the matched substring marked if found
 */
function renderCellContent(cell: TableCellValue, highlight?: string): React.ReactNode {
    if (cell === null || cell === undefined) return '-';
    const text = String(cell);
    if (!highlight) return text;
    const idx = text.toLowerCase().indexOf(highlight.toLowerCase());
    if (idx === -1) return text;
    return (
        <>
            {text.slice(0, idx)}
            <mark className={css.cell_highlight}>{text.slice(idx, idx + highlight.length)}</mark>
            {text.slice(idx + highlight.length)}
        </>
    );
}

/**
 * Reusable data table used by the stream table view (and any future tabular
 * displays). Purely presentational: takes header labels and row data and
 * renders a striped HTML table.
 *
 * Kept intentionally data-driven (headers + rows arrays) so it can be swapped
 * out for an ag-grid implementation later without changing call sites.
 *
 * @param headers - column header labels; first column is the row-label column
 * @param rows - table body rows; each row must have the same length as headers
 * @param highlight - optional search term; matches in header and body cells
 *                    are highlighted
 * @param highlightColumn - optional column index to mark and scroll into view
 * @returns a horizontally scrollable table element
 */
export default function Table({ headers, rows, highlight, highlightColumn }: {
    headers: TableCellValue[];
    rows: TableCellValue[][];
    highlight?: string;
    highlightColumn?: number;
}) {
    const columnClass = (i: number) => (i === highlightColumn ? css.column_highlight : undefined);
    return (
        <div className={css.table_wrapper}>
            <table className={css.data_table}>
                <thead>
                    <tr>
                        {headers.map((header, i) => (
                            <th
                                key={i}
                                className={columnClass(i)}
                                ref={i === highlightColumn ? (el) => el?.scrollIntoView({ block: 'center', inline: 'center' }) : undefined}
                            >
                                {renderCellContent(header, highlight)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                            {row.map((cell, cellIdx) => (
                                <td key={cellIdx} className={columnClass(cellIdx)}>{renderCellContent(cell, highlight)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

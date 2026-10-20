import type { ReactNode } from 'react';
import { host } from '../host';
import css from '../css/logview.module.css';

/**
 * Matches Python traceback location lines such as:
 *   File "/path/to/flowsheet.py", line 42, in build
 * Capture group 1 is the file path, capture group 2 is the 1-based line number.
 * Windows paths (e.g. C:\...\flowsheet.py) are matched too since the path is
 * simply everything between the quotes.
 */
const TRACEBACK_LOCATION_RE = /File "([^"]+)", line (\d+)/g;

/**
 * Asks the extension host to open a file in the editor, jump to a line, and
 * temporarily highlight it.
 *
 * Why: lets users click a traceback location in the webview logs and land
 * directly on the failing line instead of hunting for it manually. Reuses the
 * existing `focus_document` instruction, extended with a `line` field which is
 * handled in webview_receive_message_handler.ts on the extension side.
 *
 * @param filePath Absolute path of the file as it appears in the traceback.
 * @param line 1-based line number from the traceback.
 */
function openFileAtLine(filePath: string, line: number) {
    host.postMessage({
        frontendInstruction: 'focus_document',
        fromPanel: 'webView',
        target: filePath,
        line,
    });
}

/**
 * Renders raw log text with Python traceback file locations turned into
 * clickable links. Clicking a link opens the file in the editor and highlights
 * the referenced line. Non-openable pseudo-files (e.g. `<string>`,
 * `<frozen importlib._bootstrap>`) are left as plain text. Text without any
 * traceback locations is rendered unchanged.
 *
 * @param props.text The raw log text to render (may span multiple lines).
 * @returns The text as a React fragment with traceback locations linkified.
 */
export default function TracebackText({ text }: { text: string }) {
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    // Fresh regex instance per render: the module-level one keeps `lastIndex`
    // state across calls because of the /g flag.
    const re = new RegExp(TRACEBACK_LOCATION_RE.source, 'g');

    while ((match = re.exec(text)) !== null) {
        const [fullMatch, filePath, lineStr] = match;
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        if (filePath.startsWith('<')) {
            // Pseudo-files cannot be opened in an editor
            parts.push(fullMatch);
        } else {
            parts.push(
                <span
                    key={match.index}
                    className={css.trace_link}
                    title={`Open ${filePath} at line ${lineStr}`}
                    onClick={() => openFileAtLine(filePath, Number(lineStr))}
                >
                    {fullMatch}
                </span>
            );
        }
        lastIndex = match.index + fullMatch.length;
    }

    if (parts.length === 0) {
        return <>{text}</>;
    }
    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }
    return <>{parts}</>;
}

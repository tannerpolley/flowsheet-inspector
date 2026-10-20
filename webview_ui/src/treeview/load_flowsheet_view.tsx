import { useState, useContext, useMemo } from "react";
import css from "../css/load_flowsheet_view.module.css";
import { AppContext } from "../context";
import { host } from "../host";

// Helper to convert unix timestamp to relative time string
function timeSince(unixTimestampSeconds: number) {
    if (!unixTimestampSeconds) return "-";
    const date = new Date(unixTimestampSeconds * 1000);
    const seconds = Math.floor(Date.now() / 1000 - unixTimestampSeconds);

    let interval = seconds / 86400;
    if (interval > 1) {
        // Greater than 1 day, show the actual date and time
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: false
        });
    }
    interval = seconds / 3600;
    if (interval >= 1) {
        const h = Math.floor(interval);
        const m = Math.floor((seconds - h * 3600) / 60);
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    interval = seconds / 60;
    if (interval >= 1) {
        return Math.floor(interval) + "m";
    }
    return Math.floor(seconds) + "s";
}

export default function LoadFlowsheetView() {
    const { idaesHistoryList } = useContext(AppContext);

    const [searchQuery, setSearchQuery] = useState<string>("");

    const filteredRuns = useMemo(() => {
        if (!idaesHistoryList) return [];
        if (!searchQuery) return idaesHistoryList; // Show all by default
        
        const lowerQuery = searchQuery.toLowerCase();
        return idaesHistoryList.filter(r => 
            (r.name?.toLowerCase().includes(lowerQuery)) || 
            (r.filename?.toLowerCase().includes(lowerQuery))
        );
    }, [idaesHistoryList, searchQuery]);

    const handleLoadRun = (id?: number) => {
        if (id) {
            host.postMessage({ frontendInstruction: "pull_flowsheet_history", fromPanel: "treeView", id });
        }
    };

    return (
        <div className={css.container}>
            {/* Control Bar */}
            <div className={css.controlBar}>
                <input
                    type="text"
                    className={css.searchBox}
                    placeholder="Search history by name or path..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={idaesHistoryList === null}
                />

                <div className={css.actionGroup}>
                    <span className={css.runCount}>Runs: {filteredRuns.length}</span>
                </div>
            </div>

            {/* Data Table */}
            <div className={css.tableContainer}>
                <div className={css.headerRow}>
                    <div className={css.colStatus}>Status</div>
                    <div className={css.colTime}>Since</div>
                    <div>Flowsheet</div>
                    <div className={css.colTags}>Tags</div>
                </div>

                <div className={css.dataRowContainer}>
                    {filteredRuns.map((run) => {
                        const extractedFilename = run.filename ? run.filename.split(/[/\\]/).pop() : "";
                        let displayName = run.name ? run.name.trim() : (extractedFilename || "");
                        
                        // If no valid text, or if the final string still looks like a raw path (contains / or \)
                        // We replace it with the fallback text as requested.
                        if (!displayName || /[/\\]/.test(displayName)) {
                            displayName = "Name not available";
                        }

                        const tooltipText = run.filename || "No file path available";
                        
                        return (
                            <div
                                key={run.id}
                                className={css.dataRow}
                                onClick={() => handleLoadRun(run.id)}
                                style={{ cursor: 'pointer' }}
                            >
                                <div className={css.colStatus}>
                                    {run.status ? (
                                        <div className={`${css["status-icon"]} ${css["status-icon--success"]}`}>✓</div>
                                    ) : (
                                        <div className={`${css["status-icon"]} ${css["status-icon--fail"]}`}
                                            onClick={(e) => e.stopPropagation()} /* Prevent clicking from re-opening the run if they just wanted to inspect the error */
                                        >
                                            ✕
                                            <span className={css.cssTooltip}>
                                                {run.solverError ? `Solver Output: ${run.solverError}` : "Run failed. No solver output available."}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div className={css.colTime}>{timeSince(run.created)}</div>
                                <div className={css.colFlowsheet}>
                                    <span className={css.flowsheetText} style={{ fontStyle: displayName === "Name not available" ? 'italic' : 'normal', color: displayName === "Name not available" ? 'var(--vscode-descriptionForeground)' : 'var(--vscode-editor-foreground)' }}>
                                        {displayName}
                                    </span>
                                    <div className={css.pathTooltip}>
                                        {tooltipText}
                                    </div>
                                </div>
                                <div className={css.colTags}>
                                    <span className={css.tagBadge} style={!run.tags ? { backgroundColor: 'transparent', color: 'var(--vscode-descriptionForeground)' } : {}}>
                                        {run.tags || '-'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                    {idaesHistoryList === null && (
                        <div className={css.emptyMessage}>Scanning SQLite database...</div>
                    )}
                    {idaesHistoryList !== null && filteredRuns.length === 0 && (
                        <div className={css.emptyMessage}>
                            <div>No historical runs found across any flowsheet.</div>
                            <div style={{ marginTop: '8px', fontSize: '11px' }}>
                                Please execute a <b>RUN FLOWSHEET</b> above to generate history.
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
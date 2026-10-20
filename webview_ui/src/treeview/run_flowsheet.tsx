import { host, type HostMessage } from "../host";
import { useContext, useEffect, useState } from "react";
import { AppContext } from "../context";
import css from "../css/run_flowsheet.module.css";
export default function RunFlowsheet() {
    const {
        liveSolveEnabled,
        isLoading,
        isRunningFlowsheet,
        setIsRunningFlowsheet,
        setFlowsheetRunnerResult,
        selectedSteps,
        setExtensionErrorLogs,
        setTerminalLogs,
        flowsheetSaveNotice,
        setFlowsheetSaveNotice,
        activateFileName
    } = useContext(AppContext);

    // Flowsheet name shown in the rerun notice: the active file name without
    // its .py extension (e.g. "hda_flowsheet.py" → "hda_flowsheet").
    const flowsheetDisplayName = (activateFileName || 'flowsheet').replace(/\.py$/, '');

    const [elapsedTime, setElapsedTime] = useState(0);
    const [dots, setDots] = useState(".");
    const [activePid, setActivePid] = useState<number | null>(null);

    /**
     * Handler for running the flowsheet by sending a "run_flowsheet" message to the extension backend, the backend should start run flowsheet, and record a process id to use for killing the process.
     * Also this will set isRunningFlowsheet to true, this will start the loading animation.   
     */
    const runFlowsheetHandler = () => {
        if (isLoading || isRunningFlowsheet) return;
        const lastSelectedStep = selectedSteps.length > 0
            ? selectedSteps[selectedSteps.length - 1]
            : "";
        host.postMessage(
            {
                frontendInstruction: "run_flowsheet",
                fromPanel: 'treeView',
                selectedSteps: lastSelectedStep
            }
        );
        setElapsedTime(0);
        setDots(".");
        setExtensionErrorLogs([]); // Clear logs on new run
        setTerminalLogs([]); // Clear terminal on new run
        setFlowsheetSaveNotice(false); // This run picks up the saved edits
        setIsRunningFlowsheet(true);
    }

    const cancelFlowsheetRunHandler = () => {
        if (liveSolveEnabled) {
            host.postMessage({ frontendInstruction: 'cancel_solve', fromPanel: 'treeView' });
            return;
        }
        console.log(`cancelFlowsheetRunHandler triggered, activePid is: ${activePid}`);
        host.postMessage(
            {
                frontendInstruction: 'kill_process',
                fromPanel: 'treeView',
                pid: activePid || 999999
            }
        );
        setIsRunningFlowsheet(false);
        setElapsedTime(0);
        setDots(".");
        setActivePid(null);
    }

    useEffect(() => {
        const messageHandler = (message: HostMessage) => {
            switch (message.type) {
                case 'process_started':
                    console.log(`Received process_started message in frontend! PID is: ${message.pid}`);
                    if (message.pid) {
                        setActivePid(message.pid);
                    }
                    break;
                case 'flowsheet_detail':
                    setFlowsheetRunnerResult(message.data);
                    setIsRunningFlowsheet(false);
                    setElapsedTime(0);
                    setDots(".");
                    setActivePid(null);
                    break;
            }
        };
        return host.onMessage(messageHandler);
    }, [setFlowsheetRunnerResult, setIsRunningFlowsheet]);

    // Timer and animated dots logic
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | undefined;
        if (isRunningFlowsheet) {
            interval = setInterval(() => {
                setElapsedTime(prev => prev + 1);
                setDots(prev => {
                    if (prev === ".") return "..";
                    if (prev === "..") return "...";
                    return ".";
                });
            }, 1000);
        }
        return () => {
            if (interval !== undefined) clearInterval(interval);
        };
    }, [isRunningFlowsheet]);

    const formatTime = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <section className={`${css.run_flowsheet_section}`}>
            <div className={`${css.run_flowsheet_button_container}`}>
                <button
                    className={`${css.run_flowsheet_button} ${isRunningFlowsheet ? css.cancel_flowsheet_run_btn_hidden : ''}`}
                    onClick={() => runFlowsheetHandler()}
                    disabled={isLoading}
                    style={{ opacity: isLoading ? 0.5 : 1, cursor: isLoading ? 'not-allowed' : 'pointer' }}
                >
                    Run
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M6 5L11 8L6 11V5Z" fill="currentColor" />
                    </svg>
                </button>
                <button
                    onClick={() => cancelFlowsheetRunHandler()}
                    className={`
                        ${isRunningFlowsheet ? css.cancel_flowsheet_run_btn : css.cancel_flowsheet_run_btn_hidden}
                    `}
                >
                    Cancel
                </button>
            </div>

            {flowsheetSaveNotice && !isRunningFlowsheet && (
                <div className={css.rerun_notice}>
                    <p>INFO: ‘{flowsheetDisplayName}’ has been updated.</p>
                    <p>Steps listed have been updated.</p>
                    <p>Initiate a new run for testing.</p>
                </div>
            )}

            <div className={`${css.run_flowsheet_animation_container}`}>
                <div className={`
                    ${isRunningFlowsheet ? css.running_time_container : css.running_timer_container_hidden}
                `}>
                    <p className={`${css.running_time_label}`}>Running<span className={`${css.running_dots}`}>{dots}</span></p>
                    <p className={`${css.running_time}`}>{formatTime(elapsedTime)}</p>
                </div>
            </div>
        </section>
    );
}

import { useState, useEffect, useRef } from 'react';
import { host } from './host';
import { useContext } from 'react';
import { AppContext } from './context';
import type { Diagnostics } from './interface/flowsheet_result_interface';

import TreePage from './tree_app.tsx'
import EditorPage from './editor_page';
import WebView from './web_view/main_display.tsx';
import './webviewApp.css'
import appCss from './css/app.module.css'

export default function App() {
  const {
    setidaesRunInfo, // the idaes-run --info result
    setEditorContent, // the activate editor content
    setActivateFileName, // the current activate file name
    flowsheetRunnerResult,
    setFlowsheetRunnerResult, // the idaes-run result
    setExtensionErrorLogs, // the extension error logs
    setTerminalLogs,
    setIsLoading,
    setInitError,
    setPackageWarnings,
    setOpenPythonFiles,
    setIdaesHistoryList,
    setMermaidDiagram,
    setOsPlatform,
    setStepStatuses,
    setCurrentPythonEnv,
    setFlowsheetSaveNotice
  } = useContext(AppContext);

  const [appName, setAppName] = useState('');
  const [isHighlight, setIsHighlight] = useState(false);
  // Tracks the active flowsheet file so step-status icons / error log (which
  // belong to a specific file's run) can be cleared when the active file
  // actually changes — not on same-file loading refreshes.
  const activeFileRef = useRef<string>('');

  // clear vscode error in console
  // console.clear();

  /**
   * This function controls which app to load based on the message from the extension
   * @param message 
   * @returns 
   */
  function loadWhichApp(pageName: string) {
    let loadedApp: React.ReactNode | undefined = undefined
    console.log(`Now loading page: ${pageName}`)
    switch (pageName) {
      case 'editor':
        loadedApp = <EditorPage />
        break;
      case 'webView':
        console.log('loading web view page');
        loadedApp = <WebView />
        break;
      case 'treeView':
        console.log('loading tree page');
        loadedApp = <TreePage />
        break;
      case 'error':
        console.log(`Encounter an error: ${pageName}`);
        break;
      default:
        console.log('Unknown message type:', pageName);
        break;
    }
    return loadedApp
  }

  // Log run-failure details once per result change, from this stable root component
  useEffect(() => {
    if (!flowsheetRunnerResult) return;
    const diagnostics = flowsheetRunnerResult.actions?.diagnostics as Diagnostics | undefined;
    if (diagnostics?.valid !== false) return;

    const lastRun = flowsheetRunnerResult.last_run ?? [];
    const timestamp = `[${new Date().toLocaleTimeString()}]`;
    setExtensionErrorLogs(prev => [
      ...prev,
      `${timestamp} fi-run has issues: diagnostics unavailable (valid=false). Last completed steps: [${lastRun.join(", ")}]. Raw data: ${JSON.stringify({ diagnostics, last_run: lastRun })}`,
      `${timestamp} fi-run has issues: model variables unavailable. Raw data: ${JSON.stringify({ model_variables: flowsheetRunnerResult.actions?.model_variables, last_run: lastRun })}`,
      `${timestamp} fi-run has issues: solver output may be incomplete. Raw data: ${JSON.stringify({ solver_output: flowsheetRunnerResult.actions?.solver_output, last_run: lastRun })}`,
      `${timestamp} fi-run has issues: mermaid diagram unavailable. Raw data: ${JSON.stringify({ mermaid_diagram: flowsheetRunnerResult.actions?.mermaid_diagram, last_run: lastRun })}`,
    ]);
  }, [flowsheetRunnerResult]);

  useEffect(() => {
    // listen extension message
    host.onMessage((message) => {
      switch (message.type) {
        case 'init':
          console.log(`VSCode post message: ${JSON.stringify(message)}`);
          setEditorContent(message.content);
          setActivateFileName(message.fileName);
          activeFileRef.current = message.fileName;
          setidaesRunInfo(message.idaesRunInfo);
          setAppName(message.loadApp);
          setIsLoading(false);
          if (message.osPlatform) {
            setOsPlatform(message.osPlatform);
          }
          break;
        case 'update':
          console.log(`VSCode post message: ${JSON.stringify(message)}`);
          setEditorContent(message.content);
          break;
        case 'switch_tab':
          console.log('Received switch_tab event with payload:', message);
          // Switching to a different flowsheet file: the previous file's run
          // results (step icons + error log) no longer apply, so clear them.
          // Non-flowsheet files (is_flowsheet === false) don't claim the run
          // results — e.g. a clicked traceback link opening a site-packages
          // file must not wipe the error log of the run being inspected.
          if (message.is_flowsheet !== false && message.activate_tab_name !== undefined && message.activate_tab_name !== activeFileRef.current) {
            activeFileRef.current = message.activate_tab_name;
            setStepStatuses({});
            setExtensionErrorLogs([]);
            // The rerun notice referred to the previous flowsheet's edits
            setFlowsheetSaveNotice(false);
          }
          if (message.isLoading !== undefined) {
            console.log('Calling setIsLoading with:', message.isLoading);
            setIsLoading(message.isLoading);
            setActivateFileName(message.activate_tab_name);
          } else {
            setActivateFileName(message.activate_tab_name);
          }
          if (message.idaesRunInfo !== undefined) {
            setidaesRunInfo(message.idaesRunInfo);
          }
          if (message.initError) {
            setInitError(message.initError);
          } else if (message.initError === null || message.isLoading) {
            setInitError(null);
          }
          if (message.isLoading) {
            setPackageWarnings(null);
          }
          else if (message.packageWarnings !== undefined) {
            setPackageWarnings(message.packageWarnings);
          }
          if (message.open_python_files !== undefined) {
            setOpenPythonFiles(message.open_python_files);
          }
          break;
        case 'python_env_update':
          console.log('Received python_env_update:', message);
          setCurrentPythonEnv(message.current ?? null);
          break;
        case 'update_open_files':
          console.log('Received update_open_files event');
          if (message.open_python_files !== undefined) {
            setOpenPythonFiles(message.open_python_files);
          }
          break;
        case 'flowsheet_detail':
          // handle flowsheet data
          console.log(`VSCode post message: ${JSON.stringify(message)}`);
          break;
        case 'flowsheet_runner_result':
          console.log('receited flowsheet runner result, and update state');
          setFlowsheetRunnerResult(message.data);
          break;
        case 'error':
          console.log(`VSCode post error message: ${JSON.stringify(message)}`);
          setExtensionErrorLogs((prev: string[]) => {
            const newError = `[${new Date().toLocaleTimeString()}] ${message.message || JSON.stringify(message)}`;
            return [...prev, newError];
          });
          break;
        case 'terminal_log':
          setTerminalLogs((prev: string[]) => [...prev, message.data]);
          break;
        case 'start_new_run':
          // Clear previous run results so stale diagram/IPOPT/diagnostic data doesn't linger during a new run
          setFlowsheetRunnerResult(null);
          setMermaidDiagram('');
          setExtensionErrorLogs([]);
          // Reset per-step run indicators so the tree view starts from a clean slate
          setStepStatuses({});
          // The new run picks up the saved edits, so the rerun notice is satisfied
          setFlowsheetSaveNotice(false);
          break;
        case 'flowsheet_file_saved':
          // The active flowsheet file was saved after the shown results were
          // produced — surface the "rerun the flowsheet" notice under Run.
          console.log('Active flowsheet saved, showing rerun notice');
          setFlowsheetSaveNotice(true);
          break;
        case 'step_status_update': {
          // Per-step progress. Build a map keyed by step name so the tree view
          // can render running / success / error icons next to each step.
          //
          // Two distinct failure kinds:
          //   - 'error'         — the step's code raised (errcode !== 0): red X
          //   - 'solver_failed' — a solve step ran without raising but found no
          //                       solution (solve_ok === 0: infeasible / max
          //                       iterations): orange X
          // solve_ok === null means a non-solve step or unknown status and is
          // never treated as a failure.
          //
          // Error-log lines are written only for authoritative broadcasts:
          //   - `final` — sent once after the run finishes (carries the run's
          //               full traceback in `runException`)
          //   - `reset` — sent when loading a historical run (clears prior log)
          // Intermediate polling broadcasts only refresh the icons, so a
          // half-finished / detail-less failure line never lingers.
          const runException: string = message.runException || '';
          const exceptionHeadline = runException.split('\n')[0].trim();
          const SOLVER_FAIL_MSG = 'Solver did not find a solution (infeasible or maximum iterations exceeded)';

          const nextStatuses: Record<string, { state: 'success' | 'error' | 'solver_failed'; errmsg?: string }> = {};
          const newErrorLines: string[] = [];
          for (const row of message.data ?? []) {
            let state: 'success' | 'error' | 'solver_failed' = 'success';
            // Tooltip text for the icon — kept short (headline only).
            let iconMsg: string | undefined = row.errmsg || undefined;
            if (row.errcode !== 0) {
              state = 'error';
              iconMsg = row.errmsg || exceptionHeadline || undefined;
            } else if (row.solve_ok === 0) {
              state = 'solver_failed';
              iconMsg = row.errmsg || SOLVER_FAIL_MSG;
            }
            nextStatuses[row.step_name] = { state, errmsg: iconMsg };

            if (state !== 'success' && (message.final || message.reset)) {
              // Full detail for the error log. For raised errors prefer the
              // run's traceback: it carries the `File "...", line N` locations
              // the log view turns into clickable links, while the step's own
              // errmsg is usually just the exception message. Keep the errmsg
              // too when the traceback doesn't already contain it.
              let detail: string;
              if (state === 'solver_failed') {
                detail = row.errmsg || SOLVER_FAIL_MSG;
              } else if (runException) {
                const errmsg = row.errmsg || '';
                detail = runException.includes(errmsg) ? runException : `${errmsg}\n${runException}`;
              } else {
                detail = row.errmsg || 'Step raised an error';
              }
              newErrorLines.push(`[${new Date().toLocaleTimeString()}] Step "${row.step_name}" failed:\n${detail}`);
            }
          }
          setStepStatuses(nextStatuses);
          if (message.reset) {
            // Loading a historical run: the error log should show only this run.
            setExtensionErrorLogs(newErrorLines);
          } else if (newErrorLines.length > 0) {
            setExtensionErrorLogs((prev: string[]) => [...prev, ...newErrorLines]);
          }
          break;
        }
        case 'clear_terminal_logs':
          setTerminalLogs([]);
          break;
        case 'highlight_view':
          console.log('Highlighting view per VSCode instruction');
          setIsHighlight(false);
          // Small timeout to restart animation if triggered again
          setTimeout(() => setIsHighlight(true), 10);
          break;
        case 'history_update':
          console.log(`Received history list length: ${message.data?.length}`);
          setIdaesHistoryList(message.data);
          break;
        default:
          console.log('Unknown message type:', JSON.stringify(message));
          break;
      }
    });

    // tell extension React is ready, can send data
    host.postMessage({ frontendInstruction: 'ready', fromPanel: 'treeView' });
  }, []);

  return (
    <div
      className={`${appCss.app_root} ${appName === 'treeView' ? appCss.app_root_sidebar : appCss.app_root_editor} ${isHighlight ? 'flash-highlight' : ''}`}
      onAnimationEnd={() => setIsHighlight(false)}
    >
      {loadWhichApp(appName)}
    </div>
  );
}
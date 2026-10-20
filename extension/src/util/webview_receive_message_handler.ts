import * as vscode from 'vscode';
import { activateWebviews } from "./webview_handler";
import { IFrontendMessage } from "../interface";
import runFlowsheet from "./run_flowsheet";
import { getWebview, brodcastMessage, setResultsPanelTitle } from "./webview_handler";
import { killProcessTree } from './platform_config';
import { queryReportById, queryStepStatusesByRunId, queryRunException, queryReportFilePathById } from './sqlite_reader';
import { broadcastCurrentPythonEnv, isPythonExtensionInstalled } from './python_env';
import { showFallbackInterpreterPicker } from './python_env_fallback';
import { suppressNextTabSwitchFor } from './activate_tab_handler';
import postGithubIssue, { IGithubIssueRequest } from './post_github_issue';
import * as path from 'path';
import { getDisplayedFlowsheet, readLayout, setDisplayedFlowsheet, writeLayout } from './flowsheet_layout';

export default function webviewReceiveMessageHandler(context: vscode.ExtensionContext, frontendMessage: IFrontendMessage) {
    console.log(`receive frontend instruction: ${JSON.stringify(frontendMessage)}`);
    if (!frontendMessage.fromPanel || !frontendMessage.frontendInstruction) {
        console.log(`Ignoring message missing fromPanel or frontendInstruction: ${JSON.stringify(frontendMessage)}`);
        return;
    }
    const instruction = frontendMessage.frontendInstruction;
    const fromPanel = frontendMessage.fromPanel;
    const webviewPanel = activateWebviews.get(fromPanel);

    // Error handler if webviewPanel not found log error.
    // Since no webview was found, the error cannot be posted and is logged instead.
    if (!webviewPanel) {
        console.error(`
        webviewReceiveMessageHandler raise error, webviewPanel not frond from activateWebviews.
        It try to find webviewPanel by name: ${fromPanel}.
        `);
        return;
    }

    switch (instruction) {
        case 'ready':
            frontEndReady(context, webviewPanel.webview);
            broadcastCurrentPythonEnv().catch((e) => console.error(`Failed to broadcast python env: ${e}`));
            console.log('frontend ready!');
            break;
        case 'open_interpreter_picker':
            // With ms-python installed, defer to its official picker; without
            // it (e.g. conda users who refuse the MS extension), open our own
            // fallback QuickPick — the sidebar selector must work either way.
            if (isPythonExtensionInstalled()) {
                vscode.commands.executeCommand('python.setInterpreter');
            } else {
                showFallbackInterpreterPicker().catch(
                    (e) => console.error(`Fallback interpreter picker failed: ${e}`),
                );
            }
            break;
        case 'run_flowsheet':
            console.log(`Receive frontend instruction: run flowsheet`);
            console.log(`Start to run flowsheet`);
            let selectedStep = undefined;
            if (frontendMessage.selectedSteps) {
                selectedStep = frontendMessage.selectedSteps;
            }
            runFlowsheet(context, webviewPanel.webview, selectedStep);
            console.log(`Done.`);
            break;
        case 'focus_view':
            console.log(`User is choosing focus view`);
            if (frontendMessage.target) {
                focusView(frontendMessage.target);
            }
            break;
        case 'focus_document':
            console.log(`User selected a document to focus`);
            if (frontendMessage.target) {
                focusDocument(frontendMessage.target, frontendMessage.line);
            }
            break;
        case 'switch_sub_tab':
            console.log(`Broadcasting switch_sub_tab to all webviews: ${frontendMessage.tab_name}`);
            brodcastMessage({ type: 'switch_sub_tab', tab_name: frontendMessage.tab_name, sub_tab_name: frontendMessage.sub_tab_name });
            break;
        case 'kill_process':
            if (frontendMessage.pid) {
                console.log(`User requested killing process PID: ${frontendMessage.pid}`);
                try {
                    killProcessTree(Number(frontendMessage.pid));
                } catch (e) {
                    console.error(`Failed to kill process: ${e}`);
                }
            } else {
                console.error('kill_process instruction received but no pid provided.');
            }
            break;
        case 'post_github_issue':
            // Feedback form submission: create a GitHub issue with the user's
            // own GitHub session, then report the outcome back to the panel
            // that submitted the form so it can show the success/error notice.
            console.log('Received feedback submission, posting GitHub issue...');
            postGithubIssue(frontendMessage as unknown as IGithubIssueRequest).then((result) => {
                webviewPanel.webview.postMessage({ type: 'github_issue_result', ...result });
            });
            break;
        case 'pull_flowsheet_history':
            if (frontendMessage.id) {
                console.log(`Loading historical run for ID: ${frontendMessage.id}`);

                // Check if webView is open. If not, open it before grabbing results!
                if (!activateWebviews.get('webView')) {
                    console.log('Main web view not found. Opening it via command flowsheet-inspector.openWebView');
                    vscode.commands.executeCommand('flowsheet-inspector.openWebView').then(() => {
                        // Wait for React to mount before continuing
                        setTimeout(() => {
                            webviewReceiveMessageHandler(context, frontendMessage);
                        }, 1200);
                    });
                    return; // Exit and let the delayed callback handle it once opened
                }

                try {
                    const parsedData = queryReportById(Number(frontendMessage.id));
                    if (!parsedData) {
                        brodcastMessage({ type: 'error', message: `No historical data found for id ${frontendMessage.id}` });
                        return;
                    }
                    console.log('Successfully fetched and parsed historical flowsheet JSON blob.');

                    // Retitle the results panel to the flowsheet file this run
                    // actually belongs to — it was titled from the active
                    // editor when the panel opened. Its diagram layout is
                    // stored with that file too.
                    const flowsheetFile = queryReportFilePathById(Number(frontendMessage.id));
                    setResultsPanelTitle(flowsheetFile);
                    setDisplayedFlowsheet(flowsheetFile);

                    brodcastMessage({ type: 'flowsheet_runner_result', data: parsedData });

                    // Also update the tree view's per-step status icons for this
                    // historical run. `reset: true` tells the frontend to start
                    // from a clean slate (clear stale icons / error log) so it
                    // shows exactly this run's steps.
                    const stepRows = queryStepStatusesByRunId(Number(frontendMessage.id));
                    brodcastMessage({
                        type: 'step_status_update',
                        data: stepRows,
                        runException: queryRunException(Number(frontendMessage.id)),
                        reset: true,
                    });
                } catch (e: any) {
                    brodcastMessage({ type: 'error', message: `Failed to load historical run: ${e.message}` });
                }
            }
            break;
        case 'load_layout':
        case 'save_layout': {
            // Process-flow positions are stored next to the flowsheet of the displayed report.
            const flowsheetFile = getDisplayedFlowsheet();
            if (!path.isAbsolute(flowsheetFile)) {
                webviewPanel.webview.postMessage({ type: 'error', message: 'The displayed report has no flowsheet file to store the diagram layout with.' });
                break;
            }
            try {
                if (instruction === 'save_layout') {
                    writeLayout(flowsheetFile, frontendMessage.positions);
                } else {
                    // `request` lets the webview drop replies to requests it has superseded.
                    webviewPanel.webview.postMessage({ type: 'layout', request: frontendMessage.request, positions: readLayout(flowsheetFile) });
                }
            } catch (e: any) {
                webviewPanel.webview.postMessage({ type: 'error', message: `Diagram layout ${instruction} failed: ${e.message}` });
            }
            break;
        }
        default:
            console.log(`receive unknown instruction: ${instruction}`);
    }
    return undefined;
}

function frontEndReady(context: vscode.ExtensionContext, webview: vscode.Webview) {
    console.log(`received ready`);
}

/**
 * Opens a document in the first editor column and, when a line number is
 * given, jumps to that line and flashes a temporary whole-line highlight.
 *
 * Why: the webview terminal / error logs render Python traceback locations
 * (`File "...", line N`) as clickable links so users can trace a failed run
 * straight to the offending source line. The highlight uses the theme's
 * find-match color and disposes itself after a few seconds so it does not
 * permanently mark the file.
 *
 * @param target Absolute path of the file to open (as reported by the
 *   Python traceback, so it may live outside the workspace, e.g. site-packages).
 * @param line Optional 1-based line number to reveal and highlight; clamped to
 *   the document's line count in case the file changed since the run.
 */
function focusDocument(target: string, line?: number | string) {
    if (line !== undefined && line !== null) {
        // A line-jump comes from a traceback link — a debug action, not the
        // user switching flowsheets. Keep the tree panel on the current
        // flowsheet instead of reacting to the editor focus change.
        suppressNextTabSwitchFor(vscode.Uri.file(target).fsPath);
    }
    vscode.workspace.openTextDocument(target).then(
        doc => vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false)
    ).then(editor => {
        const lineNumber = Number(line);
        if (!editor || !line || isNaN(lineNumber)) {
            return;
        }
        const lineIndex = Math.min(Math.max(lineNumber - 1, 0), editor.document.lineCount - 1);
        const range = editor.document.lineAt(lineIndex).range;
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

        const highlight = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        });
        editor.setDecorations(highlight, [range]);
        setTimeout(() => highlight.dispose(), 3000);
    }).then(undefined, err => {
        console.error(`Failed to show document: ${err}`);
    });
}


function focusView(webViewName: string) {
    let internalName = '';
    let openCommand = '';
    
    if (webViewName === 'webview') {
        internalName = 'webView';
        openCommand = 'flowsheet-inspector.openWebView';
    }

    const webviewPanel = getWebview(internalName);

    if (!webviewPanel) {
        console.log(`webviewPanel ${internalName} not found. Opening it via command ${openCommand}`);
        vscode.commands.executeCommand(openCommand).then(() => {
            // Need to wait for the webview to initialize and React App to load
            setTimeout(() => {
                const refreshedPanel = getWebview(internalName);
                if (refreshedPanel) {
                    refreshedPanel.webview.postMessage({ type: 'highlight_view' });
                }
            }, 1000);
        });
        return;
    }

    // It's open, focus it
    if (internalName === 'webView') {
        (webviewPanel as vscode.WebviewPanel).reveal();
    } else {
        vscode.commands.executeCommand(openCommand);
    }
    
    // Post message to frontend to trigger CSS animation
    webviewPanel.webview.postMessage({ type: 'highlight_view' });
}


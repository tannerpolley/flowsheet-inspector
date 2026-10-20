import { useContext, useEffect } from "react";
import { AppContext } from "../context"
import { host } from "../host";
import FlowsheetVariableDisplay from "./flowsheet_variable_display";
import css from "../css/webview_page.module.css";
import { postReloadMermaidDone } from '../util/post_message';

export default function VariableView() {
    const { setFlowsheetRunnerResult, activateFileName } = useContext(AppContext);

    useEffect(() => {
        host.onMessage((message) => {
            if (message.type === 'flowsheet_runner_result') {
                console.log(`receive flowsheet runner result! now updating flowsheetRunnerResult state`);
                setFlowsheetRunnerResult(message.data);
                postReloadMermaidDone({ reload_webview: 'done' });
            }
        })
    }, [])
    return (
        <section className={`${css.webview_page_container}`}>

            <h2>Variables for: {activateFileName}</h2>
            <div className={`${css.variable_container}`}>
                <FlowsheetVariableDisplay />
            </div>
        </section>
    );
}
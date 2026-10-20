import { useEffect, useContext } from 'react';
import { AppContext } from '../context';
import { host, type HostMessage } from '../host';
import css from '../css/logview.module.css';
import ErrorLog from './error_log';
import TerminalLogs from './terminal_log';

export default function LogsView() {
    const { activeLogTab, setActiveLogTab } = useContext(AppContext);

    useEffect(() => {
        const handleMessage = (message: HostMessage) => {
            if (message.type === 'switch_sub_tab' && message.sub_tab_name) {
                if (message.sub_tab_name === 'error' || message.sub_tab_name === 'terminal') {
                    setActiveLogTab(message.sub_tab_name);
                }
            }
        };
        return host.onMessage(handleMessage);
    }, []);

    return (
        <div className={css.logs_main_container}>
            <div className={css.tabs}>
                <span
                    className={`${css.tab} ${activeLogTab === "error" ? css.tab_active : ""}`}
                    onClick={() => setActiveLogTab("error")}
                >
                    Error Log
                </span>
                <span
                    className={`${css.tab} ${activeLogTab === "terminal" ? css.tab_active : ""}`}
                    onClick={() => setActiveLogTab("terminal")}
                >
                    Terminal Logs
                </span>
            </div>

            <div className={css.tab_content}>
                {activeLogTab === "error" && <ErrorLog />}
                {activeLogTab === "terminal" && <TerminalLogs />}
            </div>
        </div>
    );
}

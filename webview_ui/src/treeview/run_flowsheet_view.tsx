import { useContext, useEffect } from "react";
import { AppContext } from "../context";
import { host } from "../host";
import FlowsheetSteps from "./flowsheet_steps";

export default function RunFlowsheetView() {
    const { idaesRunInfo, setIsRunningFlowsheet } = useContext(AppContext);

    useEffect(() => {
        host.onMessage((message) => {
            console.log(message)
            switch (message.type) {
                case 'run_flowsheet_done':
                    setIsRunningFlowsheet(false);
                    break;
                default:
                    console.log(`Unknown message from extension: ${message}`);
            }
        })
    }, [])

    return (
        <FlowsheetSteps idaesRunInfo={idaesRunInfo} />
    )
}
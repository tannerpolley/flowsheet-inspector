import { AppContext, type ActiveLogTab } from "./context";
import { type ReactNode, useState } from "react";
import {
    type FlowsheetSteps,
    type idaesRunInfo,
    type FlowsheetRunnerResult,
    type EditorContent,
    type ActivateFileName,
    type ExtensionErrorLogsType,
    type TerminalLogsType,
    type OpenPythonFilesType,
    type MermaidDiagram,
    type DiagramDirection,
    type IdaesHistoryItem,
    type StepStatusMap,
    type CurrentPythonEnv,
    type IPackageWarning
} from "./interface/interface";


export function AppProvider({ children }: { children: ReactNode }) {
    const [liveSolveEnabled, setLiveSolveEnabled] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [idaesRunInfo, setidaesRunInfo] = useState<idaesRunInfo>({
        classname: "",
        steps: []
    });
    const [selectedSteps, setSelectedSteps] = useState<FlowsheetSteps>([]);
    const [isRunningFlowsheet, setIsRunningFlowsheet] = useState(false);
    const [flowsheetRunnerResult, setFlowsheetRunnerResult] = useState<FlowsheetRunnerResult | null>(null);
    const [editorContent, setEditorContent] = useState<EditorContent>("");
    const [activateFileName, setActivateFileName] = useState<ActivateFileName>("");
    const [mermaidDiagram, setMermaidDiagram] = useState<MermaidDiagram>('');

    // Preserve the selected layout across results-tab switches.
    const [diagramDirection, setDiagramDirection] =
        useState<DiagramDirection>('LR');
    const [extensionErrorLogs, setExtensionErrorLogs] = useState<ExtensionErrorLogsType>([]);
    const [terminalLogs, setTerminalLogs] = useState<TerminalLogsType>([]);
    const [activeLogTab, setActiveLogTab] = useState<ActiveLogTab>('error');
    const [initError, setInitError] = useState<string | null>(null);
    const [packageWarnings, setPackageWarnings] = useState<IPackageWarning[] | null>(null);
    const [openPythonFiles, setOpenPythonFiles] = useState<OpenPythonFilesType>([]);
    const [idaesHistoryList, setIdaesHistoryList] = useState<IdaesHistoryItem[] | null>(null);
    const [osPlatform, setOsPlatform] = useState<string>('');
    const [stepStatuses, setStepStatuses] = useState<StepStatusMap>({});
    const [currentPythonEnv, setCurrentPythonEnv] = useState<CurrentPythonEnv>(null);
    // Set when the extension reports the active flowsheet file was saved,
    // cleared when a new run starts or the user switches flowsheets.
    const [flowsheetSaveNotice, setFlowsheetSaveNotice] = useState(false);
    const [highlightedStream, setHighlightedStream] = useState<string | null>(null);

    return (
        <AppContext.Provider value={{
            liveSolveEnabled,
            setLiveSolveEnabled,
            isLoading,
            setIsLoading,
            selectedSteps,
            setSelectedSteps,
            idaesRunInfo,
            setidaesRunInfo,
            isRunningFlowsheet,
            setIsRunningFlowsheet,
            flowsheetRunnerResult,
            setFlowsheetRunnerResult,
            editorContent,
            setEditorContent,
            activateFileName,
            setActivateFileName,
            mermaidDiagram,
            setMermaidDiagram,
            diagramDirection,
            setDiagramDirection,
            extensionErrorLogs,
            setExtensionErrorLogs,
            terminalLogs,
            setTerminalLogs,
            activeLogTab,
            setActiveLogTab,
            initError,
            setInitError,
            packageWarnings,
            setPackageWarnings,
            openPythonFiles,
            setOpenPythonFiles,
            idaesHistoryList,
            setIdaesHistoryList,
            osPlatform,
            setOsPlatform,
            stepStatuses,
            setStepStatuses,
            currentPythonEnv,
            setCurrentPythonEnv,
            flowsheetSaveNotice,
            setFlowsheetSaveNotice,
            highlightedStream,
            setHighlightedStream
        }}>
            {children}
        </AppContext.Provider>
    );
}

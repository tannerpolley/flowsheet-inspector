import { createContext } from "react";
import {
    type FlowsheetSteps,
    type SetFlowsheetSteps,
    type idaesRunInfo,
    type SetidaesRunInfo,
    type IsRunningFlowsheet,
    type SetIsRunningFlowsheet,
    type FlowsheetRunnerResult,
    type SetFlowsheetRunnerResult,
    type EditorContent,
    type SetEditorContent,
    type ActivateFileName,
    type SetActivateFileName,
    type MermaidDiagram,
    type SetMermaidDiagram,
    type DiagramDirection,
    type SetDiagramDirection,
    type SetExtensionErrorLogs,
    type ExtensionErrorLogsType,
    type TerminalLogsType,
    type SetTerminalLogs,
    type OpenPythonFilesType,
    type SetOpenPythonFiles,
    type IdaesHistoryItem,
    type StepStatusMap,
    type SetStepStatusMap,
    type CurrentPythonEnv,
    type SetCurrentPythonEnv,
    type IPackageWarning
} from "./interface/interface";

export type ActiveLogTab = 'error' | 'terminal';
export type SetActiveLogTab = React.Dispatch<React.SetStateAction<ActiveLogTab>>;

interface AppContextType {
    liveSolveEnabled: boolean;
    setLiveSolveEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    isLoading: boolean;
    setIsLoading: (isLoading: boolean) => void;
    selectedSteps: FlowsheetSteps;
    setSelectedSteps: SetFlowsheetSteps;
    idaesRunInfo: idaesRunInfo;
    setidaesRunInfo: SetidaesRunInfo;
    isRunningFlowsheet: IsRunningFlowsheet;
    setIsRunningFlowsheet: SetIsRunningFlowsheet;
    flowsheetRunnerResult: FlowsheetRunnerResult | null;
    setFlowsheetRunnerResult: SetFlowsheetRunnerResult;
    editorContent: EditorContent;
    setEditorContent: SetEditorContent;
    activateFileName: ActivateFileName;
    setActivateFileName: SetActivateFileName;
    mermaidDiagram: MermaidDiagram;
    setMermaidDiagram: SetMermaidDiagram;
    diagramDirection: DiagramDirection;
    setDiagramDirection: SetDiagramDirection;
    extensionErrorLogs: ExtensionErrorLogsType;
    setExtensionErrorLogs: SetExtensionErrorLogs;
    terminalLogs: TerminalLogsType;
    setTerminalLogs: SetTerminalLogs;
    activeLogTab: ActiveLogTab;
    setActiveLogTab: SetActiveLogTab;
    initError: string | null;
    setInitError: React.Dispatch<React.SetStateAction<string | null>>;
    packageWarnings: IPackageWarning[] | null;
    setPackageWarnings: React.Dispatch<React.SetStateAction<IPackageWarning[] | null>>;
    openPythonFiles: OpenPythonFilesType;
    setOpenPythonFiles: SetOpenPythonFiles;
    idaesHistoryList: IdaesHistoryItem[] | null;
    setIdaesHistoryList: React.Dispatch<React.SetStateAction<IdaesHistoryItem[] | null>>;
    osPlatform: string;
    setOsPlatform: React.Dispatch<React.SetStateAction<string>>;
    stepStatuses: StepStatusMap;
    setStepStatuses: SetStepStatusMap;
    currentPythonEnv: CurrentPythonEnv;
    setCurrentPythonEnv: SetCurrentPythonEnv;
    // True when the active flowsheet file was saved after its shown results
    // were produced; drives the "rerun the flowsheet" notice under Run.
    flowsheetSaveNotice: boolean;
    setFlowsheetSaveNotice: React.Dispatch<React.SetStateAction<boolean>>;
}
// Create context with default values
export const AppContext = createContext({} as AppContextType);


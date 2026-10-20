import type { HostMessage } from '../host';

export interface DeclaredVariable {
    key: string;
    title: string;
    description: string;
    units: string;
    value: number | null;
    fixed: boolean;
    bounds: [number | null, number | null];
    category: string;
    input_category: string;
    output_category: string;
    is_input: boolean;
    is_output: boolean;
    rebuild: boolean;
    rounding: number;
}

export interface HostCapabilities { live_solve?: boolean }

export function supportsLiveSolve(capabilities?: HostCapabilities): boolean {
    return capabilities?.live_solve === true;
}

export function isEditable(variable: DeclaredVariable, liveSolve: boolean): boolean {
    return liveSolve && variable.is_input && variable.fixed;
}

export function groupVariables(variables: DeclaredVariable[], role: 'input' | 'output') {
    const groups = new Map<string, DeclaredVariable[]>();
    for (const variable of variables) {
        if (!variable[`is_${role}`]) continue;
        const category = variable[`${role}_category`] || 'Uncategorized';
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category)!.push(variable);
    }
    return groups;
}

/** Annotation rounding is significant digits, matching annotate_var. */
export function formatValue(value: number | null, rounding: number): string {
    if (value === null || !Number.isFinite(value)) return '—';
    const digits = Math.min(100, Math.max(1, Math.trunc(rounding) || 3));
    return value.toPrecision(digits);
}

export function validateValue(raw: string, bounds: DeclaredVariable['bounds']): string | undefined {
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value)) return 'Enter a finite number.';
    const [lower, upper] = bounds;
    if (lower !== null && value < lower) return `Must be at least ${lower}.`;
    if (upper !== null && value > upper) return `Must be at most ${upper}.`;
}

export function buildSolveMessage(variables: DeclaredVariable[], pending: Record<string, string>, liveSolve: boolean) {
    // Annotation keys are arbitrary strings, including Object prototype names.
    const values: Record<string, number> = Object.create(null);
    const errors: Record<string, string> = Object.create(null);
    const rebuild: string[] = [];
    for (const [key, raw] of Object.entries(pending)) {
        const variable = variables.find((item) => item.key === key);
        const error = !variable || !isEditable(variable, liveSolve)
            ? 'This input is read-only or no longer available.'
            : validateValue(raw, variable.bounds);
        if (error) { errors[key] = error; continue; }
        const value = Number(raw);
        if (value === variable!.value) continue;
        values[key] = value;
        if (variable!.rebuild) rebuild.push(key);
    }
    return {
        message: { frontendInstruction: 'solve', fromPanel: 'webView', values },
        errors,
        rebuild,
    };
}

export interface InputsState {
    pending: Record<string, string>;
    errors: Record<string, string>;
    notice: string;
    confirmRebuild: boolean;
    attempt: { report: boolean; failed: boolean } | null;
}

export const emptyInputsState: InputsState = {
    pending: {}, errors: {}, notice: '', confirmRebuild: false, attempt: null,
};

/** Only solve lifecycle messages can finish an attempt; generic errors are log entries. */
export function receiveInputsMessage(state: InputsState, message: HostMessage, liveSolve: boolean): InputsState {
    switch (message.type) {
        case 'start_new_run':
            return state.attempt ? { ...state, notice: 'Solving…' } : state;
        case 'flowsheet_runner_result': {
            if (state.attempt) return { ...state, attempt: { ...state.attempt, report: true } };
            // Reconnect snapshots retain drafts, but the current report owns editability and bounds.
            const variables: DeclaredVariable[] = message.data?.actions?.inputs?.variables ?? [];
            const pending = Object.fromEntries(Object.entries(state.pending).filter(([key]) =>
                variables.some((variable) => variable.key === key && isEditable(variable, liveSolve))));
            const errors = Object.fromEntries(Object.entries(state.errors).filter(([key]) => Object.hasOwn(pending, key)));
            return { ...state, pending, errors };
        }
        case 'solve_rejected':
            return state.attempt ? { ...state, attempt: null, errors: message.errors ?? {},
                notice: message.message || 'Solve rejected. Check the pending inputs.' } : state;
        case 'solve_failed':
            return state.attempt ? { ...state, pending: {}, errors: {},
                attempt: { ...state.attempt, failed: true },
                notice: `${message.message || 'Solve failed.'} ${message.rolled_back === true
                    ? 'Input and model values were rolled back.' : 'Rollback was not confirmed by the host.'}` } : state;
        case 'run_flowsheet_done':
            if (!state.attempt) return state;
            return { ...state, attempt: null, confirmRebuild: false,
                ...(state.attempt.report && { pending: {}, errors: {} }),
                notice: state.attempt.failed ? state.notice : state.attempt.report
                    ? 'Solve completed. Results updated.' : 'Run ended without an updated report.' };
        default:
            return state;
    }
}

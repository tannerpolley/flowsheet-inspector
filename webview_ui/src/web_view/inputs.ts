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

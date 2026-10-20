import { useContext, useEffect, useRef, useState } from 'react';
import { AppContext } from '../context';
import { host } from '../host';
import { buildSolveMessage, formatValue, groupVariables, isEditable, validateValue } from './inputs';
import css from '../css/inputs.module.css';

export default function InputsPanel() {
    const { flowsheetRunnerResult, liveSolveEnabled, isRunningFlowsheet, setIsRunningFlowsheet,
        terminalLogs, stepStatuses } = useContext(AppContext);
    const variables = flowsheetRunnerResult?.actions?.inputs?.variables ?? [];
    const [pending, setPending] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [notice, setNotice] = useState('');
    const [confirmRebuild, setConfirmRebuild] = useState(false);
    const attempt = useRef<{ report: boolean; failed: boolean } | null>(null);
    const transaction = buildSolveMessage(variables, pending, liveSolveEnabled);
    const pendingCount = Object.keys(transaction.message.values).length + Object.keys(transaction.errors).length;

    useEffect(() => host.onMessage((message) => {
        switch (message.type) {
            case 'start_new_run':
                if (attempt.current) setNotice('Solving…');
                break;
            case 'flowsheet_runner_result':
                if (attempt.current) attempt.current.report = true;
                else {
                    setPending({});
                    setErrors({});
                    setConfirmRebuild(false);
                }
                break;
            case 'solve_rejected':
                if (!attempt.current) break;
                setErrors(message.errors ?? {});
                setNotice(message.message || 'Solve rejected. Check the pending inputs.');
                attempt.current = null;
                setIsRunningFlowsheet(false);
                break;
            case 'solve_failed':
                if (!attempt.current) break;
                attempt.current.failed = true;
                setPending({});
                setErrors({});
                setNotice(`${message.message || 'Solve failed.'} ${message.rolled_back === true
                    ? 'Input and model values were rolled back.' : 'Rollback was not confirmed by the host.'}`);
                break;
            case 'run_flowsheet_done':
                if (!attempt.current) break;
                if (!attempt.current.failed) {
                    setNotice(attempt.current.report ? 'Solve completed. Results updated.' : 'Run ended without an updated report.');
                    if (attempt.current.report) { setPending({}); setErrors({}); }
                }
                attempt.current = null;
                setIsRunningFlowsheet(false);
                break;
            case 'error':
                if (!attempt.current) break;
                setNotice(message.message || 'The solve request failed.');
                attempt.current = null;
                setIsRunningFlowsheet(false);
                break;
        }
    }), []);

    function solve() {
        if (isRunningFlowsheet || attempt.current || !pendingCount) return;
        setErrors(transaction.errors);
        if (Object.keys(transaction.errors).length) return;
        if (transaction.rebuild.length && !confirmRebuild) { setConfirmRebuild(true); return; }
        setConfirmRebuild(false);
        attempt.current = { report: false, failed: false };
        setNotice('Requesting solve…');
        setIsRunningFlowsheet(true);
        host.postMessage(transaction.message);
    }

    const hasAnnotations = variables.some((variable) => variable.is_input || variable.is_output);
    return (
        <section className={css.panel} aria-label="Inputs and outputs">
            <h2>Inputs and outputs</h2>
            {!hasAnnotations && <p>No declared inputs or outputs in this report.</p>}
            {hasAnnotations && <p>{liveSolveEnabled
                ? 'Edit fixed inputs, then solve to update the results. Values use the displayed units.'
                : 'Read-only report. Live solve is not enabled by this host.'}</p>}
            {liveSolveEnabled && hasAnnotations && <div className={css.controls}>
                <span>{pendingCount} pending {pendingCount === 1 ? 'edit' : 'edits'}</span>
                <button onClick={solve} disabled={isRunningFlowsheet || !pendingCount}>Solve</button>
                <button disabled={isRunningFlowsheet || !Object.keys(pending).length} onClick={() => {
                    setPending({}); setErrors({}); setConfirmRebuild(false); setNotice('');
                }}>Discard edits</button>
                {isRunningFlowsheet && <button onClick={() => {
                    host.postMessage({ frontendInstruction: 'cancel_solve', fromPanel: 'webView' });
                    setNotice('Cancellation requested. Waiting for the host…');
                }}>Cancel</button>}
            </div>}
            {confirmRebuild && <div className={css.warning} role="alert">
                <p>These edits require rebuilding the model: {transaction.rebuild.join(', ')}. This can take longer than a re-solve.</p>
                <button onClick={solve} disabled={isRunningFlowsheet}>Confirm rebuild and solve</button>
                <button onClick={() => setConfirmRebuild(false)}>Keep editing</button>
            </div>}
            <p role="status">{notice}</p>
            {liveSolveEnabled && isRunningFlowsheet && <div role="status">
                <p>Solving… {Object.keys(stepStatuses).length} steps reported. See Logs for full progress.</p>
                <pre className={css.progress}>{terminalLogs.at(-1)?.slice(-500)}</pre>
            </div>}
            {hasAnnotations && (['input', 'output'] as const).map((role) => <section key={role}>
                <h3>{role === 'input' ? 'Inputs' : 'Outputs'}</h3>
                {groupVariables(variables, role).size === 0 && <p>No declared {role}s.</p>}
                {[...groupVariables(variables, role)].map(([category, rows]) => <div key={category} className={css.group}>
                    <h4>{category}</h4>
                    <div className={css.tableScroll}><table>
                        <thead><tr><th scope="col">Variable</th><th scope="col">Value</th><th scope="col">Units</th><th scope="col">Bounds</th></tr></thead>
                        <tbody>{rows.map((variable) => {
                            const editable = role === 'input' && isEditable(variable, liveSolveEnabled);
                            const draft = Object.hasOwn(pending, variable.key) ? pending[variable.key] : undefined;
                            const hostError = Object.hasOwn(errors, variable.key) ? errors[variable.key] : undefined;
                            const error = role === 'input' ? hostError || (draft !== undefined ? validateValue(draft, variable.bounds) : undefined) : undefined;
                            const changed = draft !== undefined && (error || Number(draft) !== variable.value);
                            const id = `declared-${role}-${variable.key}`;
                            return <tr key={variable.key}>
                                <th scope="row"><label htmlFor={editable ? id : undefined}>{variable.title || variable.key}</label>
                                    <small>{variable.key}</small><small>{variable.description}</small>
                                    {role === 'input' && variable.rebuild && <small>Requires rebuild</small>}
                                    {role === 'input' && !variable.fixed && <small>Unfixed — read-only</small>}
                                </th>
                                <td>{editable ? <>
                                    <input id={id} type="text" inputMode="decimal" disabled={isRunningFlowsheet}
                                        aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
                                        value={draft ?? formatValue(variable.value, variable.rounding).replace('—', '')}
                                        onChange={(event) => {
                                            setPending((prev) => ({ ...prev, [variable.key]: event.target.value }));
                                            setErrors((prev) => { const next = { ...prev }; delete next[variable.key]; return next; });
                                            setConfirmRebuild(false);
                                            setNotice('');
                                        }} />
                                    {changed && <small className={css.pending}>Pending (current: {formatValue(variable.value, variable.rounding)})</small>}
                                    {error && <small id={`${id}-error`} className={css.error} role="alert">{error}</small>}
                                </> : formatValue(variable.value, variable.rounding)}</td>
                                <td>{variable.units || '—'}</td>
                                <td>{variable.bounds[0] ?? '−∞'} … {variable.bounds[1] ?? '∞'}</td>
                            </tr>;
                        })}</tbody>
                    </table></div>
                </div>)}
            </section>)}
        </section>
    );
}

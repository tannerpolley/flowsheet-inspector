import { useContext, useEffect, useState } from 'react';
import { AppContext } from '../context';
import { host } from '../host';
import { buildSolveMessage, formatValue, groupVariables, isEditable, validateValue, emptyInputsState, receiveInputsMessage } from './inputs';
import css from '../css/inputs.module.css';

export default function InputsPanel() {
    const { flowsheetRunnerResult, liveSolveEnabled, isRunningFlowsheet, setIsRunningFlowsheet,
        terminalLogs, stepStatuses } = useContext(AppContext);
    const variables = flowsheetRunnerResult?.actions?.inputs?.variables ?? [];
    const [state, setState] = useState(emptyInputsState);
    const { pending, errors, notice, confirmRebuild, attempt } = state;
    const transaction = buildSolveMessage(variables, pending, liveSolveEnabled);
    const pendingCount = Object.keys(transaction.message.values).length + Object.keys(transaction.errors).length;

    useEffect(() => host.onMessage((message) => {
        setState((previous) => receiveInputsMessage(previous, message, liveSolveEnabled));
        if (message.type === 'solve_rejected') setIsRunningFlowsheet(false);
    }), [liveSolveEnabled, setIsRunningFlowsheet]);

    function solve() {
        if (isRunningFlowsheet || attempt || !pendingCount) return;
        if (Object.keys(transaction.errors).length) return;
        if (transaction.rebuild.length && !confirmRebuild) {
            setState((previous) => ({ ...previous, confirmRebuild: true }));
            return;
        }
        setState((previous) => ({ ...previous, confirmRebuild: false,
            attempt: { report: false, failed: false }, notice: 'Requesting solve…' }));
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
                    setState(emptyInputsState);
                }}>Discard edits</button>
                {isRunningFlowsheet && <button onClick={() => {
                    host.postMessage({ frontendInstruction: 'cancel_solve', fromPanel: 'webView' });
                    setState((previous) => ({ ...previous, notice: 'Cancellation requested. Waiting for the host…' }));
                }}>Cancel</button>}
            </div>}
            {confirmRebuild && <div className={css.warning} role="alert">
                <p>These edits require rebuilding the model: {transaction.rebuild.join(', ')}. This can take longer than a re-solve.</p>
                <button onClick={solve} disabled={isRunningFlowsheet}>Confirm rebuild and solve</button>
                <button onClick={() => setState((previous) => ({ ...previous, confirmRebuild: false }))}>Keep editing</button>
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
                                            const value = event.target.value;
                                            setState((previous) => {
                                                const errors = { ...previous.errors };
                                                delete errors[variable.key];
                                                return { ...previous, pending: { ...previous.pending, [variable.key]: value },
                                                    errors, confirmRebuild: false, notice: '' };
                                            });
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

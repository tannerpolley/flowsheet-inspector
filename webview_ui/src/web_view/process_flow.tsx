import { Fragment, useContext, useEffect, useRef, useState } from 'react';
import {
    Background,
    Controls,
    Handle,
    Position,
    ReactFlow,
    ReactFlowProvider,
    getNodesBounds,
    getViewportForBounds,
    useNodesState,
    useReactFlow,
    type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng, toSvg } from 'html-to-image';
import { AppContext } from '../context';
import { host, type HostMessage } from '../host';
import type { Diagnostics, FlowsheetStreamTable } from '../interface/flowsheet_result_interface';
import { layoutFlowsheet, streamColumn, type ArcEdge, type FlowsheetGraph, type GraphArc, type Positions, type UnitNode } from './flowsheet_graph';
import css from '../css/process_flow.module.css';

const EXPORT_PADDING = 40;

// Every load_layout carries a new id that its `layout` reply echoes, so a
// reply to an earlier request (an earlier report) is never applied.
let lastLayoutRequest = 0;

// One key per report: a new report remounts the view, so no diagram, saved
// positions or pending layout reply carries over from the previous one.
const reportKeys = new WeakMap<FlowsheetGraph, number>();
let lastReportKey = 0;
function reportKey(graph: FlowsheetGraph): number {
    if (!reportKeys.has(graph)) reportKeys.set(graph, ++lastReportKey);
    return reportKeys.get(graph)!;
}

function UnitNodeView({ data }: NodeProps<UnitNode>) {
    return (
        <div className={css.unit}>
            <div className={css.unit_label}>{data.label}</div>
            <div className={css.unit_class}>{data.className}</div>
            {data.ports.map((port) => {
                const style = port.side === Position.Left || port.side === Position.Right
                    ? { top: port.y }
                    : { left: port.x };
                // Both handle types on every port, so an arc may start or end at any port.
                return (
                    <Fragment key={port.name}>
                        <Handle id={port.name} type="target" position={port.side} style={style} isConnectable={false} />
                        <Handle id={port.name} type="source" position={port.side} style={style} isConnectable={false} />
                        <span className={`${css.port_label} ${css[port.side]}`} style={style}>{port.name}</span>
                    </Fragment>
                );
            })}
        </div>
    );
}

const nodeTypes = { unit: UnitNodeView };

function StreamTooltip({ arc, table, x, y }: { arc: GraphArc; table?: FlowsheetStreamTable; x: number; y: number }) {
    const column = table?.columns.indexOf(streamColumn(arc)) ?? -1;
    const rows = column < 0 || !table ? [] : table.index
        .map((label, i) => [label, table.data[i]?.[column]?.[0], table.units[i]] as const)
        .filter(([, value]) => value !== null && value !== undefined);
    return (
        <div className={css.tooltip} style={{ left: x + 12, top: y + 12 }}>
            <div className={css.tooltip_title}>{arc.name}</div>
            <div>{arc.source_unit}.{arc.source_port} → {arc.dest_unit}.{arc.dest_port}</div>
            {rows.length > 0 && (
                <table>
                    <tbody>
                        {rows.map(([label, value, units]) => (
                            <tr key={label}><td>{label}</td><td>{Number(value!.toPrecision(5))}</td><td>{units}</td></tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function Flow({ graph, streamTable, onShowStream }: {
    graph: FlowsheetGraph;
    streamTable?: FlowsheetStreamTable;
    onShowStream: (column: string) => void;
}) {
    const [nodes, setNodes, onNodesChange] = useNodesState<UnitNode>([]);
    const [edges, setEdges] = useState<ArcEdge[]>([]);
    const [error, setError] = useState<string>();
    const [saved, setSaved] = useState<Positions>({});
    const [hover, setHover] = useState<{ arc: GraphArc; x: number; y: number } | null>(null);
    const { getNodes, fitView } = useReactFlow();
    const containerRef = useRef<HTMLDivElement>(null);
    // The user moved or reset units; a late saved layout must not undo that.
    const edited = useRef(false);
    // The saved layout arrived after the first fitView, so fit again once it is drawn.
    const fitAfterLayout = useRef(false);
    const [fitRequest, setFitRequest] = useState(0);
    // Only the latest layout calculation may draw; a drag starts a new generation,
    // so a calculation still running from an earlier saved layout cannot undo it.
    const generation = useRef(0);

    // Ask once for this report's saved positions (the view remounts per report).
    useEffect(() => {
        const request = ++lastLayoutRequest;
        const unsubscribe = host.onMessage((message: HostMessage) => {
            if (message.type !== 'layout' || message.request !== request || edited.current) return;
            fitAfterLayout.current = true;
            setSaved(message.positions ?? {});
        });
        host.postMessage({ frontendInstruction: 'load_layout', fromPanel: 'webView', request });
        return unsubscribe;
    }, []);

    useEffect(() => {
        const current = ++generation.current;
        layoutFlowsheet(graph, saved).then((result) => {
            if (current !== generation.current) return;
            setNodes(result.nodes);
            setEdges(result.edges);
            setError(result.error);
            if (fitAfterLayout.current) {
                fitAfterLayout.current = false;
                setFitRequest((n) => n + 1);
            }
        });
        return () => { generation.current++; };
    }, [graph, saved, setNodes]);

    // Fit after the new positions reach React Flow; fitView measures its current nodes.
    useEffect(() => {
        if (fitRequest) fitView();
    }, [fitRequest, fitView]);

    function saveLayout(positions: Positions) {
        edited.current = true;
        setSaved(positions);
        host.postMessage({ frontendInstruction: 'save_layout', fromPanel: 'webView', positions });
    }

    async function exportImage(format: 'svg' | 'png') {
        const viewport = containerRef.current?.querySelector<HTMLElement>('.react-flow__viewport');
        if (!viewport) return;
        // Render every unit at 1:1 scale, not just what is on screen.
        const bounds = getNodesBounds(getNodes());
        const width = Math.ceil(bounds.width + 2 * EXPORT_PADDING);
        const height = Math.ceil(bounds.height + 2 * EXPORT_PADDING);
        const { x, y, zoom } = getViewportForBounds(bounds, width, height, 1, 1, 0);
        const options = {
            width,
            height,
            backgroundColor: getComputedStyle(document.documentElement).backgroundColor,
            style: { width: `${width}px`, height: `${height}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
        };
        const link = document.createElement('a');
        link.download = `process-flow.${format}`;
        link.href = format === 'svg' ? await toSvg(viewport, options) : await toPng(viewport, options);
        link.click();
    }

    if (error) {
        return (
            <EmptyState error title="Process Flow Layout Failed">
                <p className={css.error_body}>The automatic layout could not place this flowsheet graph: {error}</p>
                <p>The Diagram tab still works.</p>
            </EmptyState>
        );
    }

    return (
        <>
            <div className={css.toolbar}>
                <button onClick={() => saveLayout({})} disabled={Object.keys(saved).length === 0}>Reset layout</button>
                <button onClick={() => exportImage('svg')}>Export SVG</button>
                <button onClick={() => exportImage('png')}>Export PNG</button>
                <span className={css.hint}>
                    Drag units to move them; positions are saved with the flowsheet.
                    Hover a stream to see its values{streamTable ? '; click it to show its stream-table column' : ''}.
                </span>
            </div>
            <div ref={containerRef} className={css.flow}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodesChange={onNodesChange}
                    onNodeDragStart={() => {
                        edited.current = true;
                        fitAfterLayout.current = false;
                        generation.current++;
                    }}
                    onNodeDragStop={(_event, _node, dragged) => saveLayout({
                        ...saved,
                        ...Object.fromEntries(dragged.map((node) => [node.id, node.position])),
                    })}
                    onEdgeMouseEnter={(event, edge) => setHover({ arc: (edge as ArcEdge).data!.arc, x: event.clientX, y: event.clientY })}
                    onEdgeMouseLeave={() => setHover(null)}
                    onEdgeClick={(_event, edge) => {
                        const column = streamColumn((edge as ArcEdge).data!.arc);
                        if (streamTable?.columns.includes(column)) onShowStream(column);
                    }}
                    nodesConnectable={false}
                    colorMode={document.body.classList.contains('vscode-light') ? 'light' : document.body.classList.contains('vscode-dark') ? 'dark' : 'system'}
                    fitView
                    proOptions={{ hideAttribution: true }}
                >
                    <Background />
                    <Controls showInteractive={false} />
                </ReactFlow>
                {hover && <StreamTooltip {...hover} table={streamTable} />}
            </div>
        </>
    );
}

function EmptyState({ title, children, error }: { title: string; children: React.ReactNode; error?: boolean }) {
    return error ? (
        <div className={css.error_box}>
            <p className={css.error_title}>{title}</p>
            {children}
        </div>
    ) : (
        <div className={css.empty}>
            <p className={css.empty_title}>{title}</p>
            {children}
        </div>
    );
}

/** Interactive process-flow view of actions.flowsheet_graph. */
export default function ProcessFlow({ onShowStream }: { onShowStream: (column: string) => void }) {
    const { flowsheetRunnerResult } = useContext(AppContext);
    const graph = flowsheetRunnerResult?.actions?.flowsheet_graph;
    const diagnostics = flowsheetRunnerResult?.actions?.diagnostics as Diagnostics | undefined;

    let body;
    if (!flowsheetRunnerResult) {
        body = (
            <EmptyState title="No Process Flow Available Yet">
                <p>Click <strong>Run</strong> in the IDAES Tree View to execute the flowsheet and generate a diagram.</p>
            </EmptyState>
        );
    } else if (!graph && diagnostics?.valid === false) {
        const lastRun = flowsheetRunnerResult.last_run ?? [];
        body = (
            <EmptyState error title="fi-run has issues: Process Flow Unavailable">
                <p className={css.error_body}>
                    The flowsheet run may have failed or did not reach the solve step.
                    {lastRun.length > 0 && ` Last completed steps: ${lastRun.join(' → ')}.`}
                </p>
                <p>Check the error log for details.</p>
            </EmptyState>
        );
    } else if (!graph) {
        body = (
            <EmptyState error title="Process Flow Data Missing">
                <p className={css.error_body}>The IDAES runner result does not contain a flowsheet graph.</p>
                <p>
                    <strong>Reason:</strong> the installed <code>flowsheet-inspector-lib</code> predates
                    the <code>flowsheet_graph</code> action. Update it and run the flowsheet again; the Diagram tab still works.
                </p>
            </EmptyState>
        );
    } else if (graph.units.length === 0) {
        body = <EmptyState title="No Units Found"><p>The flowsheet graph has no unit models.</p></EmptyState>;
    } else {
        body = (
            <ReactFlowProvider key={reportKey(graph)}>
                <Flow graph={graph} streamTable={flowsheetRunnerResult.actions.stream_table} onShowStream={onShowStream} />
            </ReactFlowProvider>
        );
    }

    return (
        <div className={css.container}>
            <h2 className="page-title">Process Flow:</h2>
            {body}
        </div>
    );
}

// The one place that knows the lib's `flowsheet_graph` report shape. It maps
// that shape to an ELK layered layout (left to right, port-aware) and then to
// React Flow nodes and edges. A change to the lib shape is an edit here only.
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';

// ─── Lib report shape: actions.flowsheet_graph ───

export interface GraphPort {
    name: string; // relative to its unit
    direction: 'in' | 'out' | 'bidirectional' | 'unknown';
}

export interface GraphUnit {
    name: string; // fully qualified block name, e.g. "fs.sx.stage1"
    class_name: string;
    parent_block: string;
    ports: GraphPort[];
}

export interface GraphArc {
    name: string; // also the arc's column name in actions.stream_table
    source_unit: string;
    source_port: string;
    dest_unit: string;
    dest_port: string;
    directed: boolean;
}

export interface FlowsheetGraph {
    units: GraphUnit[];
    arcs: GraphArc[];
}

// ─── View shape ───

export type Positions = Record<string, { x: number; y: number }>;

export interface PortView {
    name: string;
    side: Position;
    /** Port position on the node's border, relative to its top-left corner. */
    x: number;
    y: number;
}

export type UnitNode = Node<{ label: string; className: string; ports: PortView[] }, 'unit'>;
export type ArcEdge = Edge<{ arc: GraphArc }>;

// Inlets on the left, outlets on the right, everything else top or bottom.
const SIDES: Record<GraphPort['direction'], Position> = {
    in: Position.Left,
    out: Position.Right,
    bidirectional: Position.Top,
    unknown: Position.Bottom,
};
const ELK_SIDES: Record<Position, string> = {
    [Position.Left]: 'WEST',
    [Position.Right]: 'EAST',
    [Position.Top]: 'NORTH',
    [Position.Bottom]: 'SOUTH',
};

const PORT_GAP = 22; // vertical space per left/right port
const CHAR_WIDTH = 6.5; // rough width of one label character

const elk = new ELK();

/** Drop leading block names every unit shares ("fs.") to get short labels. */
function sharedPrefix(units: GraphUnit[]): string {
    const paths = units.map((unit) => unit.parent_block.split('.'));
    const shared: string[] = [];
    for (let i = 0; paths.length && paths[0][i] && paths.every((path) => path[i] === paths[0][i]); i++) {
        shared.push(paths[0][i]);
    }
    return shared.length ? `${shared.join('.')}.` : '';
}

/**
 * Lays out the flowsheet graph with ELK and returns React Flow nodes and
 * edges. Units in `saved` keep their saved position; the rest get ELK's.
 *
 * Units nested inside another unit (e.g. a flash's internal splitter) are
 * hidden unless an arc touches them. Arcs whose unit or port is missing from
 * the report are dropped.
 */
export async function layoutFlowsheet(
    graph: FlowsheetGraph,
    saved: Positions = {},
): Promise<{ nodes: UnitNode[]; edges: ArcEdge[] }> {
    const unitNames = new Set(graph.units.map((unit) => unit.name));
    const connected = new Set(graph.arcs.flatMap((arc) => [arc.source_unit, arc.dest_unit]));
    const units = graph.units.filter(
        (unit) => !unitNames.has(unit.parent_block) || connected.has(unit.name),
    );
    const portIds = new Set(units.flatMap((unit) => unit.ports.map((port) => `${unit.name}/${port.name}`)));
    const arcs = graph.arcs.filter(
        (arc) => portIds.has(`${arc.source_unit}/${arc.source_port}`) && portIds.has(`${arc.dest_unit}/${arc.dest_port}`),
    );
    const prefix = sharedPrefix(units);

    const elkGraph: ElkNode = {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': 'RIGHT',
            'elk.spacing.nodeNode': '40',
            'elk.layered.spacing.nodeNodeBetweenLayers': '80',
            // Walk from the first unit in model order, so recycles (not the
            // main flow) are the arcs drawn backwards.
            'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
        },
        children: units.map((unit) => {
            const count = (side: Position) => unit.ports.filter((port) => SIDES[port.direction] === side).length;
            const longest = (side: Position) => Math.max(0, ...unit.ports
                .filter((port) => SIDES[port.direction] === side)
                .map((port) => port.name.length));
            const label = unit.name.slice(prefix.length);
            // Side port labels sit beside the centred unit name, so leave room for both.
            const width = Math.max(
                140,
                (longest(Position.Left) + longest(Position.Right)) * CHAR_WIDTH + Math.max(label.length * 8, 60) + 40,
                (Math.max(count(Position.Top), count(Position.Bottom)) + 1) * 80,
            );
            const height = Math.max(64, (Math.max(count(Position.Left), count(Position.Right)) + 1) * PORT_GAP + 20)
                + (count(Position.Top) ? 16 : 0) + (count(Position.Bottom) ? 16 : 0);
            return {
                id: unit.name,
                width,
                height,
                layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
                ports: unit.ports.map((port) => ({
                    id: `${unit.name}/${port.name}`,
                    width: 0,
                    height: 0,
                    layoutOptions: { 'elk.port.side': ELK_SIDES[SIDES[port.direction]] },
                })),
            };
        }),
        edges: arcs.map((arc) => ({
            id: arc.name,
            sources: [`${arc.source_unit}/${arc.source_port}`],
            targets: [`${arc.dest_unit}/${arc.dest_port}`],
        })),
    };
    const laidOut = await elk.layout(elkGraph);

    const byName = new Map(units.map((unit) => [unit.name, unit]));
    const nodes: UnitNode[] = (laidOut.children ?? []).map((child) => {
        const unit = byName.get(child.id)!;
        return {
            id: unit.name,
            type: 'unit',
            position: saved[unit.name] ?? { x: child.x ?? 0, y: child.y ?? 0 },
            width: child.width,
            height: child.height,
            data: {
                label: unit.name.slice(prefix.length),
                className: unit.class_name.replace(/^_Scalar/, ''),
                ports: (child.ports ?? []).map((port) => {
                    const name = port.id.slice(unit.name.length + 1);
                    const direction = unit.ports.find((p) => p.name === name)!.direction;
                    return {
                        name,
                        side: SIDES[direction],
                        x: port.x ?? 0,
                        y: port.y ?? 0,
                    };
                }),
            },
        };
    });
    const edges: ArcEdge[] = arcs.map((arc) => ({
        id: arc.name,
        source: arc.source_unit,
        sourceHandle: arc.source_port,
        target: arc.dest_unit,
        targetHandle: arc.dest_port,
        type: 'smoothstep',
        markerEnd: arc.directed ? { type: MarkerType.ArrowClosed } : undefined,
        data: { arc },
    }));
    return { nodes, edges };
}

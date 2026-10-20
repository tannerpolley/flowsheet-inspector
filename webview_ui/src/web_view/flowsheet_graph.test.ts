import { expect, test, vi } from 'vitest';
import { Position } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { layoutFlowsheet, type FlowsheetGraph, type GraphArc, type GraphUnit } from './flowsheet_graph';

const port = (name: string, direction: 'in' | 'out' | 'bidirectional' | 'unknown') => ({ name, direction });
const contactor = (name: string): GraphUnit => ({
    name: `fs.section.${name}`,
    class_name: '_ScalarMSContactor',
    parent_block: 'fs.section',
    ports: ['aqueous_inlet', 'organic_inlet'].map((p) => port(p, 'in'))
        .concat(['aqueous_outlet', 'organic_outlet'].map((p) => port(p, 'out'))),
});
const arc = (name: string, source: string, sourcePort: string, dest: string, destPort: string): GraphArc => ({
    name, source_unit: source, source_port: sourcePort, dest_unit: dest, dest_port: destPort, directed: true,
});

// Shape of the lib's MSContactor fixture: every unit and arc sits on a sub-block.
const contactors: FlowsheetGraph = {
    units: [contactor('first'), contactor('second'), contactor('third')],
    arcs: [
        arc('fs.section.aq1', 'fs.section.first', 'aqueous_outlet', 'fs.section.second', 'aqueous_inlet'),
        arc('fs.section.aq2', 'fs.section.second', 'aqueous_outlet', 'fs.section.third', 'aqueous_inlet'),
        arc('fs.section.organic[1]', 'fs.section.second', 'organic_outlet', 'fs.section.first', 'organic_inlet'),
    ],
};

test('sub-block units get short labels, port handles, and a left-to-right layout', async () => {
    const { nodes, edges } = await layoutFlowsheet(contactors);
    const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));

    expect(nodes.map((node) => [node.data.label, node.data.className])).toEqual([
        ['first', 'MSContactor'], ['second', 'MSContactor'], ['third', 'MSContactor'],
    ]);
    // The aqueous stream runs first → second → third, so they sit in that order left to right.
    expect(byId['fs.section.first'].position.x).toBeLessThan(byId['fs.section.second'].position.x);
    expect(byId['fs.section.second'].position.x).toBeLessThan(byId['fs.section.third'].position.x);
    expect(edges.find((edge) => edge.id === 'fs.section.organic[1]')).toMatchObject({
        source: 'fs.section.second', sourceHandle: 'organic_outlet',
        target: 'fs.section.first', targetHandle: 'organic_inlet',
    });
});

test('ports sit on the side their direction asks for', async () => {
    const graph: FlowsheetGraph = {
        units: [{
            name: 'fs.sep', class_name: '_ScalarSeparator', parent_block: 'fs',
            ports: [port('inlet', 'in'), port('recycle', 'out'), port('vent', 'bidirectional'), port('purge', 'unknown')],
        }],
        arcs: [],
    };
    const [node] = (await layoutFlowsheet(graph)).nodes;
    const ports = Object.fromEntries(node.data.ports.map((p) => [p.name, p]));

    expect(node.data.label).toBe('sep');
    // ELK may report -0, so compare positions numerically rather than with toEqual.
    expect([ports.inlet.side, ports.recycle.side, ports.vent.side, ports.purge.side])
        .toEqual([Position.Left, Position.Right, Position.Top, Position.Bottom]);
    expect(ports.inlet.x).toBeCloseTo(0);
    expect(ports.recycle.x).toBeCloseTo(node.width!);
    expect(ports.vent.y).toBeCloseTo(0);
    expect(ports.purge.y).toBeCloseTo(node.height!);
});

test('saved positions override the layout for those units only, and non-finite ones are ignored', async () => {
    const auto = await layoutFlowsheet(contactors);
    const saved = await layoutFlowsheet(contactors, {
        'fs.section.second': { x: -500, y: 900 },
        // A hand-edited layout file.
        'fs.section.third': { x: 'broken', y: null } as unknown as { x: number; y: number },
    });
    const position = (result: typeof auto, id: string) => result.nodes.find((node) => node.id === id)!.position;

    expect(position(saved, 'fs.section.second')).toEqual({ x: -500, y: 900 });
    expect(position(saved, 'fs.section.first')).toEqual(position(auto, 'fs.section.first'));
    expect(position(saved, 'fs.section.third')).toEqual(position(auto, 'fs.section.third'));
});

test('drops arcs to missing units or ports', async () => {
    const graph: FlowsheetGraph = {
        units: [contactors.units[0], contactors.units[1]],
        arcs: [
            contactors.arcs[0],
            arc('fs.section.gone', 'fs.section.first', 'organic_outlet', 'fs.section.missing', 'inlet'),
            arc('fs.section.bad_port', 'fs.section.first', 'no_such_port', 'fs.section.second', 'organic_inlet'),
        ],
    };
    const { edges } = await layoutFlowsheet(graph);

    expect(edges.map((edge) => edge.id)).toEqual(['fs.section.aq1']);
});

test('units nested in units are drawn, even without arcs, unless the lib marks them internal', async () => {
    const nested = (name: string): GraphUnit => ({
        name: `fs.section.first.${name}`, class_name: '_ScalarSeparator', parent_block: 'fs.section.first', ports: [port('inlet', 'in')],
    });
    const graph: FlowsheetGraph = {
        units: [contactors.units[0], nested('mixer'), { ...nested('split'), internal: true }],
        arcs: [],
    };
    const { nodes } = await layoutFlowsheet(graph);

    expect(nodes.map((node) => node.id)).toEqual(['fs.section.first', 'fs.section.first.mixer']);
});

test('an ELK failure gives an error and no diagram', async () => {
    vi.spyOn(ELK.prototype, 'layout').mockRejectedValueOnce(new Error('ELK exploded'));

    expect(await layoutFlowsheet(contactors)).toEqual({ nodes: [], edges: [], error: 'ELK exploded' });
});

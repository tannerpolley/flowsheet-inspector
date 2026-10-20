import { expect, test } from 'vitest';
import { buildSolveMessage, formatValue, groupVariables, isEditable, supportsLiveSolve, validateValue, type DeclaredVariable } from './inputs';

const feed: DeclaredVariable = {
    key: 'feed[0]', title: 'Feed', description: '', units: 'L/h', value: 1.23456,
    fixed: true, bounds: [0, 10], category: 'Legacy', input_category: 'Feed',
    output_category: 'Recovery', is_input: true, is_output: true, rebuild: false, rounding: 3,
};

test('groups each declared role independently, preserving indexed keys and report order', () => {
    const rows = [feed, { ...feed, key: 'stages', is_output: false, input_category: '' },
        { ...feed, key: 'product', is_input: false }, { ...feed, key: 'ignored', is_input: false, is_output: false }];
    expect([...groupVariables(rows, 'input')].map(([name, values]) => [name, values.map((v) => v.key)]))
        .toEqual([['Feed', ['feed[0]']], ['Uncategorized', ['stages']]]);
    expect(groupVariables(rows, 'output').get('Recovery')?.map((v) => v.key)).toEqual(['feed[0]', 'product']);
    expect(groupVariables([], 'input').size).toBe(0);
});

test('formats significant digits without hiding small values or nulls', () => {
    expect(formatValue(1.23456, 3)).toBe('1.23');
    expect(formatValue(0.00000123456, 3)).toBe('0.00000123');
    expect(formatValue(123456, 3)).toBe('1.23e+5');
    expect(formatValue(0, 3)).toBe('0.00');
    expect(formatValue(null, 3)).toBe('—');
    expect(formatValue(Infinity, 3)).toBe('—');
    expect(() => formatValue(1, -1)).not.toThrow();
});

test('only a live host and fixed declared input allow editing', () => {
    for (const capabilities of [undefined, {}, { live_solve: false }]) {
        expect(isEditable(feed, supportsLiveSolve(capabilities))).toBe(false);
    }
    expect(isEditable(feed, supportsLiveSolve({ live_solve: true }))).toBe(true);
    expect(isEditable({ ...feed, fixed: false }, true)).toBe(false);
    expect(isEditable({ ...feed, is_input: false }, true)).toBe(false);
});

test('validates finite numbers and inclusive, nullable bounds before submitting', () => {
    for (const raw of ['', ' ', 'NaN', 'Infinity', '-Infinity', '1e999', 'abc']) {
        expect(validateValue(raw, [null, null])).toBe('Enter a finite number.');
    }
    expect(validateValue('-0.1', [0, null])).toBe('Must be at least 0.');
    expect(validateValue('11', [null, 10])).toBe('Must be at most 10.');
    for (const raw of ['0', '10', '1e-3']) expect(validateValue(raw, [0, 10])).toBeUndefined();
    expect(validateValue('-100', [null, null])).toBeUndefined();
});

test('builds one transaction with all changed edits, including structural and indexed inputs', () => {
    const stages = { ...feed, key: 'stages', value: 2, rebuild: true };
    const result = buildSolveMessage([feed, stages], { 'feed[0]': '2.50', stages: '3' }, true);
    expect(result).toEqual({
        message: { frontendInstruction: 'solve', fromPanel: 'webView', values: { 'feed[0]': 2.5, stages: 3 } },
        errors: {}, rebuild: ['stages'],
    });
    expect(buildSolveMessage([feed], { 'feed[0]': String(feed.value) }, true).message.values).toEqual({});
    expect(buildSolveMessage([feed], {}, true).message.values).toEqual({});
});

test('rejects stale, unfixed, output-only and out-of-bounds drafts instead of sending them', () => {
    const rows = [feed, { ...feed, key: 'unfixed', fixed: false }, { ...feed, key: 'output', is_input: false }];
    const result = buildSolveMessage(rows, { missing: '1', unfixed: '2', output: '3', 'feed[0]': '11' }, true);
    expect(Object.keys(result.errors)).toEqual(['missing', 'unfixed', 'output', 'feed[0]']);
    expect(result.message.values).toEqual({});
    expect(buildSolveMessage([feed], { 'feed[0]': '2' }, false).errors['feed[0]']).toContain('read-only');
});

test('preserves arbitrary annotation keys when serializing solve values and errors', () => {
    const variable = { ...feed, key: '__proto__' };
    const pending = { ['__proto__']: '2' };
    const valid = buildSolveMessage([variable], pending, true);
    expect(JSON.parse(JSON.stringify(valid.message)).values).toEqual({ ['__proto__']: 2 });
    expect(Object.keys(buildSolveMessage([], pending, true).errors)).toEqual(['__proto__']);
});

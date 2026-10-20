import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// host.ts picks its transport at import time, so each test stubs the globals
// first and then imports a fresh copy of the module.
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

test('uses the VS Code bridge when acquireVsCodeApi is injected', async () => {
    const api = { postMessage: vi.fn() };
    vi.stubGlobal('acquireVsCodeApi', () => api);
    vi.stubGlobal('window', new EventTarget());
    const { host } = await import('./host');

    host.postMessage({ frontendInstruction: 'ready', fromPanel: 'treeView' });
    expect(api.postMessage).toHaveBeenCalledWith({ frontendInstruction: 'ready', fromPanel: 'treeView' });

    const received = vi.fn();
    const unsubscribe = host.onMessage(received);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'start_new_run' } }));
    unsubscribe();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'start_new_run' } }));
    expect(received.mock.calls).toEqual([[{ type: 'start_new_run' }]]);
});

test('uses HTTP plus server-sent events in a plain browser', async () => {
    const sources: { url: string; onmessage?: (event: { data: string }) => void }[] = [];
    vi.stubGlobal('EventSource', class {
        url: string;
        constructor(url: URL) { this.url = String(url); sources.push(this); }
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:8765/?token=s3cret' } });
    const { host } = await import('./host');

    expect(sources.map((s) => s.url)).toEqual(['http://127.0.0.1:8765/api/events?token=s3cret']);

    const message = { frontendInstruction: 'run_flowsheet', fromPanel: 'treeView', selectedSteps: 'solve' };
    host.postMessage(message);
    expect(fetchMock).toHaveBeenCalledWith(new URL('http://127.0.0.1:8765/api/message'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FI-Token': 's3cret' },
        body: JSON.stringify(message),
    });

    const received = vi.fn();
    host.onMessage(received);
    sources[0].onmessage!({ data: JSON.stringify({ type: 'run_flowsheet_done' }) });
    expect(received).toHaveBeenCalledWith({ type: 'run_flowsheet_done' });

    // A rejected request shows up as an `error` message, like extension errors do.
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 409 }));
    host.postMessage(message);
    await vi.waitFor(() => expect(received).toHaveBeenLastCalledWith({
        type: 'error',
        message: 'Request to fi-serve failed: Error: HTTP 409',
    }));
});

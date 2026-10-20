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
    type FakeSource = { url: string; readyState: number; onopen?: () => void; onerror?: () => void;
        onmessage?: (event: { data: string }) => void };
    const sources: FakeSource[] = [];
    vi.stubGlobal('EventSource', class {
        static CLOSED = 2;
        url: string;
        readyState = 0;
        constructor(url: URL) { this.url = String(url); sources.push(this); }
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { href: 'http://127.0.0.1:8765/?token=s3cret' } });
    const { host } = await import('./host');
    const received = vi.fn();
    host.onMessage(received);

    const [source] = sources;
    expect(source.url).toBe('http://127.0.0.1:8765/api/events?token=s3cret');

    // Nothing is sent until the event stream is open, so the reply can't be missed.
    const message = { frontendInstruction: 'run_flowsheet', fromPanel: 'treeView', selectedSteps: 'solve' };
    host.postMessage(message);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    source.onopen!();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(new URL('http://127.0.0.1:8765/api/message'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FI-Token': 's3cret' },
        body: JSON.stringify(message),
    }));

    source.onmessage!({ data: JSON.stringify({ type: 'run_flowsheet_done' }) });
    expect(received).toHaveBeenLastCalledWith({ type: 'run_flowsheet_done' });
    source.onmessage!({ data: 'not json' });
    expect(received).toHaveBeenLastCalledWith({ type: 'error', message: 'Unreadable message from fi-serve: not json' });

    // A rejected run is reported and ended, so the Run button comes back.
    received.mockClear();
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 409 }));
    host.postMessage(message);
    await vi.waitFor(() => expect(received.mock.calls).toEqual([
        [{ type: 'error', message: 'Request to fi-serve failed: Error: HTTP 409' }],
        [{ type: 'run_flowsheet_done' }],
    ]));

    // A stream the browser gives up on is reported; retries are not.
    received.mockClear();
    source.onerror!();
    expect(received).not.toHaveBeenCalled();
    source.readyState = 2;
    source.onerror!();
    expect(received).toHaveBeenCalledWith({ type: 'error', message: 'Lost connection to fi-serve event stream (/api/events)' });
});

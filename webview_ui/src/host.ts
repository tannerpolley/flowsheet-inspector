// Transport between the React UI and whatever hosts it. Inside a VS Code
// webview this is the webview's postMessage bridge; in a plain browser it is
// HTTP to the local `fi-serve` process (see docs/design/standalone-process-explorer.md §5.2).
// Message shapes are identical in both hosts.

// Messages are the loose objects the extension already sends ({ type, ... })
// and receives ({ frontendInstruction, fromPanel, ... }).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HostMessage = any;
type Listener = (message: HostMessage) => void;

export interface Host {
    postMessage(message: unknown): void;
    /** Subscribe to messages from the host; returns an unsubscribe function. */
    onMessage(listener: Listener): () => void;
}

// Injected by the VS Code webview host; absent in a plain browser.
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

function vscodeHost(): Host {
    // acquireVsCodeApi can only be called once per webview
    const api = acquireVsCodeApi();
    return {
        postMessage: (message) => api.postMessage(message),
        onMessage(listener) {
            const handler = (event: MessageEvent) => listener(event.data);
            window.addEventListener('message', handler);
            return () => window.removeEventListener('message', handler);
        },
    };
}

/**
 * Browser host: POST each outgoing message to `api/message` and receive pushed
 * messages from the `api/events` server-sent-event stream. Both routes are
 * resolved against the page URL, which also carries the session `token`.
 */
function httpHost(pageUrl: string): Host {
    const page = new URL(pageUrl);
    const token = page.searchParams.get('token') ?? '';
    const listeners = new Set<Listener>();
    const dispatch = (message: HostMessage) => listeners.forEach((listener) => listener(message));

    // EventSource cannot send headers, so the token rides in the query string.
    const eventsUrl = new URL('api/events', page);
    eventsUrl.searchParams.set('token', token);
    const events = new EventSource(eventsUrl);
    events.onmessage = (event) => {
        try {
            dispatch(JSON.parse(event.data));
        } catch {
            dispatch({ type: 'error', message: `Unreadable message from fi-serve: ${event.data}` });
        }
    };
    // Requests wait for the stream to open, so no reply (e.g. `init` after
    // `ready`) is broadcast before we are listening. They start in call order
    // but run concurrently, so a long run never blocks a later kill_process.
    const opened = new Promise<void>((resolve) => { events.onopen = () => resolve(); });
    events.onerror = () => {
        // CONNECTING means the browser is retrying on its own; CLOSED is final.
        if (events.readyState === EventSource.CLOSED) {
            dispatch({ type: 'error', message: `Lost connection to fi-serve event stream (${eventsUrl.pathname})` });
        }
    };

    const send = (message: HostMessage) => fetch(new URL('api/message', page), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FI-Token': token },
        body: JSON.stringify(message),
    })
        .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        })
        // Surface failures as the extension does: an error, and a rejected run
        // ends so the Run button comes back.
        .catch((error) => {
            dispatch({ type: 'error', message: `Request to fi-serve failed: ${error}` });
            if (message?.frontendInstruction === 'run_flowsheet') dispatch({ type: 'run_flowsheet_done' });
        });

    return {
        postMessage(message) {
            opened.then(() => send(message));
        },
        onMessage(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

export const host: Host = typeof acquireVsCodeApi === 'function'
    ? vscodeHost()
    : httpHost(window.location.href);

import { host } from '../host'
/**
 * @Desctription to post a read message to tell extension mermaid is realoaded. Once extension received webview and mermaid reload done message it will tell tree panel run flowsheet is finished.
 */
export function postReloadMermaidDone(message: { [key: string]: string }) {
    host.postMessage(message)
}
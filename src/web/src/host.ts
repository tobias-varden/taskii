// The connection to the shell.
//
// Inside the app this is the WebView2 message bridge. In a plain browser (pnpm dev) there is
// no shell, so a stand-in with sample data is used and the page can be worked on by itself.

import type { AssetResult, DayContent, DayDto, FolderResult, InitResult, PeekResult, SaveResult } from './types';

interface Requests {
  init: { payload: undefined; result: InitResult };
  chooseFolder: { payload: { useSuggested: boolean }; result: FolderResult | null };
  loadDay: { payload: { date: string }; result: DayDto };
  saveDay: { payload: { date: string; baseVersion: string; overwrite: boolean; content: DayContent }; result: SaveResult };
  peek: { payload: { date: string }; result: PeekResult };
  /** Stores a pasted image. `data` is base64. */
  saveAsset: { payload: { mediaType: string; data: string }; result: AssetResult };
  openLink: { payload: { url: string }; result: null };
  openDataFolder: { payload: undefined; result: null };
  flushed: { payload: undefined; result: null };
}

/** Things the shell tells the page without being asked. */
export type HostEvent = 'activated' | 'flush';

export interface Host {
  request<K extends keyof Requests>(type: K, ...payload: Requests[K]['payload'] extends undefined ? [] : [Requests[K]['payload']]): Promise<Requests[K]['result']>;
  on(event: HostEvent, handler: () => void): void;
}

interface WebView {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

interface Reply {
  id?: number;
  ok?: boolean;
  result?: unknown;
  error?: string;
  event?: HostEvent;
}

function webViewHost(webview: WebView): Host {
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const handlers = new Map<HostEvent, Array<() => void>>();

  webview.addEventListener('message', ({ data }) => {
    const reply = data as Reply;
    if (reply.event) {
      handlers.get(reply.event)?.forEach((handler) => handler());
      return;
    }
    const waiting = reply.id === undefined ? undefined : pending.get(reply.id);
    if (!waiting) return;
    pending.delete(reply.id!);
    if (reply.ok) waiting.resolve(reply.result ?? null);
    else waiting.reject(new Error(reply.error ?? 'The request failed.'));
  });

  return {
    request(type: string, payload?: unknown) {
      return new Promise<never>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        webview.postMessage({ id, type, payload: payload ?? null });
      });
    },
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
}

export async function connect(): Promise<Host> {
  const webview = (window as { chrome?: { webview?: WebView } }).chrome?.webview;
  if (webview) return webViewHost(webview);
  if (import.meta.env.DEV) return (await import('./mockHost')).mockHost();
  throw new Error('Taskii needs to run inside its app window.');
}

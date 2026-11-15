// A stand-in for the shell, used only when the page runs in a plain browser during
// development. It holds the day from the design mockups in memory. `?first-run` shows the
// welcome screen, `?conflict` makes the next save collide with a change "from another device".
// Search, item history and note ages are canned answers from mockFixtures.ts; only the shell's index searches.

import type { Host } from './host';
import { localStamp } from './editor/ids';
import { iso, sampleDays } from './mockDays';
import { cannedItem, cannedNoteAges, cannedSearch } from './mockFixtures';
import type { DayDto, StandupDto } from './types';

export function mockHost(): Host {
  const params = new URLSearchParams(location.search);
  const today = iso(new Date());
  const days = sampleDays();
  let folder: string | null = params.has('first-run') ? null : 'C:\\Users\\you\\OneDrive\\Taskii';
  let collide = params.has('conflict');

  // The last standup was three days ago, so there is something new to read out. `?no-standup` is the first one ever.
  const then = [...days.keys()].sort().at(-4)!;
  let standup: StandupDto = params.has('no-standup')
    ? { since: null, baseline: null }
    : { since: `${then}T09:15`, baseline: structuredClone(days.get(then)!.content) };

  const load = (date: string): DayDto => {
    const day = days.get(date);
    const dates = [...days.keys()].sort();
    return {
      date,
      exists: !!day,
      version: day ? String(day.version) : '',
      editable: date === today,
      carriedFrom: null,
      prev: dates.filter((d) => d < date).pop() ?? null,
      next: dates.find((d) => d > date) ?? null,
      ...structuredClone(day?.content ?? { todo: [], backlog: [], notes: [] }),
    };
  };

  const handle = (type: string, payload: any): unknown => {
    switch (type) {
      case 'init':
        return { today, dataFolder: folder, suggestedFolder: 'C:\\Users\\you\\OneDrive\\Taskii', day: folder ? load(today) : null, assetBase: '' };
      case 'chooseFolder':
        folder = 'C:\\Users\\you\\OneDrive\\Taskii';
        return { dataFolder: folder, day: load(today) };
      case 'loadDay':
        return load(payload.date);
      case 'listDays':
        return [...days.keys()].sort();
      case 'peek':
        return { today, version: String(days.get(payload.date)?.version ?? '') };
      case 'saveDay': {
        const day = days.get(payload.date);
        if (collide && day) {
          collide = false;
          day.version++;
          day.content.todo.unshift({ id: 'zz99', done: false, title: 'Laptop: added on the other machine', fields: [], body: '' });
        }
        const version = String(day?.version ?? '');
        if (version !== payload.baseVersion && !payload.overwrite) return { status: 'conflict', version };
        const next = (day?.version ?? 0) + 1;
        days.set(payload.date, { content: structuredClone(payload.content), version: next });
        console.debug('[mock host] saved', payload.date, payload.content);
        return { status: 'saved', version: String(next) };
      }
      case 'saveAsset':
        // No folder to store it in here, so the image travels inline.
        return { path: `data:${payload.mediaType};base64,${payload.data}` };
      case 'captureContext':
        return {
          ready: true,
          assetBase: '',
          tags: [{ tag: 'ACME', open: 9 }, { tag: 'Federation', open: 2 }, { tag: 'Portal infra', open: 1 }],
          tasks: days.get(today)!.content.todo.filter((t) => !t.done).map((t) => ({ id: t.id, title: t.title, backlog: false })),
        };
      case 'capture':
        console.debug('[mock host] captured', payload);
        return true;
      case 'noteAges':
        return cannedNoteAges(payload.date);
      case 'standup':
        return structuredClone(standup);
      case 'finishStandup':
        standup = { since: localStamp(), baseline: structuredClone(days.get(today)!.content) };
        return structuredClone(standup);
      case 'search':
        return cannedSearch(payload);
      case 'searchItem':
        return cannedItem(payload.key);
      case 'openLink':
        window.open(payload.url, '_blank', 'noopener');
        return null;
      default:
        return null;
    }
  };

  return {
    request: ((type: string, payload?: unknown) =>
      new Promise<unknown>((resolve) => setTimeout(() => resolve(handle(type, payload)), 30))) as Host['request'],
    on(event, handler) {
      if (event === 'activated') window.addEventListener('focus', handler);
      // The bar is "shown" as soon as the page is, when there is no window to show it.
      if (event === 'shown') setTimeout(handler, 50);
    },
  };
}

// A stand-in for the shell, used only when the page runs in a plain browser during
// development. It holds the day from the design mockups in memory. `?first-run` shows the
// welcome screen, `?conflict` makes the next save collide with a change "from another device".

import { blockersOf, tagOf } from './task';
import type { Host } from './host';
import { finder, termsOf } from './search';
import { localStamp } from './editor/ids';
import type { DayContent, DayDto, ItemHistory, ItemVersion, RelatedItem, SearchHit, SearchRequest, SearchResponse, StandupDto } from './types';

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const sample = (): DayContent => ({
  todo: [
    {
      id: 't7k2',
      done: false,
      title: 'ACME: Fix users with space in username',
      fields: [],
      body: 'Get stats 1 234 (~500 have space in the middle)\nTell Support about it\nRun the script',
    },
    { id: 's3c9', done: false, title: 'ACME: Security fixes', fields: [], body: '' },
    { id: 'p1v5', done: false, title: 'ACME: Catalog: exact-match search for Admin and Support', fields: [], body: 'Waiting on review of widget-service#413' },
    { id: 'c9d0', done: false, title: 'Federation: Get client secret from Contoso', fields: [], body: '' },
    {
      id: 'a1b3',
      done: false,
      title: 'Federation: Add Contoso Edu to our TEST environment',
      fields: [{ key: 'blocked-by', value: '^c9d0' }],
      body: 'Onboard them, details in Mail\nNo one has received the shared folder, we have reached out to Contoso',
    },
    {
      id: 'q2w3',
      done: true,
      title: 'Dev: Switch all repos to use SharedBuild agent pool',
      fields: [{ key: 'done', value: '2026-11-16T08:40' }],
      body: '',
    },
  ],
  backlog: [
    {
      id: 'r3c4',
      done: false,
      title: 'ACME: ReCaptcha: switch to Enterprise project',
      fields: [],
      body: "I need additional permissions, I've asked IT for it\nThey can't give it. I've created a new project\nBusiness on vacation, so let's wait",
    },
    { id: 'm4n5', done: false, title: 'Portal infra: Use refresh tokens on PROD', fields: [], body: '- [ ] Apply new portalv3 and portal-admin' },
    { id: 'e2e7', done: false, title: 'ACME: e2e test fails on staging with mailosaur', fields: [], body: '' },
  ],
  notes: [
    {
      heading: 'Catalog search PR',
      body: 'Draft ready, waiting on review. [widget-service#413](https://github.com/owner/widget-service/pull/413)',
      sides: [{ heading: 'Edge cases', body: 'Email match must ignore case, username must not.' }],
    },
    {
      heading: '10:05 Sprint planning',
      body: 'Security fixes go out before the 24th.\nCheck who owns the Contoso shared folder.\nDemo single sign-out next sprint.',
      sides: [],
    },
    { heading: 'Useful commands', body: '```\nkubectl logs -f deploy/identity --since=10m\naz account get-access-token\n```', sides: [] },
    { heading: 'Ask Micke', body: 'Business account for ReCaptcha?\n- Did the mailosaur inbox id change?\n  - [x] Asked in chat', sides: [] },
  ],
});

interface StoredDay {
  content: DayContent;
  version: number;
}

/**
 * Nine days ending today, with things arriving, changing and leaving along the way, so search has a
 * past to look in. A few older ones are scattered over the weeks before, so the calendar has months to turn.
 */
function sampleDays(): Map<string, StoredDay> {
  const days = new Map<string, StoredDay>();
  for (const back of [47, 46, 45, 42, 40, 39, 38, 33, 32, 8, 7, 6, 5, 4, 3, 2, 1, 0]) {
    const date = iso(new Date(Date.now() - back * 86_400_000));
    const content = sample();

    const contoso = content.todo.find((task) => task.id === 'a1b3')!;
    if (back > 5) {
      content.todo = content.todo.filter((task) => task.id !== 'c9d0');
      contoso.fields = [];
      contoso.body = 'Onboard them, details in Mail';
    } else if (back > 2) {
      contoso.body = "Onboard them, details in Mail\nWe're missing the Client Secret";
    }

    if (back > 3) {
      content.todo.push({
        id: 'k1c0',
        done: back < 6,
        title: 'Federation: Contoso Edu kickoff call',
        fields: back < 6 ? [{ key: 'done', value: '2026-11-10T10:00' }] : [],
        body: 'Agreed to start with TEST, PROD after their term break',
      });
    }

    const pool = content.todo.find((task) => task.id === 'q2w3')!;
    if (back > 0) {
      pool.done = false;
      pool.fields = [];
      content.notes = content.notes.filter((note) => note.heading !== '10:05 Sprint planning');
    }
    if (back > 1) {
      content.notes.push({ heading: 'Contoso contacts', body: 'IT lead and identity architect, emails in the kickoff invite', sides: [] });
    }

    days.set(date, { content, version: 1 });
  }
  return days;
}

/** What the shell's index does, done the slow way: every task and note, with the days it was on. */
function histories(days: Map<string, StoredDay>): ItemHistory[] {
  const items = new Map<string, { history: ItemHistory; seen: string[] }>();
  const add = (date: string, key: string, version: ItemVersion) => {
    let item = items.get(key);
    if (!item) items.set(key, (item = { history: { key, kind: version.task ? 'task' : 'note', days: [], versions: [], related: [] }, seen: [] }));
    const json = JSON.stringify(version);
    let index = item.seen.indexOf(json);
    if (index < 0) {
      index = item.seen.push(json) - 1;
      item.history.versions.push(structuredClone(version));
    }
    item.history.days.push({ date, version: index });
  };

  for (const date of [...days.keys()].sort()) {
    const { content } = days.get(date)!;
    for (const task of content.todo) add(date, 't:' + task.id, { section: 'todo', task, note: null });
    for (const task of content.backlog) add(date, 't:' + task.id, { section: 'backlog', task, note: null });
    for (const note of content.notes) add(date, 'n:' + JSON.stringify(note), { section: 'notes', task: null, note });
  }
  const all = [...items.values()].map((item) => item.history);
  for (const history of all) history.related = history.versions.map((version) => relatedTo(history, version, all));
  return all;
}

const textOf = ({ task, note }: ItemVersion) =>
  task ? `${task.title}\n${task.body}` : [note!.heading, note!.body, ...note!.sides.flatMap((side) => [side.heading, side.body])].join('\n');

/** Typed short forms only, such as `widget-service#413`; the shell also reads pasted links. */
const ticketsIn = (version: ItemVersion) =>
  [...textOf(version).matchAll(/(?<![\w/#.-])([A-Za-z](?:[\w.-]*\w)?)#(\d+)\b/g)].map((match) => `${match[1].toLowerCase()}#${match[2]}`);

const blockerKeysOf = (version: ItemVersion) => blockersOf(version.task?.fields).map((id) => 't:' + id);

const titleOf = (version: ItemVersion) => version.task?.title ?? version.note!.heading;

function relatedTo(history: ItemHistory, version: ItemVersion, all: ItemHistory[]): RelatedItem[] {
  const related: RelatedItem[] = [];
  const tickets = ticketsIn(version);
  const blockers = blockerKeysOf(version);
  // Each of the others as it was on the last day it had the link.
  const lastWith = (other: ItemHistory, has: (version: ItemVersion) => boolean) => other.days.findLast((day) => has(other.versions[day.version]));
  const add = (other: ItemHistory, relation: RelatedItem['relation'], day: ItemHistory['days'][number], ticket: string | null) => {
    const then = other.versions[day.version];
    related.push({ key: other.key, kind: other.kind, relation, title: titleOf(then), done: !!then.task?.done, date: day.date, ticket });
  };

  const others = all.filter((other) => other.key !== history.key);
  for (const other of others) if (blockers.includes(other.key)) add(other, 'blockedBy', other.days.at(-1)!, null);
  for (const other of others) {
    const day = lastWith(other, (then) => blockerKeysOf(then).includes(history.key));
    if (day) add(other, 'blocks', day, null);
  }
  for (const other of others) {
    const day = lastWith(other, (then) => ticketsIn(then).some((ticket) => tickets.includes(ticket)));
    if (day) add(other, 'ticket', day, ticketsIn(other.versions[day.version]).find((ticket) => tickets.includes(ticket))!);
  }

  const seen = new Set(version.note ? ['n ' + version.note.heading] : []);
  return related
    .sort((a, b) => Number(a.relation === 'ticket') - Number(b.relation === 'ticket') || b.date.localeCompare(a.date))
    .filter((item) => {
      const id = item.kind === 'note' ? 'n ' + item.title : item.key;
      return !seen.has(id) && !!seen.add(id);
    })
    .slice(0, 8);
}

function search(days: Map<string, StoredDay>, request: SearchRequest): SearchResponse {
  const all = histories(days);
  const tags = new Map<string, number>();
  for (const { versions } of all) {
    const tag = versions.at(-1)!.task && tagOf(versions.at(-1)!.task!.title);
    if (tag) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  const response: SearchResponse = { hits: [], total: 0, days: 0, tags: [...tags.keys()].sort((a, b) => tags.get(b)! - tags.get(a)!) };

  const terms = termsOf(request.text);
  if (terms.length === 0 && !request.tag) return response;

  const text = ({ task, note }: ItemVersion) =>
    task ? { title: task.title, body: task.body } : { title: note!.heading, body: [note!.body, ...note!.sides.flatMap((side) => [side.heading, side.body])].join('\n') };
  const matches = (version: ItemVersion) => {
    const { title, body } = text(version);
    if (request.kind && request.kind !== (version.task ? 'task' : 'note')) return false;
    if (request.tag && (!version.task || tagOf(version.task.title)?.toLowerCase() !== request.tag.toLowerCase())) return false;
    return terms.every((term) => finder([term])!.test(title + '\n' + body));
  };

  const dates = new Set<string>();
  for (const history of all) {
    const shown = history.days.findLast((day) => matches(history.versions[day.version]));
    const last = history.versions[history.days.at(-1)!.version];
    if (!shown) continue;
    if (request.state !== 'any' && (!last.task || last.task.done !== (request.state === 'done'))) continue;

    const version = history.versions[shown.version];
    const hit: SearchHit = {
      key: history.key,
      kind: history.kind,
      ...text(version),
      tag: version.task ? tagOf(version.task.title) : null,
      done: !!last.task?.done,
      first: history.days[0].date,
      last: history.days.at(-1)!.date,
      days: history.days.length,
    };
    response.hits.push(hit);
    history.days.forEach((day) => dates.add(day.date));
  }

  response.hits.sort((a, b) => b.last.localeCompare(a.last) || b.first.localeCompare(a.first) || a.title.localeCompare(b.title));
  response.total = response.hits.length;
  response.days = dates.size;
  return response;
}

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
      case 'noteAges': {
        // The first day each card and side note read as it does on this one.
        const dates = [...days.keys()].sort().filter((date) => date <= payload.date);
        const parts = (content: DayContent) =>
          content.notes.flatMap((note) => [{ heading: note.heading, body: note.body }, ...note.sides.map((side) => ({ heading: '### ' + side.heading, body: side.body }))]);
        const has = (date: string, part: { heading: string; body: string }) =>
          parts(days.get(date)!.content).some((other) => other.heading === part.heading && other.body === part.body);
        return parts(days.get(payload.date)?.content ?? { todo: [], backlog: [], notes: [] }).map((part) => ({
          ...part,
          since: dates.find((date) => has(date, part)) ?? payload.date,
        }));
      }
      case 'standup':
        return structuredClone(standup);
      case 'finishStandup':
        standup = { since: localStamp(), baseline: structuredClone(days.get(today)!.content) };
        return structuredClone(standup);
      case 'search':
        return search(days, payload);
      case 'searchItem':
        return histories(days).find((history) => history.key === payload.key) ?? null;
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

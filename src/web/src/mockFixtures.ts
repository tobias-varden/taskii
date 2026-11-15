// Canned answers for the mock host's search, item history and note ages. They are written to
// match the sample days, so the page has something realistic to draw, but nothing here works
// anything out: the shell's index (Taskii.Core.Search) is the only search there is.

import { ago, sample, SAMPLE_BACK } from './mockDays';
import { tagOf } from './task';
import type { ItemHistory, ItemVersion, NoteAgeDto, NoteDto, RelatedItem, SearchHit, SearchRequest, SearchResponse, TaskDto } from './types';

/** Sample days more than `n` days back, and those `n` or fewer days back. */
const before = (n: number) => SAMPLE_BACK.filter((back) => back > n);
const since = (n: number) => SAMPLE_BACK.filter((back) => back <= n);

const day = sample();
const task = (id: string, change: Partial<TaskDto> = {}): ItemVersion => {
  const found = day.todo.find((t) => t.id === id) ?? day.backlog.find((t) => t.id === id);
  return { section: day.backlog.includes(found!) ? 'backlog' : 'todo', task: { ...found!, ...change }, note: null };
};
const note = (heading: string): ItemVersion => ({ section: 'notes', task: null, note: day.notes.find((n) => n.heading === heading)! });
const contosoContacts: NoteDto = { heading: 'Contoso contacts', body: 'IT lead and identity architect, emails in the kickoff invite', sides: [] };

// Note keys stand in for the index's hash of the card's text.
const CATALOG_NOTE = 'n:5e1f0a9c33b7';
const kickoff = { id: 'k1c0', done: false, title: 'Federation: Contoso Edu kickoff call', fields: [], body: 'Agreed to start with TEST, PROD after their term break' };

const related = (key: string, kind: RelatedItem['kind'], relation: RelatedItem['relation'], title: string, ticket: string | null = null): RelatedItem => ({
  key, kind, relation, title, done: false, date: ago(0), ticket,
});
const blockedBySecret = [related('t:c9d0', 'task', 'blockedBy', 'Federation: Get client secret from Contoso')];

/** Each item as its versions, the days back each one was on, and what it was related to then. */
const items: Array<{ key: string; versions: Array<{ version: ItemVersion; on: number[]; related?: RelatedItem[] }> }> = [
  {
    key: 't:q2w3',
    versions: [
      { version: task('q2w3', { done: false, fields: [] }), on: before(0) },
      { version: task('q2w3'), on: since(0) },
    ],
  },
  {
    key: 't:a1b3',
    versions: [
      { version: task('a1b3', { fields: [], body: 'Onboard them, details in Mail' }), on: before(5) },
      { version: task('a1b3', { body: "Onboard them, details in Mail\nWe're missing the Client Secret" }), on: [5, 4, 3], related: blockedBySecret },
      { version: task('a1b3'), on: since(2), related: blockedBySecret },
    ],
  },
  {
    key: 't:c9d0',
    versions: [{ version: task('c9d0'), on: since(5), related: [related('t:a1b3', 'task', 'blocks', 'Federation: Add Contoso Edu to our TEST environment')] }],
  },
  {
    key: 't:p1v5',
    versions: [{ version: task('p1v5'), on: SAMPLE_BACK, related: [related(CATALOG_NOTE, 'note', 'ticket', 'Catalog search PR', 'widget-service#413')] }],
  },
  {
    key: CATALOG_NOTE,
    versions: [
      {
        version: note('Catalog search PR'),
        on: SAMPLE_BACK,
        related: [related('t:p1v5', 'task', 'ticket', 'ACME: Catalog: exact-match search for Admin and Support', 'widget-service#413')],
      },
    ],
  },
  { key: 'n:9b02d4e8f1a6', versions: [{ version: note('10:05 Sprint planning'), on: since(0) }] },
  { key: 't:t7k2', versions: [{ version: task('t7k2'), on: SAMPLE_BACK }] },
  { key: 't:s3c9', versions: [{ version: task('s3c9'), on: SAMPLE_BACK }] },
  { key: 'n:c47a19e05d3b', versions: [{ version: note('Useful commands'), on: SAMPLE_BACK }] },
  { key: 'n:0f6e2b8a7c91', versions: [{ version: note('Ask Micke'), on: SAMPLE_BACK }] },
  { key: 't:r3c4', versions: [{ version: task('r3c4'), on: SAMPLE_BACK }] },
  { key: 't:m4n5', versions: [{ version: task('m4n5'), on: SAMPLE_BACK }] },
  { key: 't:e2e7', versions: [{ version: task('e2e7'), on: SAMPLE_BACK }] },
  {
    key: 'n:7d3c5a1e2f80',
    versions: [{ version: { section: 'notes', task: null, note: contosoContacts }, on: before(1) }],
  },
  {
    key: 't:k1c0',
    versions: [
      { version: { section: 'todo', task: kickoff, note: null }, on: before(5) },
      { version: { section: 'todo', task: { ...kickoff, done: true, fields: [{ key: 'done', value: '2026-11-10T10:00' }] }, note: null }, on: [5, 4] },
    ],
  },
];

const histories = new Map<string, ItemHistory>(
  items.map(({ key, versions }) => [
    key,
    {
      key,
      kind: versions[0].version.task ? 'task' : 'note',
      days: versions.flatMap(({ on }, version) => on.map((back) => ({ date: ago(back), version }))).sort((a, b) => a.date.localeCompare(b.date)),
      versions: versions.map(({ version }) => version),
      related: versions.map(({ related }) => related ?? []),
    },
  ]),
);

/** Every item as a search hit, newest first, the way the index would list them. */
const hits: SearchHit[] = [...histories.values()].map((history) => {
  const { task, note } = history.versions[history.days.at(-1)!.version];
  return {
    key: history.key,
    kind: history.kind,
    title: task ? task.title : note!.heading,
    body: task ? task.body : [note!.body, ...note!.sides.flatMap((side) => [side.heading, side.body])].join('\n'),
    tag: task ? tagOf(task.title) : null,
    done: !!task?.done,
    first: history.days[0].date,
    last: history.days.at(-1)!.date,
    days: history.days.length,
  };
});
hits.sort((a, b) => b.last.localeCompare(a.last) || b.first.localeCompare(a.first));

/** The canned hits, narrowed by a plain substring check on the title so typing still changes the list. */
export function cannedSearch(request: SearchRequest): SearchResponse {
  const tags = ['ACME', 'Federation', 'Dev', 'Portal infra'];
  const text = request.text.trim().toLowerCase();
  if (!text && !request.tag) return { hits: [], total: 0, days: 0, tags };

  const found = hits.filter(
    (hit) =>
      hit.title.toLowerCase().includes(text) &&
      (!request.kind || hit.kind === request.kind) &&
      (!request.tag || hit.tag?.toLowerCase() === request.tag.toLowerCase()) &&
      (request.state === 'any' || (hit.kind === 'task' && hit.done === (request.state === 'done'))),
  );
  const dates = new Set(found.flatMap((hit) => histories.get(hit.key)!.days.map((d) => d.date)));
  return { hits: structuredClone(found), total: found.length, days: dates.size, tags };
}

export const cannedItem = (key: string): ItemHistory | null => structuredClone(histories.get(key) ?? null);

/**
 * When each card and side note of the sample days first read as it does. Entries that are not on
 * the day asked for are ignored by the page, so one list serves every day.
 */
export function cannedNoteAges(date: string): NoteAgeDto[] {
  const ages: NoteAgeDto[] = [
    { heading: 'Catalog search PR', body: day.notes[0].body, since: ago(47) },
    { heading: '### Edge cases', body: day.notes[0].sides[0].body, since: ago(47) },
    { heading: '10:05 Sprint planning', body: day.notes[1].body, since: ago(0) },
    { heading: 'Useful commands', body: day.notes[2].body, since: ago(47) },
    { heading: 'Ask Micke', body: day.notes[3].body, since: ago(47) },
    { heading: contosoContacts.heading, body: contosoContacts.body, since: ago(47) },
  ];
  return ages.map((age) => ({ ...age, since: age.since < date ? age.since : date }));
}

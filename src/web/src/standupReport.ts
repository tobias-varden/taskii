// What a standup reads out: today's tasks sorted into done, working on and blocked, with
// what is new since the last standup was finished. No DOM here, so it can be tested.

import { tagOf } from './editor/decorations';
import { parseBody, serializeBody, type BlockJSON } from './markdown/body';
import { parseInline } from './markdown/inline';
import type { DayContent, StandupDto, TaskDto } from './types';

/**
 * How an open task compares to the last standup. Null when there is nothing to compare
 * against, because no standup has been finished yet.
 */
export type Change = 'new' | 'fromBacklog' | 'unchanged' | 'changed' | null;

export interface ReportLine {
  block: BlockJSON;
  /** Written since the last standup. */
  isNew: boolean;
}

export interface ReportTask {
  id: string;
  tag: string | null;
  /** Markdown, without the tag. */
  title: string;
  lines: ReportLine[];
  change: Change;
  /** The title of the open task this one waits for. Markdown, without its tag. */
  blockedBy: string | null;
}

export interface Report {
  /** When the last standup was finished, as 2026-11-13T09:15. Null if there has been none. */
  since: string | null;
  done: ReportTask[];
  working: ReportTask[];
  blocked: ReportTask[];
}

export const CHANGE_LABEL: Record<Exclude<Change, null | 'changed'>, string> = {
  new: 'new task',
  fromBacklog: 'from backlog',
  unchanged: 'no change',
};

const doneAt = (task: TaskDto) => task.fields.findLast((field) => field.key === 'done')?.value ?? null;

function withoutTag(title: string): { tag: string | null; title: string } {
  const tag = tagOf(title);
  return { tag, title: tag ? title.slice(tag.length + 1).trimStart() : title };
}

/** What a line says, wherever it is indented to. */
const lineKey = (block: BlockJSON) => serializeBody([{ ...block, attrs: { ...block.attrs, indent: 0 } } as BlockJSON]);

const isBlank = (block: BlockJSON) => block.type === 'line' && !block.content?.length && block.attrs.kind === 'text';

/** Tasks of one tag together, tags in the order they first appear, so the order of the list still shows. */
function byTag(tasks: ReportTask[]): ReportTask[] {
  const order = new Map<string, number>();
  for (const task of tasks) {
    const key = task.tag?.toLowerCase() ?? '';
    if (!order.has(key)) order.set(key, order.size);
  }
  // Array.sort is stable, so tasks of one tag keep the order they have in the list.
  return [...tasks].sort((a, b) => order.get(a.tag?.toLowerCase() ?? '')! - order.get(b.tag?.toLowerCase() ?? '')!);
}

export function buildReport(day: DayContent, last: StandupDto): Report {
  const since = last.since;
  const baseline = last.baseline;
  const before = new Map<string, { task: TaskDto; backlog: boolean }>();
  for (const task of baseline?.todo ?? []) before.set(task.id, { task, backlog: false });
  for (const task of baseline?.backlog ?? []) if (!before.has(task.id)) before.set(task.id, { task, backlog: true });

  const open = new Map<string, TaskDto>();
  for (const task of [...day.todo, ...day.backlog]) if (!task.done && task.id && task.title.trim()) open.set(task.id, task);

  const report: Report = { since, done: [], working: [], blocked: [] };

  for (const task of day.todo) {
    if (task.title.trim() === '' && task.body.trim() === '') continue;

    const then = baseline ? before.get(task.id) : undefined;
    const blocks = parseBody(task.body).filter((block) => !isBlank(block));
    const item: ReportTask = { id: task.id, ...withoutTag(task.title), lines: [], change: null, blockedBy: null };

    if (task.done) {
      // Reported at the last standup already; it only stays in today's list until tomorrow.
      // A done task that does not say when cannot be shown to have been reported, so it is read out.
      const at = doneAt(task);
      if (since && at && at < since) continue;
      item.lines = blocks.map((block) => ({ block, isNew: false }));
      report.done.push(item);
      continue;
    }

    if (baseline) {
      if (!then) item.change = 'new';
      else if (then.backlog) item.change = 'fromBacklog';
      else item.change = then.task.title === task.title && then.task.body === task.body ? 'unchanged' : 'changed';
    }
    const known = new Set(item.change === 'changed' ? parseBody(then!.task.body).map(lineKey) : []);
    item.lines = blocks.map((block) => ({ block, isNew: item.change === 'changed' && !known.has(lineKey(block)) }));

    const blocker = task.fields
      .filter((field) => field.key === 'blocked-by')
      .map((field) => open.get(field.value.replace(/^\^/, '')))
      .find((other) => other && other.id !== task.id);
    if (blocker) {
      item.blockedBy = withoutTag(blocker.title).title;
      report.blocked.push(item);
    } else {
      report.working.push(item);
    }
  }

  report.done = byTag(report.done);
  report.working = byTag(report.working);
  report.blocked = byTag(report.blocked);
  return report;
}

/** Markdown as the text it shows. */
export function plain(markdown: string): string {
  return parseInline(markdown)
    .map((node) => node.text)
    .join('');
}

function lineText(block: BlockJSON): string[] {
  const pad = '  '.repeat(block.attrs.indent ?? 0);
  if (block.type === 'image') return [];
  if (block.type === 'codeBlock') {
    const code = (block.content ?? []).map((node) => node.text ?? '').join('');
    return code.split('\n').map((line) => pad + line);
  }
  const text = (block.content ?? []).map((node) => node.text ?? '').join('');
  const marker = block.attrs.kind === 'check' ? (block.attrs.checked ? '[x] ' : '[ ] ') : block.attrs.kind === 'bullet' ? '- ' : '';
  return [pad + marker + text];
}

/**
 * The report as plain text, for a standup held in chat. A task that has been reported before
 * is given with what is new only; the rest was said last time.
 */
export function reportText(report: Report, heading: string): string {
  const out: string[] = [heading];

  const section = (name: string, tasks: ReportTask[], note: (task: ReportTask) => string, lines: (task: ReportTask) => ReportLine[]) => {
    if (tasks.length === 0) return;
    out.push('', name);
    for (const task of tasks) {
      const title = plain(task.title) || 'No title';
      out.push(`- ${task.tag ? `${task.tag}: ` : ''}${title}${note(task)}`);
      for (const line of lines(task)) out.push(...lineText(line.block).map((text) => '    ' + text));
    }
  };

  const changeNote = (task: ReportTask) => (task.change && task.change !== 'changed' ? ` (${CHANGE_LABEL[task.change]})` : '');
  const shown = (task: ReportTask) => (task.change === 'changed' ? task.lines.filter((line) => line.isNew) : task.change === 'unchanged' ? [] : task.lines);

  section('Done', report.done, () => '', (task) => task.lines);
  section('Working on', report.working, changeNote, shown);
  section('Blocked', report.blocked, (task) => ` (blocked by ${plain(task.blockedBy ?? '')})`, shown);

  if (out.length === 1) out.push('', 'Nothing to report.');
  return out.join('\n') + '\n';
}

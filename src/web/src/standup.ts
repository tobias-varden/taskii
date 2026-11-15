// Standup mode: today read out as done, working on and blocked, covering everything since
// the last standup was finished. Finishing one is what lets done tasks go.

import { formatDate, weekdayDate } from './dates';
import { viewState } from './editor/viewState';
import type { Host } from './host';
import type { BlockJSON } from './markdown/body';
import { parseInline, type InlineJSON } from './markdown/inline';
import { CHANGE_LABEL, buildReport, reportText, type Report, type ReportLine, type ReportTask } from './standupReport';
import type { DayContent } from './types';

export interface StandupHooks {
  today: () => string;
  /** Today as it is on screen right now. */
  content: () => DayContent;
  /** Writes what is pending, so the standup that is recorded is the day that was read out. */
  flush: () => Promise<void>;
  openLink: (url: string) => void;
  /** Standup mode has been left. `finished` when that was by finishing the standup. */
  left: (finished: boolean) => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const MARK_TAG: Record<string, keyof HTMLElementTagNameMap> = { bold: 'b', italic: 'i', strike: 's', code: 'code' };

export class StandupView {
  /** Whether standup mode has the window. */
  active = false;

  private report: Report | null = null;
  private sequence = 0;
  private busy = false;
  private copiedTimer = 0;

  constructor(
    private readonly host: Host,
    private readonly hooks: StandupHooks,
  ) {
    $('standup-back').addEventListener('click', () => this.leave());
    $('standup-copy').addEventListener('click', () => void this.copy());
    $('standup-finish').addEventListener('click', () => void this.finish());
  }

  async enter(): Promise<void> {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('standup-mode');
    $('standup-view').hidden = false;
    $('standup-sheet').replaceChildren();
    $('standup-when').textContent = formatDate(this.hooks.today());
    this.setReady(false);
    await this.refresh();
    $('standup-view').focus();
  }

  /** Draws it again: today has changed underneath, or another standup was finished elsewhere. */
  async refresh(): Promise<void> {
    if (!this.active) return;
    const sequence = ++this.sequence;
    try {
      const last = await this.host.request('standup');
      if (sequence !== this.sequence || !this.active) return;
      this.report = buildReport(this.hooks.content(), last);
      this.draw(this.report);
      this.setReady(true);
    } catch (error) {
      console.error(error);
      if (sequence !== this.sequence || !this.active) return;
      this.report = null;
      $('standup-sheet').replaceChildren(el('p', 'su-empty', error instanceof Error ? error.message : 'Could not read the last standup.'));
    }
  }

  leave(finished = false): void {
    if (!this.active) return;
    this.active = false;
    this.sequence++;
    this.report = null;
    document.body.classList.remove('standup-mode');
    $('standup-view').hidden = true;
    $('standup-sheet').replaceChildren();
    this.hooks.left(finished);
  }

  /** Keys while standup mode has the window. */
  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.leave();
    } else if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      void this.finish();
    }
  }

  // ---- actions ----

  private heading(): string {
    const today = this.hooks.today();
    const since = this.report?.since;
    return `Standup ${formatDate(today)}${since ? `, since ${weekdayDate(since.slice(0, 10), today)} ${since.slice(11, 16)}` : ''}`;
  }

  private async copy(): Promise<void> {
    if (!this.report) return;
    const text = reportText(this.report, this.heading());
    const button = $('standup-copy');
    try {
      await writeClipboard(text);
      button.textContent = 'Copied';
    } catch (error) {
      console.error(error);
      button.textContent = 'Could not copy';
    }
    clearTimeout(this.copiedTimer);
    this.copiedTimer = window.setTimeout(() => (button.textContent = 'Copy as text'), 2000);
  }

  private async finish(): Promise<void> {
    if (this.busy || !this.report) return;
    this.busy = true;
    this.setReady(false);
    try {
      await this.hooks.flush();
      await this.host.request('finishStandup');
      this.leave(true);
    } catch (error) {
      console.error(error);
      this.setReady(true);
      $('standup-finish').textContent = 'Could not finish. Try again';
    } finally {
      this.busy = false;
    }
  }

  private setReady(ready: boolean): void {
    $<HTMLButtonElement>('standup-copy').disabled = !ready;
    $<HTMLButtonElement>('standup-finish').disabled = !ready;
    if (ready) $('standup-finish').textContent = 'Finish standup';
  }

  // ---- drawing ----

  private draw(report: Report): void {
    const today = this.hooks.today();
    const since = report.since;
    $('standup-when').textContent = since
      ? `${formatDate(today)} · since ${weekdayDate(since.slice(0, 10), today)} ${since.slice(11, 16)}`
      : `${formatDate(today)} · first standup`;

    const nodes: HTMLElement[] = [];
    const section = (name: string, tasks: ReportTask[], hint: string, done = false) => {
      if (tasks.length === 0) return;
      const head = el('div', 'su-sec');
      head.append(el('span', '', name), el('span', '', hint ? `${tasks.length} · ${hint}` : String(tasks.length)));
      nodes.push(head, ...tasks.flatMap((task) => this.drawTask(task, done)));
    };

    section('Done', report.done, 'gone tomorrow once you finish', true);
    section('Working on', report.working, since ? 'new notes marked' : '');
    section('Blocked', report.blocked, '');
    if (nodes.length === 0) nodes.push(el('p', 'su-empty', 'Nothing in Todo to report.'));
    $('standup-sheet').replaceChildren(...nodes);
  }

  private drawTask(task: ReportTask, done: boolean): HTMLElement[] {
    const row = el('div', 'su-task');
    row.append(el('span', done ? 'su-box done' : 'su-box', done ? '✓' : ''));

    const title = el('span', 'su-title');
    if (task.tag) title.append(el('span', 'su-tag', task.tag), ' ');
    if (task.title) this.appendInline(title, parseInline(task.title));
    else title.append(el('span', 'su-none', 'No title'));
    if (task.blockedBy !== null) {
      const blocked = el('span', 'su-blocked', 'blocked by ');
      this.appendInline(blocked, parseInline(task.blockedBy || 'an untitled task'));
      title.append(' ', blocked);
    }
    row.append(title);
    if (task.change && task.change !== 'changed') row.append(el('span', 'su-hint', CHANGE_LABEL[task.change]));

    // An untouched task is read as its title; what is under it was said last time.
    if (task.change === 'unchanged' || task.lines.length === 0) return [row];

    const body = el('div', 'su-body');
    body.append(...task.lines.map((line) => this.drawLine(line)));
    return [row, body];
  }

  private drawLine({ block, isNew }: ReportLine): HTMLElement {
    const node = this.drawBlock(block);
    node.classList.add('su-line');
    if (isNew) node.classList.add('new');
    node.style.setProperty('--indent', String(block.attrs.indent ?? 0));
    return node;
  }

  private drawBlock(block: BlockJSON): HTMLElement {
    if (block.type === 'codeBlock') {
      return el('pre', '', (block.content ?? []).map((part) => part.text ?? '').join(''));
    }
    if (block.type === 'image') {
      const holder = el('p');
      const image = el('img');
      const src = block.attrs.src;
      image.src = src.startsWith('assets/') ? viewState.assetBase + src.slice('assets/'.length) : src;
      image.alt = block.attrs.alt;
      holder.append(image);
      return holder;
    }

    const line = el('p');
    if (block.attrs.kind === 'bullet') line.append(el('span', 'su-bullet', '•'));
    if (block.attrs.kind === 'check') {
      line.append(el('span', block.attrs.checked ? 'su-box sub done' : 'su-box sub', block.attrs.checked ? '✓' : ''));
      if (block.attrs.checked) line.classList.add('checked');
    }
    const text = el('span');
    this.appendInline(text, block.content ?? []);
    line.append(text);
    return line;
  }

  private appendInline(parent: HTMLElement, nodes: readonly InlineJSON[]): void {
    for (const node of nodes) {
      let inner: Node = document.createTextNode(node.text ?? '');
      let href: string | null = null;
      for (const mark of node.marks ?? []) {
        if (mark.type === 'link') {
          href = String(mark.attrs?.href ?? '');
        } else if (MARK_TAG[mark.type]) {
          const wrap = el(MARK_TAG[mark.type]);
          wrap.append(inner);
          inner = wrap;
        }
      }
      if (href !== null) {
        const url = href;
        const link = el('a');
        link.href = url;
        link.append(inner);
        link.addEventListener('click', (event) => {
          event.preventDefault();
          this.hooks.openLink(url);
        });
        inner = link;
      }
      parent.append(inner);
    }
  }
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Not allowed here; fall back to the old way, which only needs a selection.
  }
  const area = el('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('The clipboard is not available.');
}

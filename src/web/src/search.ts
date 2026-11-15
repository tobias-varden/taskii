// Search across all days: the box in the top bar, the list of results, and the preview of
// the selected one as it was on any day it lived on.
//
// Content is copied forward every day, so a result is a task or a note, not a day. The shell
// does the finding and collapsing; this draws it.

import type { Editor } from '@tiptap/core';
import { formatDate, shortDate, weekdayDate } from './dates';
import { afterTag, splitTag } from './task';
import { createPreviewEditor } from './editor/editors';
import type { Host } from './host';
import { parseInline } from './markdown/inline';
import type { ItemHistory, ItemKind, ItemVersion, RelatedItem, SearchHit, SearchRequest } from './types';

/** How long after the last keystroke the search runs. */
const SEARCH_DELAY = 120;
/** A match further into a line than this has the start of the line cut away. */
const SNIPPET_LEAD = 48;

export interface SearchHooks {
  today: () => string;
  /** Called before the first search, so what was just typed into today can be found. */
  flush: () => Promise<void>;
  /** Search has been left; show this day. */
  openDay: (date: string) => void;
  openLink: (url: string) => void;
}

type State = SearchRequest['state'];

const STATE_LABEL: Record<State, string> = { any: 'Open and done', open: 'Open', done: 'Done' };
const NEXT_STATE: Record<State, State> = { any: 'open', open: 'done', done: 'any' };
const SECTION_LABEL: Record<ItemVersion['section'], string> = { todo: 'Todo', backlog: 'Backlog', notes: 'Notes' };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * The words of a query, split the way the index's tokenizer splits text: letters and numbers of any
 * kind. The same rule as SearchIndex.TermsOf; the cases both are tested on are in tests/rules/cases.json.
 */
export function termsOf(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Matches any of the words where it starts a word, as the index does. Null when there are none. */
export function finder(terms: readonly string[]): RegExp | null {
  if (terms.length === 0) return null;
  const words = [...terms].sort((a, b) => b.length - a.length).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})`, 'giu');
}

/** Markdown as the text it shows. */
function plain(markdown: string): string {
  return parseInline(markdown)
    .map((node) => node.text)
    .join('');
}

/** The lines of a body worth showing in a list: no list markers, fences or images. */
function snippetLines(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*] )?(?:\[[ xX]\] )?/, ''))
    .filter((line) => line && !line.startsWith('```') && !/^!\[[^\]]*\]\([^)]*\)$/.test(line))
    .map(plain);
}

/** Appends `text` to `parent` with what was searched for marked. */
function appendMarked(parent: HTMLElement, text: string, find: RegExp | null): void {
  let at = 0;
  if (find) {
    for (const match of text.matchAll(find)) {
      parent.append(text.slice(at, match.index), el('mark', '', match[0]));
      at = match.index + match[0].length;
    }
  }
  parent.append(text.slice(at));
}

export class SearchView {
  /** Whether search has taken over the window. */
  active = false;

  private readonly input = $<HTMLInputElement>('search');
  private readonly list = $('search-results');
  private readonly tagSelect = $<HTMLSelectElement>('search-tag');

  private kind: ItemKind | null = null;
  private tag: string | null = null;
  private state: State = 'any';

  private timer = 0;
  private sequence = 0;
  private find: RegExp | null = null;
  private terms: string[] = [];
  /** Tasks first, then notes; each newest first. */
  private hits: SearchHit[] = [];
  private rows: HTMLElement[] = [];
  private selected = -1;

  private readonly histories = new Map<string, ItemHistory | null>();
  /** What the preview shows or is fetching: the selected result, or something related to it. */
  private previewKey: string | null = null;
  private history: ItemHistory | null = null;
  private dayIndex = 0;
  private editor?: Editor;
  private shownVersion: ItemVersion | null = null;

  constructor(
    private readonly host: Host,
    private readonly hooks: SearchHooks,
  ) {
    this.bind();
  }

  /** Puts the cursor in the search box. Search starts with the first thing typed. */
  focus(): void {
    this.input.focus();
    this.input.select();
  }

  /** Back to the day that was showing. */
  leave(): void {
    if (!this.active) return;
    this.active = false;
    this.sequence++;
    clearTimeout(this.timer);
    document.body.classList.remove('searching');
    $('search-view').hidden = true;

    this.input.value = '';
    this.input.blur();
    this.kind = this.tag = null;
    this.state = 'any';
    this.hits = [];
    this.rows = [];
    this.selected = -1;
    this.histories.clear();
    this.list.replaceChildren();
    $('search-count').textContent = '';
    this.showHistory(null);
  }

  /** Keys while search has the window. */
  handleKey(event: KeyboardEvent): void {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const plainKey = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.leave();
      this.hooks.openDay(this.hooks.today());
    } else if (plainKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && target !== this.tagSelect) {
      event.preventDefault();
      if (this.hits.length) this.select(Math.min(this.hits.length - 1, Math.max(0, this.selected + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (plainKey && event.key === 'Enter' && !target?.closest('button, select')) {
      event.preventDefault();
      this.openShownDay();
    } else if (event.altKey && !event.ctrlKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      // The same keys that step between days outside search.
      event.preventDefault();
      this.showDay(this.dayIndex + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  }

  // ---- finding ----

  private enter(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('searching');
    $('search-view').hidden = false;
    this.drawFilters();
    void this.hooks.flush().then(() => this.run());
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), SEARCH_DELAY);
  }

  private async run(): Promise<void> {
    if (!this.active) return;
    clearTimeout(this.timer);
    const sequence = ++this.sequence;
    const request: SearchRequest = { text: this.input.value, kind: this.kind, tag: this.tag, state: this.state };

    let response;
    try {
      response = await this.host.request('search', request);
    } catch (error) {
      console.error(error);
      if (sequence === this.sequence) this.showMessage(error instanceof Error ? error.message : 'Search failed.');
      return;
    }
    // Something newer was typed while this one was out.
    if (sequence !== this.sequence) return;

    const keep = this.hits[this.selected]?.key;
    this.terms = termsOf(request.text);
    this.find = finder(this.terms);
    this.hits = [...response.hits.filter((hit) => hit.kind === 'task'), ...response.hits.filter((hit) => hit.kind === 'note')];
    this.histories.clear();
    this.shownVersion = null;

    this.drawTags(response.tags);
    this.drawResults(request, response.total);
    $('search-count').textContent = response.total
      ? `${response.total} result${response.total === 1 ? '' : 's'} in ${response.days} day${response.days === 1 ? '' : 's'}`
      : '';

    const index = this.hits.findIndex((hit) => hit.key === keep);
    if (this.hits.length) this.select(index < 0 ? 0 : index, index >= 0);
    else this.showHistory(null);
  }

  // ---- results ----

  private drawResults(request: SearchRequest, total: number): void {
    this.rows = [];
    this.selected = -1;

    if (this.hits.length === 0) {
      const asked = request.text.trim() || request.tag;
      this.showMessage(asked ? `Nothing found for “${asked}”.` : 'Type to search the tasks and notes of every day.');
      return;
    }

    const nodes: HTMLElement[] = [];
    let group: ItemKind | null = null;
    this.hits.forEach((hit, index) => {
      if (hit.kind !== group) {
        group = hit.kind;
        const count = this.hits.filter((other) => other.kind === hit.kind).length;
        nodes.push(el('div', 'grp', `${hit.kind === 'task' ? 'Tasks' : 'Notes'} · ${count}`));
      }
      const row = this.drawHit(hit);
      row.addEventListener('mousedown', () => this.select(index));
      row.addEventListener('dblclick', () => this.openShownDay());
      this.rows.push(row);
      nodes.push(row);
    });

    if (total > this.hits.length) nodes.push(el('div', 'more', `Showing the newest ${this.hits.length} of ${total}. Type more to narrow it down.`));
    this.list.replaceChildren(...nodes);
    this.list.scrollTop = 0;
  }

  private drawHit(hit: SearchHit): HTMLElement {
    const row = el('div', `res ${hit.kind}`);
    row.setAttribute('role', 'option');
    const top = el('div', 'top');
    const fill = el('span', 'fill');

    let title = plain(hit.title);
    if (hit.kind === 'task') {
      top.append(el('span', hit.done ? 'box done' : 'box', hit.done ? '✓' : ''));
      if (hit.done) fill.classList.add('done');
      if (hit.tag && title.startsWith(hit.tag + ':')) {
        const tag = el('span', 'tag');
        appendMarked(tag, hit.tag, this.find);
        fill.append(tag);
        title = afterTag(title, hit.tag);
      }
    }

    if (title) appendMarked(fill, title, this.find);
    else fill.append(el('span', 'untitled', hit.kind === 'task' ? 'No title' : 'No heading'));

    top.append(fill, el('span', 'when', this.span(hit)));
    row.append(top);

    const snippet = this.snippet(hit.body);
    if (snippet) {
      const line = el('p', 'snip');
      appendMarked(line, snippet, this.find);
      row.append(line);
    }
    return row;
  }

  /** "9 Sep → today · 48 days", "2 Oct → 6 Oct · done", "today". */
  private span(hit: SearchHit): string {
    const today = this.hooks.today();
    const day = (date: string) => (date === today ? 'today' : shortDate(date, today));
    const done = hit.kind === 'task' && hit.done;
    if (hit.days === 1) return done ? `${day(hit.last)} · done` : day(hit.last);
    return `${day(hit.first)} → ${day(hit.last)} · ${done ? 'done' : `${hit.days} days`}`;
  }

  /** The first line of the body that matches, or failing that its first line. */
  private snippet(body: string): string {
    const lines = snippetLines(body);
    if (lines.length === 0) return '';

    const find = this.find;
    const index = find ? lines.findIndex((line) => line.search(find) >= 0) : -1;
    if (index < 0) return lines[0];

    const line = lines[index];
    const at = line.search(find!);
    if (at <= SNIPPET_LEAD) return (index > 0 ? '…' : '') + line;
    // Start at a word, a little before the match.
    const from = line.indexOf(' ', at - SNIPPET_LEAD) + 1;
    return '…' + line.slice(from > 0 && from <= at ? from : at);
  }

  private showMessage(text: string): void {
    this.rows = [];
    this.list.replaceChildren(el('div', 'empty', text));
    $('search-count').textContent = '';
    this.showHistory(null);
  }

  private select(index: number, quietly = false): void {
    this.rows[this.selected]?.classList.remove('sel');
    this.rows[this.selected]?.removeAttribute('aria-selected');
    this.selected = index;
    const row = this.rows[index];
    row?.classList.add('sel');
    row?.setAttribute('aria-selected', 'true');
    if (!quietly) {
      // The first row takes its group heading with it.
      if (index === 0) this.list.scrollTop = 0;
      else row?.scrollIntoView({ block: 'nearest' });
    }
    void this.loadHistory(this.hits[index]?.key);
  }

  /** Shows something related to what is in the preview, whether or not the search found it too. */
  private openRelated(item: RelatedItem): void {
    const index = this.hits.findIndex((hit) => hit.key === item.key);
    if (index >= 0) return this.select(index);

    this.rows[this.selected]?.classList.remove('sel');
    this.rows[this.selected]?.removeAttribute('aria-selected');
    this.selected = -1;
    void this.loadHistory(item.key);
  }

  // ---- filters ----

  private drawFilters(): void {
    document.querySelectorAll<HTMLElement>('#search-kinds [data-kind]').forEach((button) => {
      button.classList.toggle('on', (button.dataset.kind || null) === this.kind);
    });
    const state = $('search-state');
    state.textContent = STATE_LABEL[this.state];
    state.classList.toggle('on', this.state !== 'any');
    this.tagSelect.value = this.tag ?? '';
    this.tagSelect.classList.toggle('on', !!this.tag);
  }

  private drawTags(tags: string[]): void {
    const options = [new Option('Tag: any', '')];
    // A tag stays in the list while it is chosen, even if nothing has it any more.
    for (const tag of this.tag && !tags.includes(this.tag) ? [this.tag, ...tags] : tags) options.push(new Option(tag, tag));
    this.tagSelect.replaceChildren(...options);
    this.tagSelect.value = this.tag ?? '';
  }

  // ---- preview ----

  private async loadHistory(key: string | undefined): Promise<void> {
    this.previewKey = key ?? null;
    if (!key) return this.showHistory(null);

    let history = this.histories.get(key);
    if (history === undefined) {
      try {
        history = await this.host.request('searchItem', { key });
      } catch (error) {
        console.error(error);
        history = null;
      }
      this.histories.set(key, history);
    }
    // Something else was selected while this one was being fetched.
    if (this.previewKey !== key) return;
    this.showHistory(history);
  }

  private drawRelated(items: RelatedItem[]): void {
    const today = this.hooks.today();
    $('pv-related').hidden = items.length === 0;
    $('pv-related-list').replaceChildren(
      ...items.map((item) => {
        const row = el('button', 'rel-item');
        row.type = 'button';

        const lead =
          item.relation === 'blockedBy' ? 'Blocked by' : item.relation === 'blocks' ? 'Blocks' : item.kind === 'note' ? `Note on ${shortDate(item.date, today)}:` : 'Task';
        row.append(`› ${lead} `);

        const { tag, title } = item.kind === 'task' ? splitTag(plain(item.title)) : { tag: null, title: plain(item.title) };
        if (tag) row.append(el('span', 'tag', tag));
        row.append(el('span', item.done ? 'rel-name done' : 'rel-name', title || (item.kind === 'task' ? 'No title' : 'No heading')));

        const details = [item.ticket, item.done ? 'done' : null].filter(Boolean);
        if (details.length) row.append(el('span', 'rel-more', ` · ${details.join(' · ')}`));

        row.addEventListener('click', () => this.openRelated(item));
        return row;
      }),
    );
  }

  private showHistory(history: ItemHistory | null): void {
    this.history = history?.days.length ? history : null;
    $('search-preview').classList.toggle('none', !this.history);
    if (!this.history) {
      this.previewKey = null;
      this.editor?.destroy();
      this.editor = undefined;
      this.shownVersion = null;
      return;
    }

    // The latest day it appeared, which is nearly always a day it matched. A task found by
    // text it has since lost opens on the last day it still had it.
    const { days, versions } = this.history;
    let index = days.length - 1;
    while (index > 0 && !this.matches(versions[days[index].version])) index--;
    this.showDay(this.matches(versions[days[index].version]) ? index : days.length - 1);
  }

  private matches(version: ItemVersion): boolean {
    const item = version.task ?? version.note;
    if (!item) return false;
    const parts = version.task
      ? [version.task.title, version.task.body]
      : [version.note!.heading, version.note!.body, ...version.note!.sides.flatMap((side) => [side.heading, side.body])];
    const text = parts.join('\n');
    return this.terms.every((term) => finder([term])!.test(text));
  }

  /** The days on which the item differs from the day before, starting with its first day. */
  private changes(): number[] {
    const days = this.history?.days ?? [];
    return days.flatMap((day, index) => (index === 0 || day.version !== days[index - 1].version ? [index] : []));
  }

  private showDay(index: number): void {
    const history = this.history;
    if (!history) return;
    const last = history.days.length - 1;
    this.dayIndex = Math.min(last, Math.max(0, index));
    const day = history.days[this.dayIndex];
    const version = history.versions[day.version];
    const today = this.hooks.today();

    $('pv-date').textContent = formatDate(day.date);
    $('pv-count').textContent = ` · day ${this.dayIndex + 1} of ${history.days.length}`;
    $<HTMLButtonElement>('pv-first').disabled = $<HTMLButtonElement>('pv-prev').disabled = this.dayIndex === 0;
    $<HTMLButtonElement>('pv-last').disabled = $<HTMLButtonElement>('pv-next').disabled = this.dayIndex === last;

    const changes = this.changes();
    const changed = changes.findLast((at) => at <= this.dayIndex) ?? 0;
    const when = weekdayDate(history.days[changed].date, today);
    $('pv-changed').textContent = `${SECTION_LABEL[version.section]} · ${changed === 0 ? `as first written ${when}` : `last changed ${when}`}`;
    $<HTMLButtonElement>('pv-prev-change').disabled = !changes.some((at) => at < this.dayIndex);
    $<HTMLButtonElement>('pv-next-change').disabled = !changes.some((at) => at > this.dayIndex);
    // A note never changes: an edited note is another note.
    $('pv-changes').hidden = changes.length < 2;

    if (version !== this.shownVersion) {
      this.shownVersion = version;
      this.drawRelated(history.related[day.version] ?? []);
      this.editor?.destroy();
      this.editor = createPreviewEditor($('pv-sheet'), version, this.find, this.hooks.openLink);
      $('pv-sheet').classList.toggle('note', !version.task);
    }
  }

  private stepChange(direction: -1 | 1): void {
    const changes = this.changes();
    const target = direction < 0 ? changes.findLast((at) => at < this.dayIndex) : changes.find((at) => at > this.dayIndex);
    if (target !== undefined) this.showDay(target);
  }

  private openShownDay(): void {
    const date = this.history?.days[this.dayIndex]?.date;
    if (!date) return;
    this.leave();
    this.hooks.openDay(date);
  }

  // ---- wiring ----

  private bind(): void {
    this.input.addEventListener('input', () => {
      if (this.active) this.schedule();
      else if (this.input.value.trim()) this.enter();
    });
    this.input.addEventListener('keydown', (event) => {
      if (this.active) return;
      // Not searching yet: Enter or Down opens search to browse by tag, Esc gives the box up.
      if (event.key === 'Enter' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.enter();
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        this.input.value = '';
        this.input.blur();
      }
    });

    $('search-back').addEventListener('click', () => this.leave());

    $('search-kinds').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-kind]');
      if (!button) return;
      this.kind = (button.dataset.kind || null) as ItemKind | null;
      this.filtersChanged();
    });
    $('search-state').addEventListener('click', () => {
      this.state = NEXT_STATE[this.state];
      this.filtersChanged();
    });
    this.tagSelect.addEventListener('change', () => {
      this.tag = this.tagSelect.value || null;
      this.filtersChanged();
    });

    $('pv-first').addEventListener('click', () => this.showDay(0));
    $('pv-prev').addEventListener('click', () => this.showDay(this.dayIndex - 1));
    $('pv-next').addEventListener('click', () => this.showDay(this.dayIndex + 1));
    $('pv-last').addEventListener('click', () => this.showDay(Infinity));
    $('pv-prev-change').addEventListener('click', () => this.stepChange(-1));
    $('pv-next-change').addEventListener('click', () => this.stepChange(1));
    $('pv-open').addEventListener('click', () => this.openShownDay());
  }

  private filtersChanged(): void {
    this.drawFilters();
    void this.run();
    this.input.focus();
  }
}

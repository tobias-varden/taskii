// The page: which day is shown, when it is saved, and the chrome around the editors.

import type { Editor } from '@tiptap/core';
import { Originals } from './editor/convert';
import { CardDrag, addCard, addSide, timeHeading } from './editor/board';
import { TaskDrag } from './editor/drag';
import { appendTask, collectTags, countTasks, createBoardEditor, createTaskEditor, moveTask, readNotes, readTasks, redraw, taskIds } from './editor/editors';
import { pruneFolded } from './editor/fold';
import { viewState } from './editor/viewState';
import type { Host } from './host';
import type { DayContent, DayDto } from './types';

/** How long after the last keystroke the day is written. */
const SAVE_DELAY = 600;
const RETRY_DELAY = 3000;
/** The day does not roll over under someone's fingers; it waits for a pause this long. */
const IDLE_BEFORE_ROLLOVER = 2 * 60_000;
const BACKLOG_OPEN = 'taskii.backlogOpen';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return dateFormat.format(new Date(year, month - 1, day)).replace(',', '');
}

export class App {
  private today = '';
  private day: DayDto | null = null;
  private version = '';
  private originals = new Originals();

  private todo?: Editor;
  private backlog?: Editor;
  private board?: Editor;

  private dirty = false;
  private conflict = false;
  private saving: Promise<void> | null = null;
  private saveTimer = 0;
  private statusTimer = 0;
  private lastEdit = 0;
  private checking = false;

  private readonly drag = new TaskDrag(
    () => [
      { editor: this.todo!, scroller: $('todo').parentElement! },
      { editor: this.backlog!, scroller: $('backlog').parentElement! },
    ],
    $('rail'),
    () => this.backlog!,
    (source, id, target, index) => moveTask(source, id, target, index),
  );

  private readonly cardDrag = new CardDrag();

  constructor(private readonly host: Host) {}

  async start(): Promise<void> {
    this.bind();
    const init = await this.host.request('init');
    this.today = init.today;
    viewState.assetBase = init.assetBase;

    if (init.day) {
      this.setFolder(init.dataFolder);
      this.show(init.day);
    } else {
      this.showWelcome(init.suggestedFolder);
    }
  }

  // ---- showing a day ----

  private show(day: DayDto): void {
    this.todo?.destroy();
    this.backlog?.destroy();
    this.board?.destroy();

    this.day = day;
    this.version = day.version;
    this.originals = new Originals();
    this.dirty = false;
    this.setConflict(false);
    clearTimeout(this.saveTimer);

    const hooks = {
      onChange: () => this.changed(),
      openLink: (url: string) => void this.host.request('openLink', { url }),
      saveImage: (file: File) => this.saveImage(file),
    };
    const taskHooks = {
      ...hooks,
      tags: () => collectTags(this.todo, this.backlog),
      onGrab: (event: PointerEvent, editor: Editor, id: string) => this.drag.start(event, editor, id),
      onTagClick: (tag: string) => this.setFilter(viewState.filter === tag ? null : tag),
    };
    // Fresh editors for every day, so undo can never reach back into a different one.
    // Alt+Shift+Right sends a task to the top of the backlog, Alt+Shift+Left to the end of Todo.
    this.todo = createTaskEditor($('todo'), day.todo, day.editable, this.originals, {
      ...taskHooks,
      takenIds: () => taskIds(this.backlog),
      send: (direction, id) => direction === 'right' && moveTask(this.todo!, id, this.backlog!, 'start'),
    });
    this.backlog = createTaskEditor($('backlog'), day.backlog, day.editable, this.originals, {
      ...taskHooks,
      takenIds: () => taskIds(this.todo),
      send: (direction, id) => direction === 'left' && moveTask(this.backlog!, id, this.todo!, 'end'),
    });
    this.board = createBoardEditor($('board'), day.notes, day.editable, this.originals, {
      ...hooks,
      onGrab: (event, editor, element) => this.cardDrag.start(event, editor, element),
      // Alt+Shift+Left on a line of a note lifts it out to the end of Todo.
      promote: (line) => {
        if (!this.todo) return false;
        const done = line.attrs.kind === 'check' && line.attrs.checked === true;
        appendTask(this.todo, [...taskIds(this.todo), ...taskIds(this.backlog)], line.content.toJSON(), done);
        return true;
      },
    });

    $('welcome').hidden = true;
    $('cols').hidden = false;
    $('cols').classList.toggle('readonly', !day.editable);
    $('date').textContent = formatDate(day.date);
    $('prev').hidden = $('next').hidden = false;
    $<HTMLButtonElement>('prev').disabled = !day.prev;
    $<HTMLButtonElement>('next').disabled = !day.next;
    $('today').hidden = day.date === this.today;
    $('readonly').hidden = day.editable;
    $('carried').hidden = !day.carriedFrom;
    $('carried').textContent = day.carriedFrom ? `continued from ${formatDate(day.carriedFrom)}` : '';
    this.setStatus('');
    this.updateCounts();
    // Fold state is kept per task; forget tasks that are gone. A past day says nothing about that.
    if (day.editable) pruneFolded([...taskIds(this.todo), ...taskIds(this.backlog)]);
  }

  private async saveImage(file: File): Promise<string> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return (await this.host.request('saveAsset', { mediaType: file.type, data: btoa(binary) })).path;
    } catch (error) {
      this.setStatus('Could not paste that image', 4000, true);
      throw error;
    }
  }

  private setFilter(tag: string | null): void {
    viewState.filter = tag;
    const chip = $('filter');
    chip.hidden = !tag;
    chip.textContent = tag ? `${tag} \u2715` : '';
    redraw(this.todo);
    redraw(this.backlog);
  }

  private async open(date: string): Promise<void> {
    await this.flush();
    this.show(await this.host.request('loadDay', { date }));
  }

  private updateCounts(): void {
    if (!this.todo || !this.backlog) return;
    const todo = countTasks(this.todo);
    const backlog = countTasks(this.backlog);
    $('todo-hint').textContent = todo.done ? `${todo.open} open · ${todo.done} done` : todo.open ? `${todo.open} open` : '';
    $('backlog-hint').textContent = backlog.open + backlog.done ? String(backlog.open + backlog.done) : '';
    $('rail-count').textContent = String(backlog.open + backlog.done);
  }

  // ---- saving ----

  private read(): DayContent {
    return {
      todo: readTasks(this.todo!, this.originals),
      backlog: readTasks(this.backlog!, this.originals),
      notes: readNotes(this.board!, this.originals),
    };
  }

  private changed(): void {
    this.dirty = true;
    this.lastEdit = Date.now();
    this.updateCounts();
    this.scheduleSave(SAVE_DELAY);
  }

  private scheduleSave(delay: number): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), delay);
  }

  /** Writes the day if it has unsaved changes. Never rejects; a failure is shown and retried. */
  private async save(overwrite = false): Promise<void> {
    while (this.saving) await this.saving;
    clearTimeout(this.saveTimer);

    const day = this.day;
    if (!day?.editable || (!overwrite && (!this.dirty || this.conflict))) return;

    this.dirty = false;
    this.setStatus('Saving…');
    this.saving = (async () => {
      try {
        const result = await this.host.request('saveDay', { date: day.date, baseVersion: this.version, overwrite, content: this.read() });
        if (result.status === 'conflict') {
          this.dirty = true;
          this.setConflict(true);
          this.setStatus('');
        } else {
          this.version = result.version;
          this.setConflict(false);
          this.setStatus('Saved', 2000);
          // Once written, the day stands on its own.
          if (result.status === 'saved') $('carried').hidden = true;
        }
      } catch (error) {
        console.error(error);
        this.dirty = true;
        this.setStatus('Could not save. Trying again…', 0, true);
        this.scheduleSave(RETRY_DELAY);
      } finally {
        this.saving = null;
      }
    })();
    await this.saving;
  }

  private flush(): Promise<void> {
    return this.save();
  }

  private setStatus(text: string, clearAfter = 0, failed = false): void {
    clearTimeout(this.statusTimer);
    const status = $('status');
    status.textContent = text;
    status.classList.toggle('failed', failed);
    if (clearAfter) this.statusTimer = window.setTimeout(() => (status.textContent = ''), clearAfter);
  }

  private setConflict(conflict: boolean): void {
    this.conflict = conflict;
    $('conflict').hidden = !conflict;
  }

  /**
   * Catches up with the world: a new day has started, or the file changed on disk while
   * nothing here was waiting to be saved.
   */
  private async check(): Promise<void> {
    const day = this.day;
    if (!day || this.checking) return;
    this.checking = true;
    try {
      const peek = await this.host.request('peek', { date: day.date });
      if (this.day !== day) return;

      if (peek.today !== this.today) {
        if (Date.now() - this.lastEdit < IDLE_BEFORE_ROLLOVER) return;
        const wasOnToday = day.date === this.today;
        await this.flush();
        this.today = peek.today;
        await this.open(wasOnToday ? peek.today : day.date);
        return;
      }

      if (peek.version !== this.version && !this.dirty && !this.saving && !this.conflict) {
        this.show(await this.host.request('loadDay', { date: day.date }));
      }
    } catch (error) {
      console.error(error);
    } finally {
      this.checking = false;
    }
  }

  // ---- chrome ----

  private bind(): void {
    $('prev').addEventListener('click', () => this.day?.prev && void this.open(this.day.prev));
    $('next').addEventListener('click', () => this.day?.next && void this.open(this.day.next));
    $('today').addEventListener('click', () => void this.open(this.today));

    const backlogOpen = () => $('cols').classList.contains('open');
    const setBacklog = (open: boolean) => {
      $('cols').classList.toggle('open', open);
      $('rail').setAttribute('aria-expanded', String(open));
      $('rail').title = `${open ? 'Hide' : 'Show'} backlog (Ctrl+Shift+B)`;
      localStorage.setItem(BACKLOG_OPEN, open ? '1' : '0');
    };
    setBacklog(localStorage.getItem(BACKLOG_OPEN) === '1');
    // The rail stays where it is in both states, so the same click opens and closes.
    $('rail').addEventListener('click', () => setBacklog(!backlogOpen()));

    $('filter').addEventListener('click', () => this.setFilter(null));

    $('conflict-theirs').addEventListener('click', async () => {
      if (!this.day) return;
      this.dirty = false;
      this.show(await this.host.request('loadDay', { date: this.day.date }));
    });
    $('conflict-mine').addEventListener('click', () => void this.save(true));

    const menu = $('folder-menu');
    $('folder').addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target as Node)) menu.hidden = true;
    });
    $('folder-open').addEventListener('click', () => {
      menu.hidden = true;
      void this.host.request('openDataFolder');
    });
    $('folder-change').addEventListener('click', () => {
      menu.hidden = true;
      void this.chooseFolder(false);
    });
    $('welcome-suggested').addEventListener('click', () => void this.chooseFolder(true));
    $('welcome-choose').addEventListener('click', () => void this.chooseFolder(false));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!menu.hidden) menu.hidden = true;
        else if (viewState.filter) this.setFilter(null);
      }
      if (event.altKey && !event.ctrlKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const target = event.key === 'ArrowLeft' ? this.day?.prev : this.day?.next;
        if (target) void this.open(target);
      }
      // Alt+N starts a card headed with the time; Alt+Shift+N docks a side note to the card being edited.
      if (event.altKey && !event.ctrlKey && event.code === 'KeyN' && this.board?.isEditable) {
        event.preventDefault();
        if (event.shiftKey) addSide(this.board);
        else addCard(this.board, timeHeading());
      }
      if (event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setBacklog(!backlogOpen());
      }
    });

    // Leaving the window is a good moment to make sure everything is on disk.
    window.addEventListener('blur', () => void this.flush());
    document.addEventListener('visibilitychange', () => document.hidden && void this.flush());

    this.host.on('activated', () => void this.check());
    this.host.on('flush', async () => {
      await this.flush();
      await this.host.request('flushed');
    });
    window.setInterval(() => void this.check(), 60_000);
  }

  private setFolder(path: string | null): void {
    const button = $('folder');
    button.hidden = !path;
    if (!path) return;
    button.textContent = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    $('folder-path').textContent = path;
  }

  private showWelcome(suggested: string | null): void {
    $('cols').hidden = true;
    $('welcome').hidden = false;
    const button = $('welcome-suggested');
    button.hidden = !suggested;
    if (suggested) button.textContent = `Use ${suggested}`;
  }

  private async chooseFolder(useSuggested: boolean): Promise<void> {
    const error = $('welcome-error');
    error.hidden = true;
    try {
      await this.flush();
      const chosen = await this.host.request('chooseFolder', { useSuggested });
      if (!chosen) return;
      this.setFolder(chosen.dataFolder);
      this.show(chosen.day);
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : String(reason);
      error.hidden = false;
    }
  }
}

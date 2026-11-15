// The quick capture bar: one small editor, a list of suggestions, and a footer of hints.
//
// The first line is a task's title and Shift+Enter adds lines beneath it, with the same
// editor the main window uses. Enter sends it to Todo; the buttons send it to the backlog or
// make it a note card. Starting with @ picks an existing task to add to instead.

import { Editor, Extension, Node } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { docToTasks, Originals, type NodeJSON } from './editor/convert';
import { tagOf } from './editor/decorations';
import { editorProps, shared } from './editor/editors';
import { Task, TaskTitle } from './editor/schema';
import { queryAt } from './editor/tagSuggest';
import { viewState } from './editor/viewState';
import { connect, type Host } from './host';
import type { CaptureContext, CaptureKind, CaptureTask } from './types';

const MAX_ROWS = 6;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const EMPTY: NodeJSON = { type: 'doc', content: [{ type: 'task', attrs: { id: 'capture' }, content: [{ type: 'taskTitle' }] }] };

/** A document that is exactly one task: its title, and a body once there are more lines. */
const CaptureDoc = Node.create({ name: 'doc', topNode: true, content: 'task' });

type Row = { kind: 'tag'; tag: string; note: string } | { kind: 'task'; task: CaptureTask };

class Capture {
  private context: CaptureContext = { ready: false, assetBase: '', tags: [], tasks: [] };
  /** The task being added to, once one has been picked with @. */
  private target: CaptureTask | null = null;
  private rows: Row[] = [];
  private active = 0;
  /** Whether the highlighted row was chosen with the arrow keys rather than just being first. */
  private chosen = false;
  private sending = false;
  private error = '';
  private readonly editor: Editor;

  constructor(private readonly host: Host) {
    this.editor = new Editor({
      element: $('editor'),
      content: EMPTY,
      extensions: [CaptureDoc, Task, TaskTitle, ...shared(), this.keys()],
      editorProps: editorProps('tasks', {
        onChange: () => {},
        openLink: (url) => void host.request('openLink', { url }),
        saveImage: (file) => this.saveImage(file),
      }),
      onTransaction: () => this.refresh(),
    });

    $('as-note').addEventListener('click', () => void this.send('note'));
    $('as-backlog').addEventListener('click', () => void this.send('backlog'));

    // Tab walks editor -> Note card -> Backlog -> editor, and Shift+Tab back.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void this.cancel();
      } else if (event.key === 'Tab' && document.activeElement instanceof HTMLButtonElement) {
        const leaving = event.shiftKey ? document.activeElement.id === 'as-note' : document.activeElement.id === 'as-backlog';
        if (leaving) {
          event.preventDefault();
          this.editor.commands.focus();
        }
      }
    });

    // The window is as tall as the bar, whatever is in it.
    new ResizeObserver(() => void host.request('captureResize', { height: Math.ceil($('bar').getBoundingClientRect().height) })).observe($('bar'));

    host.on('shown', () => void this.shown());
    void this.shown();
  }

  /** The bar has just appeared: find out what today looks like and be ready to type. */
  private async shown(): Promise<void> {
    try {
      this.context = await this.host.request('captureContext');
      viewState.assetBase = this.context.assetBase;
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.refresh();
    this.editor.commands.focus('end');
  }

  private keys(): Extension {
    const capture = this;
    return Extension.create({
      name: 'captureKeys',
      // Ahead of the ordinary task keys: here Enter sends, and there is only ever one task.
      priority: 1200,

      addKeyboardShortcuts() {
        const move = (by: number) => () => {
          if (capture.rows.length === 0) return false;
          capture.active = (capture.active + by + capture.rows.length) % capture.rows.length;
          capture.chosen = true;
          capture.refresh();
          return true;
        };

        return {
          ArrowDown: move(1),
          ArrowUp: move(-1),

          Tab: () => {
            if (capture.rows.length > 0) return capture.accept();
            // In the title, Tab leaves for the buttons. In the notes it indents, as usual.
            if (this.editor.state.selection.$from.parent.type.name !== 'taskTitle' || $('as-note').hidden) return false;
            $('as-note').focus();
            return true;
          },

          Enter: () => {
            const row = capture.rows[capture.active];
            // A task has to be picked. A tag is only taken on Enter if it was chosen with the
            // arrows: a short title followed by Enter must stay what was typed.
            if (row?.kind === 'task' || (row && capture.chosen)) return capture.accept();
            if (capture.isPicking()) return true;
            void capture.send(capture.target ? 'append' : 'todo');
            return true;
          },

          Backspace: () => {
            const { $from, empty } = this.editor.state.selection;
            if (!empty || $from.parent.type.name !== 'taskTitle' || $from.parentOffset !== 0) return false;
            // Backspace on nothing steps back out of "add to this task".
            if (capture.target && this.editor.state.doc.textContent === '') capture.setTarget(null);
            return true;
          },

          // With a single task there is nothing to promote a line into.
          'Shift-Tab': () => {
            const { $from } = this.editor.state.selection;
            return $from.parent.type.name !== 'line' || !$from.parent.attrs.indent;
          },
        };
      },
    });
  }

  private titleText(): string {
    return this.editor.state.doc.firstChild?.firstChild?.textContent ?? '';
  }

  private isPicking(): boolean {
    return !this.target && this.titleText().startsWith('@') && this.editor.state.doc.firstChild?.childCount === 1;
  }

  /** Works out which suggestions to show, and redraws the list and the footer. */
  private refresh(): void {
    const before = this.rows.map(key).join('\n');
    this.rows = [];

    if (this.context.ready && this.isPicking()) {
      const needle = this.titleText().slice(1).trim().toLowerCase();
      this.rows = this.context.tasks
        .filter((task) => task.title.toLowerCase().includes(needle))
        .slice(0, MAX_ROWS)
        .map((task) => ({ kind: 'task', task }));
    } else if (this.context.ready && !this.target) {
      const query = queryAt(this.editor.state);
      const typed = query?.text.toLowerCase();
      if (query && typed) {
        this.rows = this.context.tags
          .filter(({ tag }) => tag.toLowerCase().startsWith(typed) && tag !== query.text)
          .slice(0, MAX_ROWS)
          .map(({ tag, open }) => ({ kind: 'tag', tag, note: `${open} open ${open === 1 ? 'task' : 'tasks'}` }));
      }
    }

    if (this.rows.map(key).join('\n') !== before) {
      this.active = 0;
      this.chosen = false;
    }
    this.draw();
  }

  private draw(): void {
    const list = $('list');
    const picking = this.isPicking();
    list.hidden = this.rows.length === 0 && !picking;
    list.replaceChildren(
      ...this.rows.map((row, index) => {
        const el = document.createElement('div');
        el.className = 'row' + (index === this.active ? ' sel' : '');
        el.setAttribute('role', 'option');
        el.append(row.kind === 'tag' ? tagLabel(row.tag) : titleWithTag(row.task.title), span(row.kind === 'tag' ? row.note : row.task.backlog ? 'Backlog' : ''));
        el.addEventListener('mousedown', (event) => {
          event.preventDefault();
          this.active = index;
          this.accept();
        });
        return el;
      }),
    );
    if (picking && this.rows.length === 0) {
      const none = document.createElement('div');
      none.className = 'none';
      none.textContent = 'No open task matches';
      list.append(none);
    }

    const plain = !picking && this.rows.length === 0 && !this.target && this.context.ready;
    $('as-note').hidden = $('as-backlog').hidden = !plain;

    const hints = $('hints');
    hints.classList.toggle('failed', !!this.error);
    if (this.error) {
      hints.textContent = this.error;
    } else if (!this.context.ready) {
      hints.replaceChildren(hint('Enter', 'open Taskii to choose where to keep your days'), hint('Esc', 'close'));
    } else if (picking) {
      hints.replaceChildren(hint('Enter', 'add to this task'), hint('Esc', 'close'));
    } else if (this.rows.length > 0) {
      hints.replaceChildren(hint('Tab', 'use tag'), hint('Esc', 'close'));
    } else if (this.target) {
      hints.replaceChildren(hint('Shift+Enter', 'new line'), hint('Enter', 'add note to task'), hint('Esc', 'close'));
    } else {
      hints.replaceChildren(hint('Shift+Enter', 'new line'), hint('Enter', 'add to Todo'));
    }
  }

  /** Takes the highlighted suggestion. */
  private accept(): boolean {
    const row = this.rows[this.active];
    if (!row) return false;

    if (row.kind === 'task') {
      this.setTarget(row.task);
      return true;
    }

    const query = queryAt(this.editor.state);
    if (!query) return false;
    this.editor.view.dispatch(this.editor.state.tr.insertText(row.tag + ': ', query.from, query.to));
    return true;
  }

  private setTarget(task: CaptureTask | null): void {
    this.target = task;
    document.body.classList.toggle('append', !!task);
    $('target').hidden = !task;
    $('target-title').replaceChildren(task ? titleWithTag(task.title) : '');
    this.clear();
  }

  private clear(): void {
    const { state, view } = this.editor;
    const tr = state.tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(EMPTY).content);
    tr.setSelection(TextSelection.create(tr.doc, 2));
    view.dispatch(tr);
    this.editor.commands.focus();
  }

  private async send(kind: CaptureKind): Promise<void> {
    if (this.sending) return;

    if (!this.context.ready) {
      await this.host.request('captureOpenMain');
      return;
    }

    const [typed] = docToTasks(this.editor.getJSON() as NodeJSON, new Originals());
    if (!typed) return;

    this.sending = true;
    this.error = '';
    try {
      // Added to a task, everything typed is notes: the first line too.
      const payload = this.target
        ? { kind: 'append' as const, title: '', body: [typed.title, typed.body].filter(Boolean).join('\n'), taskId: this.target.id }
        : { kind, title: typed.title, body: typed.body, taskId: '' };
      await this.host.request('capture', payload);
      this.setTarget(null);
    } catch (error) {
      // Nothing is lost: the text stays in the bar.
      this.error = error instanceof Error ? error.message : String(error);
      this.draw();
    } finally {
      this.sending = false;
    }
  }

  private async cancel(): Promise<void> {
    this.error = '';
    this.setTarget(null);
    await this.host.request('captureClose');
  }

  private async saveImage(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return (await this.host.request('saveAsset', { mediaType: file.type, data: btoa(binary) })).path;
  }
}

const key = (row: Row) => (row.kind === 'tag' ? `tag:${row.tag}` : `task:${row.task.id}`);

function span(text: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}

function tagLabel(tag: string): HTMLElement {
  const wrap = document.createElement('span');
  const label = span(tag);
  label.className = 'tag';
  wrap.append(label);
  return wrap;
}

/** A task title with its tag drawn as a label, as in the main window. */
function titleWithTag(title: string): HTMLElement {
  const tag = tagOf(title);
  if (!tag) return span(title);
  const wrap = tagLabel(tag);
  wrap.append(title.slice(tag.length + 1).trimStart());
  return wrap;
}

function hint(keys: string, does: string): HTMLElement {
  const el = document.createElement('span');
  const kbd = document.createElement('kbd');
  kbd.textContent = keys;
  el.append(kbd, does);
  return el;
}

connect()
  .then((host) => new Capture(host))
  .catch((error: unknown) => {
    console.error(error);
    $('hints').textContent = error instanceof Error ? error.message : String(error);
  });

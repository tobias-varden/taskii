// The three editors on the page: Todo, Backlog and the board.

import { Editor, type Extensions } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import InlineCode from '@tiptap/extension-code';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import { UndoRedo } from '@tiptap/extensions';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { NoteDto, TaskDto } from '../types';
import { Originals, docToNotes, docToTasks, notesToDoc, tasksToDoc, type NodeJSON } from './convert';
import { Blocked, type BlockedOptions } from './blocked';
import { Board, type BoardOptions } from './board';
import { Found, Ghost, Marks, UniqueIds, tagOf } from './decorations';
import { Grips, type DropIndex, type GripOptions } from './drag';
import { Fold } from './fold';
import { newTaskId } from './ids';
import { Keys, toggleLine, toggleTask, type KeysOptions } from './keys';
import { BoardDoc, Body, Card, CardTitle, Code, Image, Line, Side, Task, TaskDoc, TaskTitle } from './schema';
import { TagSuggest } from './tagSuggest';

export interface EditorHooks {
  /** The document changed because of something the user did. */
  onChange: () => void;
  openLink: (href: string) => void;
  /** Stores a pasted image and returns the path to write in the markdown. */
  saveImage: (file: File) => Promise<string>;
}

export interface BoardHooks extends EditorHooks {
  onGrab: BoardOptions['onGrab'];
  promote: KeysOptions['promote'];
}

export interface TaskHooks extends EditorHooks {
  /** IDs in use in the other column. */
  takenIds: () => Iterable<string>;
  /** Known tags, most used first. */
  tags: () => string[];
  send: KeysOptions['send'];
  onGrab: GripOptions['onGrab'];
  onTagClick: (tag: string) => void;
  blocked: BlockedOptions;
}

/** What every editor has: text, bodies, marks, undo and the keyboard rules. */
export const shared = (keys: Partial<KeysOptions> = {}): Extensions => [
  Text,
  Body,
  Line,
  Code,
  Image,
  Bold,
  Italic,
  Strike,
  InlineCode,
  Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { target: null, rel: null } }),
  UndoRedo,
  Keys.configure(keys),
  Marks,
];

/** Width of the strip to the left of a title or checkbox line that holds its checkbox. */
const GUTTER = 24;

export function editorProps(className: string, hooks: EditorHooks & Partial<Pick<TaskHooks, 'onTagClick'>>) {
  return {
    // Spell checking is off: it follows the Windows language, and on a Swedish system it underlines
    // nearly every word of English work notes.
    attributes: { class: className, spellcheck: 'false' },
    // A pasted screenshot is stored in the data folder and shown where the cursor is. Anything
    // that also carries text (a spreadsheet selection, for one) is pasted as that text.
    handlePaste(view: EditorView, event: ClipboardEvent) {
      const clipboard = event.clipboardData;
      const images = [...(clipboard?.files ?? [])].filter((file) => file.type.startsWith('image/'));
      if (!view.editable || images.length === 0 || clipboard?.getData('text/plain')) return false;

      event.preventDefault();
      void (async () => {
        for (const file of images) {
          try {
            insertImage(view, await hooks.saveImage(file));
          } catch (error) {
            console.error(error);
          }
        }
      })();
      return true;
    },
    handleDOMEvents: {
      // A click on a checkbox toggles it without moving the cursor.
      mousedown(view: EditorView, event: MouseEvent) {
        if (event.button !== 0 || !(event.target instanceof HTMLElement)) return false;

        // A click on a tag label filters by it. While its title is being edited the label is
        // ordinary text, so the tag itself can still be changed.
        const tag = event.target.closest<HTMLElement>('.tag');
        const editing = !!tag?.classList.contains('editing') && view.hasFocus();
        if (tag && !editing && hooks.onTagClick) {
          const end = view.state.doc.resolve(view.posAtDOM(tag, 0)).end();
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
          hooks.onTagClick(tag.textContent ?? '');
          event.preventDefault();
          return true;
        }

        if (!view.editable) return false;
        const el = event.target.closest<HTMLElement>('.task-title, .line[data-kind="check"]');
        if (!el) return false;

        const padding = parseFloat(getComputedStyle(el).paddingLeft);
        const x = event.clientX - el.getBoundingClientRect().left;
        if (x > padding || x < padding - GUTTER) return false;

        const $pos = view.state.doc.resolve(view.posAtDOM(el, 0));
        const tr = el.classList.contains('line')
          ? toggleLine(view.state.tr, $pos.before())
          : toggleTask(view.state.tr, $pos.before($pos.depth - 1));
        view.dispatch(tr);
        event.preventDefault();
        return true;
      },
      click(_view: EditorView, event: MouseEvent) {
        const link = event.target instanceof HTMLElement ? event.target.closest('a') : null;
        if (!link) return false;
        event.preventDefault();
        const href = link.getAttribute('href');
        if (href && event.button === 0) hooks.openLink(href);
        return true;
      },
    },
  };
}

/** Puts an image after the block the cursor is in, or at the top of the body when it is in a title. */
function insertImage(view: EditorView, src: string): void {
  const { state } = view;
  const { $from, to } = state.selection;
  const { image, line, body } = state.schema.nodes;
  const node = image.create({ src });
  const tr = state.tr;

  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.name !== 'body') depth--;

  let at: number;
  if (depth > 0) {
    const inBlock = $from.depth > depth;
    at = inBlock ? $from.after(depth + 1) : to;
    // Never leave an image as the last thing in a body: there would be nowhere to type after it.
    const last = at === $from.end(depth);
    tr.insert(at, last ? [node, line.create()] : node);
  } else if ($from.parent.type.name === 'taskTitle' || $from.parent.type.name === 'cardTitle') {
    const owner = $from.node($from.depth - 1);
    const afterTitle = $from.after();
    const hasBody = owner.childCount > 1 && owner.child(1).type.name === 'body';
    at = afterTitle + 1;
    if (hasBody) tr.insert(at, node);
    else tr.insert(afterTitle, body.create(null, [node, line.create()]));
  } else {
    return;
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(at + node.nodeSize + 1)));
  view.dispatch(tr.scrollIntoView());
}

/** Puts the cursor in the last top-level item if it is still empty, otherwise appends `make()`. */
function appendOrFocusLast(editor: Editor, make: () => NodeJSON) {
  const { state, view } = editor;
  const last = state.doc.lastChild;
  const tr = state.tr;
  let start = state.doc.content.size;

  if (last && last.textContent === '' && last.childCount <= 2) {
    start -= last.nodeSize;
  } else {
    tr.insert(start, state.schema.nodeFromJSON(make()));
  }

  tr.setSelection(TextSelection.create(tr.doc, start + 2));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export function createTaskEditor(
  element: HTMLElement,
  tasks: readonly TaskDto[],
  editable: boolean,
  originals: Originals,
  hooks: TaskHooks,
): Editor {
  return new Editor({
    element,
    editable,
    content: tasksToDoc(tasks, originals),
    extensions: [
      TaskDoc,
      Task,
      TaskTitle,
      ...shared({ send: hooks.send }),
      UniqueIds.configure({ taken: hooks.takenIds }),
      Fold,
      TagSuggest.configure({ tags: hooks.tags }),
      Blocked.configure(hooks.blocked),
      Grips.configure({ onGrab: hooks.onGrab }),
      Ghost.configure({
        label: 'New task',
        add: (editor) => appendOrFocusLast(editor, () => ({ type: 'task', attrs: { id: newTaskId() }, content: [{ type: 'taskTitle' }] })),
      }),
    ],
    editorProps: editorProps('tasks', hooks),
    onUpdate: hooks.onChange,
  });
}

export function createBoardEditor(
  element: HTMLElement,
  notes: readonly NoteDto[],
  editable: boolean,
  originals: Originals,
  hooks: BoardHooks,
): Editor {
  return new Editor({
    element,
    editable,
    content: notesToDoc(notes, originals),
    extensions: [
      BoardDoc,
      Card,
      CardTitle,
      Side,
      ...shared({ promote: hooks.promote }),
      Board.configure({ onGrab: hooks.onGrab }),
      Ghost.configure({
        label: 'Type here to start a new card',
        add: (editor) =>
          appendOrFocusLast(editor, () => ({ type: 'card', content: [{ type: 'cardTitle' }, { type: 'body', content: [{ type: 'line' }] }] })),
      }),
    ],
    editorProps: editorProps('cards', hooks),
    onUpdate: hooks.onChange,
  });
}

/**
 * One task or one note card as it was on some day, to be read and nothing else: no folding,
 * no tools, and the words that were searched for marked.
 */
export function createPreviewEditor(
  element: HTMLElement,
  item: { task?: TaskDto | null; note?: NoteDto | null },
  find: RegExp | null,
  openLink: (href: string) => void,
): Editor {
  const originals = new Originals();
  const hooks: EditorHooks = { onChange: () => {}, openLink, saveImage: () => Promise.reject(new Error('Read-only')) };
  return new Editor({
    element,
    editable: false,
    content: item.task ? tasksToDoc([item.task], originals) : notesToDoc(item.note ? [item.note] : [], originals),
    extensions: [...(item.task ? [TaskDoc, Task, TaskTitle] : [BoardDoc, Card, CardTitle, Side]), ...shared(), Found.configure({ find })],
    editorProps: editorProps(item.task ? 'tasks' : 'preview-cards', hooks),
  });
}

export const readTasks = (editor: Editor, originals: Originals) => docToTasks(editor.getJSON() as NodeJSON, originals);

export const readNotes = (editor: Editor, originals: Originals) => docToNotes(editor.getJSON() as NodeJSON, originals);

/** The IDs of the tasks in a column. */
export function taskIds(editor: Editor | undefined): string[] {
  const ids: string[] = [];
  editor?.state.doc.forEach((node) => {
    if (node.attrs.id) ids.push(node.attrs.id);
  });
  return ids;
}

export interface Counts {
  open: number;
  done: number;
}

export function countTasks(editor: Editor): Counts {
  const counts = { open: 0, done: 0 };
  editor.state.doc.forEach((node) => {
    if (node.textContent === '') return;
    if (node.attrs.done) counts.done++;
    else counts.open++;
  });
  return counts;
}

/** Tags used in these columns, most used first. */
export function collectTags(...editors: Array<Editor | undefined>): string[] {
  const uses = new Map<string, number>();
  for (const editor of editors) {
    editor?.state.doc.forEach((task) => {
      const tag = tagOf(task.child(0).textContent);
      if (tag) uses.set(tag, (uses.get(tag) ?? 0) + 1);
    });
  }
  return [...uses.keys()].sort((a, b) => uses.get(b)! - uses.get(a)! || a.localeCompare(b));
}

/**
 * Moves a task to another place in its column, or to the other column. `index` counts
 * tasks in the target column as it is before the move.
 */
export function moveTask(source: Editor, taskId: string, target: Editor, index: DropIndex): boolean {
  let found: { pos: number; index: number } | undefined;
  source.state.doc.forEach((node, pos, i) => {
    if (node.attrs.id === taskId) found = { pos, index: i };
  });
  if (!found) return false;

  const task = source.state.doc.child(found.index);
  const offsetOf = (editor: Editor) => {
    const doc = editor.state.doc;
    if (index === 'start') return 0;
    if (index === 'end' || index >= doc.childCount) return doc.content.size;
    let offset = 0;
    for (let i = 0; i < index; i++) offset += doc.child(i).nodeSize;
    return offset;
  };

  if (source === target) {
    const at = offsetOf(source);
    if (at === found.pos || at === found.pos + task.nodeSize) return false;
    const tr = source.state.tr.delete(found.pos, found.pos + task.nodeSize);
    source.view.dispatch(tr.insert(tr.mapping.map(at), task));
    return true;
  }

  // Out of the source first. While the task is in both columns its ID counts as a duplicate,
  // and it would be given a new one: the ID is what links a task across days.
  source.view.dispatch(source.state.tr.delete(found.pos, found.pos + task.nodeSize));
  target.view.dispatch(target.state.tr.insert(offsetOf(target), target.schema.nodeFromJSON(task.toJSON())));
  return true;
}

/** Redraws decorations that depend on view state rather than on the document. */
export function redraw(editor: Editor | undefined): void {
  editor?.view.dispatch(editor.state.tr.setMeta('redraw', true));
}

/** Adds a task to the end of a column from inline content, as when a note line is promoted. */
export function appendTask(editor: Editor, taken: Iterable<string>, title: unknown, done: boolean): void {
  const node = editor.schema.nodeFromJSON({
    type: 'task',
    attrs: { id: newTaskId(new Set(taken)), done, fields: [] },
    content: [{ type: 'taskTitle', ...(title ? { content: title } : {}) }],
  });
  editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, node));
}

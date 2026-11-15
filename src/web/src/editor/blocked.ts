// "Blocked by": a task that waits for another open task. In the file it is the inline field
// `[blocked-by:: ^id]` on the waiting task. Nothing is stored about being unblocked: a task
// is blocked for as long as the task it points at is open, so checking that one off is all
// it takes, and unchecking it blocks again.

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { parseInline } from '../markdown/inline';
import type { TaskField } from '../types';
import { tagOf } from './decorations';
import { newTaskId } from './ids';

const FIELD = 'blocked-by';

/** The ID of the task these fields say to wait for. */
export function blockerOf(fields: readonly TaskField[] | undefined): string | null {
  const value = fields?.find((field) => field.key === FIELD)?.value.replace(/^\^/, '');
  return value || null;
}

export interface OpenTask {
  id: string;
  /** As shown, tag included. */
  title: string;
  blockedBy: string | null;
}

/** The tasks in a column that are not done and have a title to go by. */
export function openTasks(editor: Editor | undefined): OpenTask[] {
  const tasks: OpenTask[] = [];
  editor?.state.doc.forEach((node) => {
    const title = node.child(0).textContent;
    if (node.attrs.id && !node.attrs.done && title.trim()) tasks.push({ id: node.attrs.id, title, blockedBy: blockerOf(node.attrs.fields) });
  });
  return tasks;
}

/**
 * The tasks `taskId` could wait for: every other open task, except those that wait for it,
 * directly or through others. Two tasks waiting for each other would never be done.
 */
export function candidates(taskId: string, open: readonly OpenTask[]): OpenTask[] {
  const byId = new Map(open.map((task) => [task.id, task]));
  const waitsFor = (task: OpenTask): boolean => {
    const seen = new Set<string>();
    for (let at: OpenTask | undefined = task; at && !seen.has(at.id); at = at.blockedBy ? byId.get(at.blockedBy) : undefined) {
      if (at.id === taskId) return true;
      seen.add(at.id);
    }
    return false;
  };
  return open.filter((task) => !waitsFor(task));
}

function find(editor: Editor, taskId: string): { pos: number; index: number } | null {
  let found: { pos: number; index: number } | null = null;
  editor.state.doc.forEach((node, pos, index) => {
    if (node.attrs.id === taskId) found = { pos, index };
  });
  return found;
}

function withBlocker(fields: readonly TaskField[], blockerId: string | null): TaskField[] {
  const rest = fields.filter((field) => field.key !== FIELD);
  return blockerId ? [...rest, { key: FIELD, value: '^' + blockerId }] : rest;
}

/** Makes a task wait for another, or for nothing when `blockerId` is null. */
export function setBlocker(editor: Editor, taskId: string, blockerId: string | null): boolean {
  const at = find(editor, taskId);
  if (!at) return false;
  const node = editor.state.doc.child(at.index);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(at.pos, undefined, { ...node.attrs, fields: withBlocker(node.attrs.fields, blockerId) }));
  return true;
}

/** Adds a new task directly above `taskId` and makes `taskId` wait for it. One step to undo. */
export function addBlocker(editor: Editor, taskId: string, title: string, taken: Iterable<string>): boolean {
  const at = find(editor, taskId);
  if (!at) return false;
  const node = editor.state.doc.child(at.index);
  const id = newTaskId(new Set(taken));
  const content = parseInline(title.replace(/\s+/g, ' ').trim());
  const blocker = editor.schema.nodeFromJSON({
    type: 'task',
    attrs: { id, done: false, fields: [] },
    content: [{ type: 'taskTitle', ...(content.length ? { content } : {}) }],
  });

  const tr = editor.state.tr.setNodeMarkup(at.pos, undefined, { ...node.attrs, fields: withBlocker(node.attrs.fields, id) });
  editor.view.dispatch(tr.insert(at.pos, blocker));
  return true;
}

export interface BlockedOptions {
  /** The title of an open task in either column. Null when there is none with that ID, or it is done. */
  openTitle: (id: string) => string | null;
  /** Asks what the task should wait for. */
  pick: (editor: Editor, taskId: string) => void;
}

/** Dims the tasks that are waiting and says what for; Alt+B chooses what a task waits for. */
export const Blocked = Extension.create<BlockedOptions>({
  name: 'blocked',

  addOptions() {
    return { openTitle: () => null, pick: () => {} };
  },

  addKeyboardShortcuts() {
    return {
      'Alt-b': () => {
        const { $from } = this.editor.state.selection;
        const task = $from.depth >= 1 ? $from.node(1) : null;
        if (!this.editor.isEditable || task?.type.name !== 'task' || !task.attrs.id) return false;
        this.options.pick(this.editor, task.attrs.id);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { openTitle, pick } = this.options;

    const label = (taskId: string, title: string) => () => {
      const tag = tagOf(title);
      const el = document.createElement('span');
      el.className = 'blocked-by';
      el.contentEditable = 'false';
      el.textContent = `blocked by ${tag ? title.slice(tag.length + 1).trimStart() : title}`;
      if (editor.isEditable) {
        el.title = 'Change what this waits for (Alt+B)';
        el.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          pick(editor, taskId);
        });
      }
      return el;
    };

    return [
      new Plugin({
        key: new PluginKey('blocked'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.forEach((node, pos) => {
              const blocker = node.type.name === 'task' && !node.attrs.done ? blockerOf(node.attrs.fields) : null;
              const title = blocker && blocker !== node.attrs.id ? openTitle(blocker) : null;
              if (title === null) return;

              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'blocked' }));
              // At the end of the title, after the cursor if it is there.
              const end = pos + 1 + node.child(0).nodeSize - 1;
              decorations.push(Decoration.widget(end, label(node.attrs.id, title), { side: 1, key: `blocked ${node.attrs.id} ${title}`, ignoreSelection: true }));
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

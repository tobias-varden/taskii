// How the keyboard behaves inside tasks and cards.
//
// Most commands work the same way: take the task or card the cursor is in apart into its
// title and body lines, build what it should become, and replace it in one step. That keeps
// each rule readable and makes every one of them a single undo.

import { Extension } from '@tiptap/core';
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { MAX_INDENT } from '../markdown/body';
import type { TaskField } from '../types';
import { localStamp, newTaskId } from './ids';

type Command = (state: EditorState, dispatch: (tr: Transaction) => void) => boolean;

/** Where the cursor is, in terms of the task, card or side note that owns it. */
interface Place {
  role: 'title' | 'line' | 'code';
  block: PMNode;
  blockPos: number;
  offset: number;
  offsetTo: number;
  /** Index of the block within its body; -1 for a title. */
  index: number;
  owner: PMNode;
  ownerPos: number;
  ownerEnd: number;
  title: PMNode;
  lines: PMNode[];
}

function place(state: EditorState): Place | null {
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to)) return null;

  const block = $from.parent;
  const name = block.type.name;
  const role = name === 'taskTitle' || name === 'cardTitle' ? 'title' : name === 'line' ? 'line' : name === 'codeBlock' ? 'code' : null;
  if (!role) return null;

  const ownerDepth = $from.depth - (role === 'title' ? 1 : 2);
  if (ownerDepth < 1) return null;

  const owner = $from.node(ownerDepth);
  const ownerPos = $from.before(ownerDepth);
  return {
    role,
    block,
    blockPos: $from.before(),
    offset: $from.parentOffset,
    offsetTo: $to.parentOffset,
    index: role === 'title' ? -1 : $from.index($from.depth - 1),
    owner,
    ownerPos,
    ownerEnd: ownerPos + owner.nodeSize,
    title: owner.child(0),
    lines: linesOf(owner),
  };
}

function linesOf(owner: PMNode): PMNode[] {
  const lines: PMNode[] = [];
  if (owner.childCount > 1 && owner.child(1).type.name === 'body') owner.child(1).forEach((n) => lines.push(n));
  return lines;
}

/** The same task, card or side note with a different title and body. */
function rebuild(owner: PMNode, title: Fragment, lines: PMNode[]): PMNode {
  const { nodes } = owner.type.schema;
  const children = [owner.child(0).type.create(null, title)];
  if (lines.length) {
    children.push(nodes.body.create(null, lines));
  } else if (owner.type !== nodes.task) {
    children.push(nodes.body.create(null, nodes.line.create()));
  }
  owner.forEach((child) => {
    if (child.type.name === 'side') children.push(child);
  });
  return owner.type.create(owner.attrs, children);
}

function newTask(schema: Schema, title: Fragment, lines: PMNode[] = [], done = false): PMNode {
  const fields: TaskField[] = done ? [{ key: 'done', value: localStamp() }] : [];
  const children = [schema.nodes.taskTitle.create(null, title)];
  if (lines.length) children.push(schema.nodes.body.create(null, lines));
  return schema.nodes.task.create({ id: newTaskId(), done, fields }, children);
}

/** Cursor position `offset` into the title of a node that starts at `start`. */
const inTitle = (start: number, offset: number) => start + 2 + offset;

/** Cursor position `offset` into body line `index` of `node`, which starts at `start`. */
function inLine(start: number, node: PMNode, index: number, offset: number): number {
  let pos = start + 1 + node.child(0).nodeSize + 1;
  const body = node.child(1);
  for (let i = 0; i < index; i++) pos += body.child(i).nodeSize;
  return pos + 1 + offset;
}

function swap(state: EditorState, from: number, to: number, nodes: PMNode[], cursor: (start: number) => number): Transaction {
  const tr = state.tr.replaceWith(from, to, nodes);
  tr.setSelection(TextSelection.create(tr.doc, cursor(from)));
  return tr.scrollIntoView();
}

const isBlankLine = (node: PMNode) => node.type.name === 'line' && node.content.size === 0;

function isBlank(owner: PMNode): boolean {
  let sides = 0;
  owner.forEach((child) => {
    if (child.type.name === 'side') sides++;
  });
  return owner.child(0).content.size === 0 && sides === 0 && linesOf(owner).every(isBlankLine);
}

function reindent(node: PMNode, delta: number): PMNode {
  const indent = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + delta));
  return node.type.create({ ...node.attrs, indent }, node.content, node.marks);
}

/** Tab and Shift+Tab on body lines: indent or outdent every line the selection touches. */
function shiftLines(state: EditorState, dispatch: (tr: Transaction) => void, delta: number): boolean {
  const { from, to } = state.selection;
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'line' && node.type.name !== 'codeBlock' && node.type.name !== 'image') return true;
    const indent = Math.max(0, Math.min(MAX_INDENT, node.attrs.indent + delta));
    if (indent !== node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
    return false;
  });
  if (tr.docChanged) dispatch(tr);
  return true;
}

/** Moves from a title into the body, taking any text after the cursor along. */
function intoBody(state: EditorState, dispatch: (tr: Transaction) => void, p: Place): boolean {
  const { owner, ownerPos, title, lines } = p;
  const after = title.content.cut(p.offsetTo);

  if (state.selection.empty && after.size === 0 && lines.length > 0 && isBlankLine(lines[0]) && lines[0].attrs.kind === 'text') {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, inLine(ownerPos, owner, 0, 0))).scrollIntoView());
    return true;
  }

  const line = state.schema.nodes.line.create(null, after);
  const next = rebuild(owner, title.content.cut(0, p.offset), [line, ...lines]);
  dispatch(swap(state, ownerPos, p.ownerEnd, [next], (start) => inLine(start, next, 0, 0)));
  return true;
}

function splitLine(state: EditorState, dispatch: (tr: Transaction) => void, p: Place): boolean {
  const { kind, indent } = p.block.attrs;
  const tr = state.tr;
  if (!state.selection.empty) tr.deleteSelection();
  tr.split(tr.selection.from, 1, [{ type: state.schema.nodes.line, attrs: { kind, indent, checked: false } }]);
  dispatch(tr.scrollIntoView());
  return true;
}

const enter: Command = (state, dispatch) => {
  const p = place(state);
  if (!p || p.role === 'code') return false;
  const { owner, ownerPos, ownerEnd, title, lines } = p;
  const isTask = owner.type.name === 'task';

  if (p.role === 'title') {
    if (!isTask) return intoBody(state, dispatch, p);
    if (title.content.size === 0 && lines.length === 0) return true;

    if (p.offsetTo === 0) {
      // At the start of a title, the new task opens above and the cursor stays with the text.
      const blank = newTask(state.schema, Fragment.empty);
      dispatch(swap(state, ownerPos, ownerEnd, [blank, owner], (start) => inTitle(start + blank.nodeSize, 0)));
      return true;
    }

    const first = rebuild(owner, title.content.cut(0, p.offset), lines);
    const second = newTask(state.schema, title.content.cut(p.offsetTo));
    dispatch(swap(state, ownerPos, ownerEnd, [first, second], (start) => inTitle(start + first.nodeSize, 0)));
    return true;
  }

  // Enter on an empty line steps out one level at a time: bullet to text, indented to not,
  // and finally out of the task's body into a new task.
  if (p.block.content.size === 0) {
    const attrs = p.block.attrs;
    if (attrs.kind !== 'text') {
      dispatch(state.tr.setNodeMarkup(p.blockPos, undefined, { ...attrs, kind: 'text', checked: false }));
      return true;
    }
    if (attrs.indent > 0) {
      dispatch(state.tr.setNodeMarkup(p.blockPos, undefined, { ...attrs, indent: attrs.indent - 1 }));
      return true;
    }
    if (isTask && p.index === lines.length - 1) {
      const first = rebuild(owner, title.content, lines.slice(0, -1));
      const second = newTask(state.schema, Fragment.empty);
      dispatch(swap(state, ownerPos, ownerEnd, [first, second], (start) => inTitle(start + first.nodeSize, 0)));
      return true;
    }
  }

  return splitLine(state, dispatch, p);
};

const shiftEnter: Command = (state, dispatch) => {
  const p = place(state);
  if (!p) return false;
  if (p.role === 'title') return intoBody(state, dispatch, p);
  if (p.role === 'line') return splitLine(state, dispatch, p);
  dispatch(state.tr.insertText('\n').scrollIntoView());
  return true;
};

const backspace: Command = (state, dispatch) => {
  const p = place(state);
  if (!p || p.role === 'code' || !state.selection.empty || p.offset !== 0) return false;
  const { owner, ownerPos, ownerEnd, title, lines } = p;

  if (p.role === 'title') {
    // Backspace never merges one task or card into another. An empty one is removed.
    if (isBlank(owner)) {
      const tr = state.tr.delete(ownerPos, ownerEnd);
      const $pos = tr.doc.resolve(Math.min(ownerPos, tr.doc.content.size));
      const selection = Selection.findFrom($pos, -1, true) ?? Selection.findFrom($pos, 1, true);
      if (selection) tr.setSelection(selection);
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  const attrs = p.block.attrs;
  if (attrs.kind !== 'text') {
    dispatch(state.tr.setNodeMarkup(p.blockPos, undefined, { ...attrs, kind: 'text', checked: false }));
    return true;
  }
  if (attrs.indent > 0) {
    dispatch(state.tr.setNodeMarkup(p.blockPos, undefined, { ...attrs, indent: attrs.indent - 1 }));
    return true;
  }
  if (p.index > 0) return false;

  // The first body line joins the end of the title.
  const next = rebuild(owner, title.content.append(p.block.content), lines.slice(1));
  dispatch(swap(state, ownerPos, ownerEnd, [next], (start) => inTitle(start, title.content.size)));
  return true;
};

const del: Command = (state, dispatch) => {
  const p = place(state);
  if (!p || p.role === 'code' || !state.selection.empty || p.offset !== p.block.content.size) return false;
  const { owner, ownerPos, ownerEnd, title, lines } = p;

  if (p.role === 'line') return p.index === lines.length - 1;

  const first = lines[0];
  if (first?.type.name === 'line') {
    const next = rebuild(owner, title.content.append(first.content), lines.slice(1));
    dispatch(swap(state, ownerPos, ownerEnd, [next], (start) => inTitle(start, title.content.size)));
  }
  return true;
};

const tab: Command = (state, dispatch) => {
  const p = place(state);
  if (!p) return shiftLines(state, dispatch, 1);
  if (p.role === 'code') return false;
  if (p.role === 'line') return shiftLines(state, dispatch, 1);

  const { owner, ownerPos, ownerEnd, title, lines } = p;
  const index = state.doc.resolve(ownerPos).index();
  if (owner.type.name !== 'task' || index === 0) return true;

  // Tab on a task tucks it under the task above: a fresh empty task becomes a line of notes,
  // a task that already says something becomes a nested checkbox with its notes beneath it.
  const above = state.doc.child(index - 1);
  const abovePos = ownerPos - above.nodeSize;
  const kept = linesOf(above);
  const { line } = state.schema.nodes;
  const moved = isBlank(owner)
    ? [line.create()]
    : [line.create({ kind: 'check', checked: owner.attrs.done }, title.content), ...lines.map((n) => reindent(n, 1))];

  const next = rebuild(above, above.child(0).content, [...kept, ...moved]);
  dispatch(swap(state, abovePos, ownerEnd, [next], (start) => inLine(start, next, kept.length, p.offset)));
  return true;
};

const shiftTab: Command = (state, dispatch) => {
  const p = place(state);
  if (!p) return shiftLines(state, dispatch, -1);
  if (p.role === 'code') return false;
  if (p.role === 'title') return true;

  const { owner, ownerPos, ownerEnd, title, lines } = p;
  if (p.block.attrs.indent > 0 || owner.type.name !== 'task') return shiftLines(state, dispatch, -1);

  // Shift+Tab on an unindented line promotes it to a task of its own. Lines indented beneath
  // it come along as its notes.
  let stop = p.index + 1;
  while (stop < lines.length && lines[stop].attrs.indent > 0) stop++;

  const done = p.block.attrs.kind === 'check' && p.block.attrs.checked;
  const first = rebuild(owner, title.content, [...lines.slice(0, p.index), ...lines.slice(stop)]);
  const second = newTask(state.schema, p.block.content, lines.slice(p.index + 1, stop).map((n) => reindent(n, -1)), done);
  dispatch(swap(state, ownerPos, ownerEnd, [first, second], (start) => inTitle(start + first.nodeSize, p.offset)));
  return true;
};

/** Checks or unchecks the task at `pos`, stamping the time it was done. */
export function toggleTask(tr: Transaction, pos: number): Transaction {
  const node = tr.doc.nodeAt(pos);
  if (node?.type.name !== 'task') return tr;
  const done = !node.attrs.done;
  const fields = (node.attrs.fields as TaskField[]).filter((f) => f.key !== 'done');
  if (done) fields.push({ key: 'done', value: localStamp() });
  return tr.setNodeMarkup(pos, undefined, { ...node.attrs, done, fields });
}

/** Checks or unchecks the nested checkbox line at `pos`. */
export function toggleLine(tr: Transaction, pos: number): Transaction {
  const node = tr.doc.nodeAt(pos);
  if (node?.type.name !== 'line' || node.attrs.kind !== 'check') return tr;
  return tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked });
}

const toggle: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type.name === 'line' && $from.parent.attrs.kind === 'check') {
    dispatch(toggleLine(state.tr, $from.before()));
    return true;
  }
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'task') {
      dispatch(toggleTask(state.tr, $from.before(depth)));
      return true;
    }
  }
  return false;
};

/** Alt+Up and Alt+Down: move the task or card the cursor is in past its neighbour. */
const move = (direction: -1 | 1): Command => (state, dispatch) => {
  const { $from, anchor, head } = state.selection;
  if ($from.depth < 1) return false;

  const index = $from.index(0);
  const other = index + direction;
  if (other < 0 || other >= state.doc.childCount) return true;

  const node = state.doc.child(index);
  const neighbour = state.doc.child(other);
  const pos = $from.before(1);
  const from = direction < 0 ? pos - neighbour.nodeSize : pos;
  const to = direction < 0 ? pos + node.nodeSize : pos + node.nodeSize + neighbour.nodeSize;
  const shift = direction < 0 ? -neighbour.nodeSize : neighbour.nodeSize;

  const tr = state.tr.replaceWith(from, to, direction < 0 ? [node, neighbour] : [neighbour, node]);
  tr.setSelection(TextSelection.create(tr.doc, anchor + shift, head + shift));
  dispatch(tr.scrollIntoView());
  return true;
};

export interface KeysOptions {
  /** Sends the task with this ID to the column on that side. Returns false if there is none. */
  send: (direction: 'left' | 'right', taskId: string) => boolean;
  /** Turns a line of a note into a task. Returns false if that is not possible here. */
  promote: (line: PMNode) => boolean;
}

export const Keys = Extension.create<KeysOptions>({
  name: 'taskiiKeys',
  priority: 1000,

  addOptions() {
    return { send: () => false, promote: () => false };
  },

  addKeyboardShortcuts() {
    const run = (command: Command) => () => command(this.editor.state, this.editor.view.dispatch);
    const send = (direction: 'left' | 'right') => () => {
      const { $from } = this.editor.state.selection;
      const task = $from.depth >= 1 ? $from.node(1) : null;
      return task?.type.name === 'task' && !!task.attrs.id && this.options.send(direction, task.attrs.id);
    };
    return {
      'Alt-Shift-ArrowRight': send('right'),
      'Alt-Shift-ArrowLeft': () => {
        if (send('left')()) return true;

        // In a note, the same key lifts the line out to become a task.
        const { state, view } = this.editor;
        const p = place(state);
        if (p?.role !== 'line' || p.owner.type.name === 'task' || p.block.content.size === 0) return false;
        if (!this.options.promote(p.block)) return false;

        const next = rebuild(p.owner, p.title.content, p.lines.filter((_, index) => index !== p.index));
        const tr = state.tr.replaceWith(p.ownerPos, p.ownerEnd, next);
        const at = Math.min(p.blockPos, tr.doc.content.size);
        tr.setSelection(Selection.near(tr.doc.resolve(at), -1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      Enter: run(enter),
      'Shift-Enter': run(shiftEnter),
      Backspace: run(backspace),
      Delete: run(del),
      Tab: run(tab),
      'Shift-Tab': run(shiftTab),
      'Mod-Enter': run(toggle),
      'Alt-ArrowUp': run(move(-1)),
      'Alt-ArrowDown': run(move(1)),
    };
  },
});

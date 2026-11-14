// The document shapes.
//
// A task column is a list of tasks; each task is a title and an optional body. The board is
// a list of cards; each card is a title, a body, and any side notes docked to it. Bodies are
// the same everywhere: lines and code blocks.

import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import type { LineKind } from '../markdown/body';
import type { TaskField } from '../types';
import { viewState } from './viewState';

export const TaskDoc = Node.create({ name: 'doc', topNode: true, content: 'task*' });

export const BoardDoc = Node.create({ name: 'doc', topNode: true, content: 'card*' });

export const Task = Node.create({
  name: 'task',
  content: 'taskTitle body?',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-id') ?? '',
        renderHTML: (attrs) => ({ 'data-id': attrs.id }),
      },
      done: {
        default: false,
        parseHTML: (el) => el.hasAttribute('data-done'),
        renderHTML: (attrs) => (attrs.done ? { 'data-done': '' } : {}),
      },
      fields: {
        default: [] as TaskField[],
        parseHTML: (el) => parseFields(el.getAttribute('data-fields')),
        renderHTML: (attrs) => (attrs.fields?.length ? { 'data-fields': JSON.stringify(attrs.fields) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="task"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'task', class: 'task' }), 0];
  },
});

export const TaskTitle = Node.create({
  name: 'taskTitle',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="task-title"]' }];
  },

  renderHTML() {
    return ['div', { 'data-type': 'task-title', class: 'task-title' }, 0];
  },
});

export const Body = Node.create({
  name: 'body',
  content: '(line | codeBlock | image)+',

  parseHTML() {
    return [{ tag: 'div[data-type="body"]' }];
  },

  renderHTML() {
    return ['div', { 'data-type': 'body', class: 'body' }, 0];
  },
});

export const Line = Node.create({
  name: 'line',
  content: 'inline*',

  addAttributes() {
    return {
      kind: {
        default: 'text' as LineKind,
        parseHTML: (el) => el.getAttribute('data-kind') ?? (el.tagName === 'LI' ? 'bullet' : 'text'),
        renderHTML: (attrs) => ({ 'data-kind': attrs.kind }),
      },
      indent: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
        renderHTML: (attrs) => (attrs.indent ? { 'data-indent': attrs.indent, style: `--indent: ${attrs.indent}` } : {}),
      },
      checked: {
        default: false,
        parseHTML: (el) => el.hasAttribute('data-checked'),
        renderHTML: (attrs) => (attrs.checked ? { 'data-checked': '' } : {}),
      },
    };
  },

  parseHTML() {
    // Pasted paragraphs and list items become lines; nesting is flattened.
    return [{ tag: 'div[data-type="line"]' }, { tag: 'p' }, { tag: 'li' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'line', class: 'line' }), 0];
  },

  addInputRules() {
    const turnInto = (find: RegExp, from: LineKind[], kind: LineKind, checked = false) =>
      new InputRule({
        find,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const node = $from.parent;
          if (node.type !== this.type || !from.includes(node.attrs.kind)) return null;
          state.tr
            .delete(range.from, range.to)
            .setNodeMarkup($from.before(), undefined, { ...node.attrs, kind, checked });
        },
      });

    return [
      turnInto(/^[-*] $/, ['text'], 'bullet'),
      turnInto(/^\[ ?\] $/, ['text', 'bullet'], 'check'),
      turnInto(/^\[[xX]\] $/, ['text', 'bullet'], 'check', true),
    ];
  },
});

export const Code = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      indent: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
        renderHTML: (attrs) => (attrs.indent ? { 'data-indent': attrs.indent, style: `--indent: ${attrs.indent}` } : {}),
      },
    };
  },
}).configure({ enableTabIndentation: true, tabSize: 2 });

/** Where an image is loaded from: files in the data folder's assets come through the shell. */
export function imageUrl(src: string): string {
  return src.startsWith('assets/') ? viewState.assetBase + src.slice('assets/'.length) : src;
}

export const Image = Node.create({
  name: 'image',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      src: { default: '', parseHTML: (el) => el.getAttribute('data-src') ?? '', renderHTML: () => ({}) },
      alt: { default: '', parseHTML: (el) => el.getAttribute('alt') ?? '', renderHTML: () => ({}) },
      indent: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    // Only images this editor rendered itself; an image copied from a web page is not stored.
    return [{ tag: 'img[data-src]' }];
  },

  renderHTML({ node }) {
    const { src, alt, indent } = node.attrs;
    return [
      'img',
      {
        class: 'image',
        src: imageUrl(src),
        'data-src': src,
        alt,
        draggable: 'false',
        ...(indent ? { 'data-indent': indent, style: `--indent: ${indent}` } : {}),
      },
    ];
  },
});

export const Card = Node.create({
  name: 'card',
  content: 'cardTitle body side*',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'section[data-type="card"]' }];
  },

  renderHTML() {
    return ['section', { 'data-type': 'card', class: 'card' }, 0];
  },
});

export const Side = Node.create({
  name: 'side',
  content: 'cardTitle body',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'aside[data-type="side"]' }];
  },

  renderHTML() {
    return ['aside', { 'data-type': 'side', class: 'side' }, 0];
  },
});

export const CardTitle = Node.create({
  name: 'cardTitle',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="card-title"]' }];
  },

  renderHTML() {
    return ['div', { 'data-type': 'card-title', class: 'card-title' }, 0];
  },
});

function parseFields(json: string | null): TaskField[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((f): f is TaskField => typeof f?.key === 'string' && typeof f?.value === 'string')
      : [];
  } catch {
    return [];
  }
}

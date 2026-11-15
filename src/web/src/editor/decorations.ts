// Things drawn on top of the document that are not part of it: tag labels, placeholders in
// empty titles, the "new task" line, and unique task IDs.

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { newTaskId } from './ids';
import { viewState } from './viewState';

/** The tag is the text before the first colon in a task title: "ACME" in "ACME: Fix users". */
const TAG = /^([^\s:][^:]{0,23}):(?= |$)/;

export function tagOf(title: string): string | null {
  const match = TAG.exec(title);
  return match && !/https?$/i.test(match[1]) ? match[1] : null;
}

const PLACEHOLDER: Record<string, string> = { taskTitle: 'New task', cardTitle: 'Heading' };

export const Marks = Extension.create({
  name: 'taskiiDecorations',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('taskiiDecorations'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            const { from, to } = state.selection;
            const filter = viewState.filter;

            state.doc.descendants((node, pos) => {
              const name = node.type.name;

              if (name === 'task' && filter) {
                // The task being typed in stays put even if it does not match (yet).
                const holdsCursor = editor.isFocused && from > pos && to < pos + node.nodeSize;
                if (tagOf(node.child(0).textContent) !== filter && !holdsCursor) {
                  decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'filtered' }));
                  return false;
                }
              }

              if (name !== 'taskTitle' && name !== 'cardTitle') return name !== 'line' && name !== 'codeBlock';

              if (node.content.size === 0) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-empty', 'data-placeholder': PLACEHOLDER[name] }));
              } else if (name === 'taskTitle') {
                const text = node.textContent;
                const tag = tagOf(text);
                if (tag) {
                  // While the cursor is in the title the colon is shown, so what is typed is what is seen.
                  const editing = from > pos && to < pos + node.nodeSize ? ' editing' : '';
                  const start = pos + 1;
                  const colon = start + tag.length;
                  decorations.push(Decoration.inline(start, colon, { class: 'tag' + editing }));
                  decorations.push(Decoration.inline(colon, colon + (text[tag.length + 1] === ' ' ? 2 : 1), { class: 'tag-sep' + editing }));
                }
              }
              return false;
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export interface FoundOptions {
  /** Matches what was searched for. Global. */
  find: RegExp | null;
}

/** Marks the words that were searched for, where an item is shown as a search result. */
export const Found = Extension.create<FoundOptions>({
  name: 'found',

  addOptions() {
    return { find: null };
  },

  addProseMirrorPlugins() {
    const { find } = this.options;
    if (!find) return [];
    return [
      new Plugin({
        key: new PluginKey('found'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const match of node.text.matchAll(find)) {
                decorations.push(Decoration.inline(pos + match.index, pos + match.index + match[0].length, { nodeName: 'mark' }));
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export interface GhostOptions {
  label: string;
  /** Adds a new empty item at the end and puts the cursor in it. */
  add: (editor: Editor) => void;
}

/** The quiet "New task" / "start a new card" line at the end, which is a click target and nothing more. */
export const Ghost = Extension.create<GhostOptions>({
  name: 'ghost',

  addOptions() {
    return { label: '', add: () => {} };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { label, add } = this.options;

    const render = () => {
      const el = document.createElement('div');
      el.className = 'ghost';
      el.textContent = label;
      el.contentEditable = 'false';
      el.addEventListener('mousedown', (event) => {
        event.preventDefault();
        add(editor);
      });
      return el;
    };

    return [
      new Plugin({
        key: new PluginKey('ghost'),
        props: {
          decorations(state) {
            if (!editor.isEditable) return null;
            // An empty last item already invites typing with its own placeholder.
            const last = state.doc.lastChild;
            if (last && last.textContent === '' && last.childCount <= 2) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(state.doc.content.size, render, { side: 1, key: 'ghost', ignoreSelection: true }),
            ]);
          },
        },
      }),
    ];
  },
});

export interface UniqueIdOptions {
  /** IDs in use outside this editor, for example in the other task column. */
  taken: () => Iterable<string>;
}

/** Gives every task an ID, and a fresh one to the copy when a task is pasted twice. */
export const UniqueIds = Extension.create<UniqueIdOptions>({
  name: 'uniqueIds',

  addOptions() {
    return { taken: () => [] };
  },

  addProseMirrorPlugins() {
    const { taken } = this.options;
    return [
      new Plugin({
        key: new PluginKey('uniqueIds'),
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const seen = new Set(taken());
          const tr = state.tr;
          state.doc.forEach((node, pos) => {
            if (node.type.name !== 'task') return;
            let id: string = node.attrs.id;
            if (!id || seen.has(id)) {
              id = newTaskId(seen);
              tr.setNodeAttribute(pos, 'id', id);
            }
            seen.add(id);
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

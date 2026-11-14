// Folding a task down to its title.
//
// Which tasks are folded is how this machine likes to look at them, not part of the day, so
// it lives in local storage by task ID and never touches the file or the undo history.

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const STORAGE = 'taskii.folded';
/** Width of the strip at the right of a title that holds the fold hint or chevron. */
const HINT_WIDTH = 72;
const CHEVRON_WIDTH = 26;

const folded = new Set<string>(read());
const foldKey = new PluginKey('fold');

function read(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE, JSON.stringify([...folded]));
  } catch {
    // Folding still works for this session.
  }
}

/** Forgets fold state for tasks that no longer exist. */
export function pruneFolded(existing: Iterable<string>): void {
  const keep = new Set(existing);
  let changed = false;
  for (const id of folded) {
    if (!keep.has(id)) {
      folded.delete(id);
      changed = true;
    }
  }
  if (changed) persist();
}

const bodyOf = (task: PMNode) => (task.childCount > 1 && task.child(1).type.name === 'body' ? task.child(1) : null);

function lineCount(body: PMNode): number {
  let lines = 0;
  body.forEach((block) => {
    lines += block.type.name === 'codeBlock' ? block.textContent.split('\n').length : 1;
  });
  return lines;
}

/** Folds or unfolds the task at `pos`. A task with no body has nothing to fold. */
export function toggleFold(state: EditorState, dispatch: (tr: Transaction) => void, pos: number): boolean {
  const task = state.doc.nodeAt(pos);
  if (task?.type.name !== 'task' || !task.attrs.id) return false;

  const tr = state.tr.setMeta(foldKey, true);
  if (folded.has(task.attrs.id)) {
    folded.delete(task.attrs.id);
  } else {
    if (!bodyOf(task)) return false;
    folded.add(task.attrs.id);
    // The cursor must not be left inside what is about to be hidden.
    const titleEnd = pos + task.child(0).nodeSize;
    if (state.selection.to > titleEnd && state.selection.from < pos + task.nodeSize) {
      tr.setSelection(TextSelection.create(tr.doc, titleEnd));
    }
  }
  persist();
  dispatch(tr);
  return true;
}

export const Fold = Extension.create({
  name: 'fold',

  addKeyboardShortcuts() {
    return {
      'Mod-.': () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        return $from.depth >= 1 && toggleFold(state, view.dispatch, $from.before(1));
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: foldKey,

        // Anything that puts the cursor inside a folded body opens it.
        appendTransaction(_transactions, _old, state) {
          const { $from } = state.selection;
          if ($from.depth >= 3 && $from.node(2).type.name === 'body') {
            const id = $from.node(1).attrs.id;
            if (folded.delete(id)) persist();
          }
          return null;
        },

        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.forEach((task, pos) => {
              const body = bodyOf(task);
              if (!body) return;

              const title = task.child(0);
              const isFolded = folded.has(task.attrs.id);
              const lines = lineCount(body);
              if (isFolded) decorations.push(Decoration.node(pos, pos + task.nodeSize, { class: 'folded' }));
              decorations.push(
                Decoration.node(
                  pos + 1,
                  pos + 1 + title.nodeSize,
                  isFolded ? { 'data-fold': `${lines} ${lines === 1 ? 'line' : 'lines'}` } : { 'data-foldable': '' },
                ),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },

          handleDOMEvents: {
            // A click on the hint or chevron at the right of a title folds or unfolds.
            mousedown(view, event) {
              if (event.button !== 0 || !(event.target instanceof HTMLElement)) return false;
              const title = event.target.closest<HTMLElement>('.task-title[data-fold], .task-title[data-foldable]');
              if (!title) return false;

              const rect = title.getBoundingClientRect();
              const strip = title.hasAttribute('data-fold') ? HINT_WIDTH : CHEVRON_WIDTH;
              if (event.clientX < rect.right - strip) return false;

              const $pos = view.state.doc.resolve(view.posAtDOM(title, 0));
              event.preventDefault();
              return toggleFold(view.state, view.dispatch, $pos.before(1));
            },
          },
        },
      }),
    ];
  },
});

// Offers existing tags while a task title is being started, so "ACME" does not drift into
// "AC-ME". Tab takes the suggestion. Enter keeps its usual meaning unless a suggestion was
// picked with the arrow keys, so typing a short title and pressing Enter never surprises.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const MAX_SHOWN = 6;
const MAX_TAG_LENGTH = 24;

export interface TagSuggestOptions {
  /** Known tags, most used first. */
  tags: () => string[];
}

interface Query {
  text: string;
  from: number;
  to: number;
}

/** What has been typed so far, if the cursor is at the end of a title that could still become a tag. */
export function queryAt(state: EditorState): Query | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'taskTitle') return null;

  const text = $from.parent.textContent;
  if (text.length === 0 || text.length > MAX_TAG_LENGTH || text.includes(':') || /^\s/.test(text)) return null;
  if ($from.parentOffset !== $from.parent.content.size) return null;
  return { text, from: $from.start(), to: $from.end() };
}

export const TagSuggest = Extension.create<TagSuggestOptions>({
  name: 'tagSuggest',
  // Ahead of the ordinary key handling, so Tab and the arrows reach the list first.
  priority: 1100,

  addOptions() {
    return { tags: () => [] };
  },

  addProseMirrorPlugins() {
    const { tags } = this.options;
    const popup = document.createElement('div');
    popup.className = 'tag-suggest';
    popup.hidden = true;

    let items: string[] = [];
    let active = -1;
    let dismissed: string | null = null;

    const hide = () => {
      items = [];
      active = -1;
      popup.hidden = true;
    };

    const accept = (view: EditorView, tag: string) => {
      const query = queryAt(view.state);
      if (!query) return;
      view.dispatch(view.state.tr.insertText(tag + ': ', query.from, query.to).scrollIntoView());
      view.focus();
    };

    const draw = (view: EditorView) => {
      popup.replaceChildren(
        ...items.map((tag, index) => {
          const row = document.createElement('div');
          row.className = 'tag-suggest-row' + (index === active ? ' active' : '');
          const label = document.createElement('span');
          label.className = 'tag';
          label.textContent = tag;
          row.append(label);
          if (index === Math.max(active, 0)) {
            const key = document.createElement('kbd');
            key.textContent = 'Tab';
            row.append(key);
          }
          row.addEventListener('mousedown', (event) => {
            event.preventDefault();
            accept(view, tag);
          });
          return row;
        }),
      );
    };

    const refresh = (view: EditorView) => {
      const query = view.editable && view.hasFocus() ? queryAt(view.state) : null;
      if (!query) {
        dismissed = null;
        return hide();
      }
      if (dismissed === query.text) return hide();

      const typed = query.text.toLowerCase();
      const matches = tags()
        .filter((tag) => tag.toLowerCase().startsWith(typed) && tag !== query.text)
        .slice(0, MAX_SHOWN);
      if (matches.length === 0) return hide();

      if (matches.join('\n') !== items.join('\n')) active = -1;
      items = matches;
      draw(view);

      const at = view.coordsAtPos(query.from);
      popup.style.left = `${at.left}px`;
      popup.style.top = `${at.bottom + 4}px`;
      popup.hidden = false;
    };

    return [
      new Plugin({
        key: new PluginKey('tagSuggest'),

        view() {
          document.body.append(popup);
          return {
            update: refresh,
            destroy: () => popup.remove(),
          };
        },

        props: {
          handleKeyDown(view, event) {
            if (items.length === 0 || event.ctrlKey || event.altKey || event.metaKey) return false;

            switch (event.key) {
              case 'ArrowDown':
                active = (active + 1) % items.length;
                draw(view);
                return true;
              case 'ArrowUp':
                active = active <= 0 ? items.length - 1 : active - 1;
                draw(view);
                return true;
              case 'Tab':
                if (event.shiftKey) return false;
                accept(view, items[Math.max(active, 0)]);
                return true;
              case 'Enter':
                if (active < 0 || event.shiftKey) return false;
                accept(view, items[active]);
                return true;
              case 'Escape':
                // This Escape closes the list and nothing else, such as an active tag filter.
                event.stopPropagation();
                dismissed = queryAt(view.state)?.text ?? null;
                hide();
                return true;
              default:
                return false;
            }
          },

          handleDOMEvents: {
            blur() {
              hide();
              return false;
            },
            focus(view) {
              refresh(view);
              return false;
            },
          },
        },
      }),
    ];
  },
});

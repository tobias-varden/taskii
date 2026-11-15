// The age on each card and side note: how long it has read the way it does now. A note has
// no ID, so it is known by its text, and one that is edited is new again. That is the point:
// what has sat untouched for two weeks is probably stale.

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ageLabel, daysBetween, weekdayDate } from '../dates';
import type { NoteAgeDto } from '../types';
import { viewState } from './viewState';

/** What a card or side note is known by. A side note's heading starts with "### ", as in the file. */
export const ageKey = (heading: string, body: string) => `${heading}\u001f${body}`;

/** The first day each note read as it does, by `ageKey`. */
export function agesByKey(ages: readonly NoteAgeDto[]): Map<string, string> {
  const since = new Map<string, string>();
  for (const age of ages) {
    const key = ageKey(age.heading, age.body);
    const known = since.get(key);
    if (!known || age.since < known) since.set(key, age.since);
  }
  return since;
}

export interface AgesOptions {
  /** The markdown of a card's or side note's heading and of its body. */
  heading: (title: PMNode) => string;
  body: (body: PMNode) => string;
}

export const Ages = Extension.create<AgesOptions>({
  name: 'ages',

  addOptions() {
    return { heading: () => '', body: () => '' };
  },

  addProseMirrorPlugins() {
    const { heading, body } = this.options;
    // Nodes never change, only get replaced, so what one says is worked out once.
    const texts = new WeakMap<PMNode, string>();
    const text = (node: PMNode, read: (node: PMNode) => string) => {
      let value = texts.get(node);
      if (value === undefined) texts.set(node, (value = read(node)));
      return value;
    };

    const label = (age: string, since: string, today: string) => () => {
      const el = document.createElement('span');
      el.className = 'age';
      el.contentEditable = 'false';
      el.textContent = age;
      el.title = `Unchanged since ${weekdayDate(since, today)}`;
      return el;
    };

    return [
      new Plugin({
        key: new PluginKey('ages'),
        props: {
          decorations(state) {
            const ages = viewState.noteAges;
            if (!ages) return null;

            const decorations: Decoration[] = [];
            const mark = (note: PMNode, pos: number, prefix: string) => {
              const title = text(note.child(0), heading);
              const words = text(note.child(1), body);
              // Nothing written yet has no age worth showing.
              if (title === '' && words === '') return;

              // Whatever is not in the day as it was loaded was written or changed since: today.
              const since = ages.since.get(ageKey(prefix + title, words)) ?? ages.date;
              const age = ageLabel(Math.max(0, daysBetween(since, ages.date)), ages.date === ages.today);
              decorations.push(Decoration.widget(pos + 2, label(age, since, ages.today), { side: -1, key: `age ${age} ${since}`, ignoreSelection: true }));
            };

            state.doc.forEach((card, pos) => {
              mark(card, pos, '');
              card.forEach((child, offset) => {
                if (child.type.name === 'side') mark(child, pos + 1 + offset, '### ');
              });
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

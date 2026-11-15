// The browser half of "text the user did not touch is written back exactly as it was typed":
// day content -> editor JSON -> day content, through Originals.
import { describe, expect, it } from 'vitest';
import type { NoteDto, TaskDto } from '../types';
import { docToNotes, docToTasks, notesToDoc, Originals, tasksToDoc, type NodeJSON } from './convert';

/**
 * Markdown the editor writes differently: `*` bullets, `[X]`, tabs, trailing spaces, and marks
 * nested or split the other way round. Underscores and doubled spaces are kept as they are anyway.
 */
const tasks = (): TaskDto[] => [
  {
    id: 't7k2',
    done: false,
    title: 'ACME:  Fix ~~**users**~~ with __space__ in user_name',
    fields: [],
    body: '* Get stats  \n\tTell Support about it\n* [X] Run the script\n    * [ ] Dry run first',
  },
  {
    id: 'c0d3',
    done: false,
    title: 'Dev: Check the **pods****now**',
    fields: [],
    body: 'Run this:\n```sh\nkubectl get pods  -A\n```\n![Pods](assets/3fa9c1d2e7.png)\n*  two spaces after the star',
  },
  {
    id: 'q2w3',
    done: true,
    title: 'Dev: Switch the agent pool',
    fields: [
      { key: 'done', value: '2026-11-16T08:40' },
      { key: 'blocked-by', value: '^c9d0' },
      { key: 'estimate', value: '2h' },
    ],
    body: '',
  },
];

const notes = (): NoteDto[] => [
  {
    heading: '~~**Catalog**~~ search PR',
    body: 'Draft ready, __waiting__ on review.\n* [x] Asked in chat',
    sides: [{ heading: '__Edge__  cases', body: '\tEmail match must ignore case.' }],
  },
  { heading: 'Useful commands', body: '```\naz account  get-access-token\n```', sides: [] },
];

/** Loads tasks into an editor document and reads them back, letting `edit` change the document in between. */
function roundTripTasks(input: TaskDto[], edit: (doc: NodeJSON) => void = () => {}): TaskDto[] {
  const originals = new Originals();
  const doc = structuredClone(tasksToDoc(input, originals));
  edit(doc);
  return docToTasks(doc, originals);
}

function roundTripNotes(input: NoteDto[], edit: (doc: NodeJSON) => void = () => {}): NoteDto[] {
  const originals = new Originals();
  const doc = structuredClone(notesToDoc(input, originals));
  edit(doc);
  return docToNotes(doc, originals);
}

const text = (value: string): NodeJSON => ({ type: 'text', text: value });
const bullet = (value: string): NodeJSON => ({ type: 'line', attrs: { kind: 'bullet', indent: 0, checked: false }, content: [text(value)] });

describe('round trip of untouched text', () => {
  it('gives back tasks exactly as they were typed', () => {
    expect(roundTripTasks(tasks())).toEqual(tasks());
  });

  it('gives back notes and side notes exactly as they were typed', () => {
    expect(roundTripNotes(notes())).toEqual(notes());
  });

  it('really does normalise this markdown when it is not an original', () => {
    // Without this, the tests above would pass for markdown the editor never changes.
    const fresh = new Originals();
    const doc = tasksToDoc(tasks(), new Originals());
    const [first] = docToTasks(doc, fresh);
    expect(first.title).not.toBe(tasks()[0].title);
    expect(first.body).not.toBe(tasks()[0].body);
  });
});

describe('an edited item', () => {
  it('is written canonically, and only that title or body', () => {
    const back = roundTripTasks(tasks(), (doc) => {
      doc.content![0].content![1].content!.push(bullet('Tell the team'));
    });

    expect(back[0].body).toBe('- Get stats\n  Tell Support about it\n- [x] Run the script\n    - [ ] Dry run first\n- Tell the team');
    // The same task's untouched title, and its neighbours, keep their originals.
    expect(back[0].title).toBe(tasks()[0].title);
    expect(back.slice(1)).toEqual(tasks().slice(1));
  });

  it('in a note leaves the other notes and its side notes alone', () => {
    const back = roundTripNotes(notes(), (doc) => {
      doc.content![0].content![0].content = [text('Catalog search PR')];
    });

    expect(back[0].heading).toBe('Catalog search PR');
    expect(back[0].body).toBe(notes()[0].body);
    expect(back[0].sides).toEqual(notes()[0].sides);
    expect(back[1]).toEqual(notes()[1]);
  });
});

describe('the same text typed two ways', () => {
  it('keeps each task as it was typed', () => {
    const twins: TaskDto[] = [
      { id: 'a1a1', done: false, title: 'First ~~**twin**~~', fields: [], body: '* same line' },
      { id: 'b2b2', done: false, title: 'Second twin', fields: [], body: '- same line' },
      { id: 'c3c3', done: false, title: 'First **~~twin~~**', fields: [], body: '' },
    ];
    expect(roundTripTasks(twins)).toEqual(twins);
  });

  it('keeps each note as it was typed, even after the cards swap places', () => {
    const twins: NoteDto[] = [
      { heading: 'Monday', body: '* same line', sides: [{ heading: 'Aside', body: '* again' }] },
      { heading: 'Tuesday', body: '- same line', sides: [{ heading: 'Aside', body: '- again' }] },
      { heading: '~~**Twin**~~', body: 'one', sides: [] },
      { heading: '**~~Twin~~**', body: 'two', sides: [] },
    ];
    expect(roundTripNotes(twins)).toEqual(twins);
    expect(roundTripNotes(twins, (doc) => doc.content!.reverse())).toEqual([...twins].reverse());
  });

  it('keeps each task as it was typed after they swap places', () => {
    const twins: TaskDto[] = [
      { id: 'a1a1', done: false, title: 'One', fields: [], body: '* same line' },
      { id: 'b2b2', done: false, title: 'Two', fields: [], body: '- same line' },
    ];
    const back = roundTripTasks(twins, (doc) => doc.content!.reverse());
    expect(back).toEqual([twins[1], twins[0]]);
  });
});

describe('empty items', () => {
  it('drops a task with no title and no body', () => {
    const back = roundTripTasks(tasks(), (doc) => {
      doc.content!.splice(1, 0, { type: 'task', attrs: { id: 'e0e0', done: false, fields: [] }, content: [{ type: 'taskTitle' }] });
    });
    expect(back).toEqual(tasks());
  });

  it('drops an empty card and empty side notes, but keeps a card that has only side notes', () => {
    const input: NoteDto[] = [
      { heading: '', body: '', sides: [{ heading: 'Only a side', body: 'kept' }] },
      { heading: '', body: '', sides: [] },
      { heading: 'Card', body: 'text', sides: [{ heading: '', body: '' }] },
    ];
    expect(roundTripNotes(input)).toEqual([input[0], { heading: 'Card', body: 'text', sides: [] }]);
  });
});

describe('fields', () => {
  it('come back unchanged and in order, unknown ones too', () => {
    const back = roundTripTasks(tasks(), (doc) => {
      // Editing the title must not disturb the fields beside it.
      doc.content![2].content![0].content = [text('Dev: Switch the agent pool today')];
    });
    expect(back[2].fields).toEqual(tasks()[2].fields);
    expect(back[2].done).toBe(true);
  });
});

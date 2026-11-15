// Day content <-> editor documents.

import { parseBody, serializeBody, type BlockJSON, type LineJSON } from '../markdown/body';
import { parseInline, serializeInline, type InlineJSON } from '../markdown/inline';
import type { NoteDto, SideDto, TaskDto, TaskField } from '../types';

export interface NodeJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NodeJSON[];
  text?: string;
}

/**
 * Remembers the exact markdown each title and body was loaded from.
 *
 * Reading markdown into the editor and writing it back can normalise it: a `*` bullet comes
 * back as `-`, a tab as spaces. That must not happen to text the user did not touch. So when
 * something is written out and it is what an original normalises to, the original is used.
 *
 * Two items can hold the same text typed two ways, such as `* a` in one task and `- a` in
 * another. So each original is also remembered by its slot: where it was, such as the body of
 * task c9d0. Text that still reads as its slot's original gets exactly that original back.
 * Text without a match there, because it moved or its slot is unknown, gets whichever original
 * of that form was loaded last.
 */
export class Originals {
  private readonly byNormalised = new Map<string, string>();
  private readonly bySlot = new Map<string, { text: string; original: string }>();

  inline(markdown: string, slot = ''): InlineJSON[] {
    const nodes = parseInline(markdown);
    this.remember('i', serializeInline(nodes), markdown, slot);
    return nodes;
  }

  body(markdown: string, slot = ''): BlockJSON[] {
    const blocks = parseBody(markdown);
    this.remember('b', serializeBody(blocks), markdown, slot);
    return blocks;
  }

  inlineText(nodes: NodeJSON[] | undefined, slot = ''): string {
    return this.original('i', serializeInline(nodes as InlineJSON[] | undefined), slot);
  }

  bodyText(blocks: NodeJSON[] | undefined, slot = ''): string {
    return this.original('b', serializeBody(blocks as BlockJSON[] | undefined), slot);
  }

  private remember(kind: string, text: string, original: string, slot: string): void {
    this.byNormalised.set(`${kind}:${text}`, original);
    if (slot) this.bySlot.set(`${kind}:${slot}`, { text, original });
  }

  private original(kind: string, text: string, slot: string): string {
    const own = slot ? this.bySlot.get(`${kind}:${slot}`) : undefined;
    if (own?.text === text) return own.original;
    return this.byNormalised.get(`${kind}:${text}`) ?? text;
  }
}

/** Between the parts of a slot: the unit separator, which nobody types into a note. */
const SEP = String.fromCharCode(31);

/** A task's title and body are known by its ID. Tasks from files without IDs have no slot. */
const taskSlot = (id: string) => (id ? `t${SEP}${id}` : '');

/**
 * A note has no ID, so each half of a card or side note is known by the other half, as it
 * reads: the body by the heading, the heading by the body. A side note is also known by its
 * card's heading. So cards can move; only editing both halves at once loses the slot.
 */
const noteSlot = (scope: string, sibling: string) => `n${SEP}${scope}${SEP}${sibling}`;

const EMPTY_LINE: LineJSON = { type: 'line', attrs: { kind: 'text', indent: 0, checked: false } };

function titled(type: string, markdown: string, originals: Originals, slot = ''): NodeJSON {
  const content = originals.inline(markdown, slot);
  return content.length ? { type, content } : { type };
}

export function tasksToDoc(tasks: readonly TaskDto[], originals: Originals): NodeJSON {
  return {
    type: 'doc',
    content: tasks.map((task) => {
      const lines = originals.body(task.body, taskSlot(task.id));
      return {
        type: 'task',
        attrs: { id: task.id, done: task.done, fields: task.fields.map((f) => ({ ...f })) },
        content: [titled('taskTitle', task.title, originals, taskSlot(task.id)), ...(lines.length ? [{ type: 'body', content: lines }] : [])],
      };
    }),
  };
}

export function docToTasks(doc: NodeJSON, originals: Originals): TaskDto[] {
  const tasks: TaskDto[] = [];
  for (const node of doc.content ?? []) {
    if (node.type !== 'task') continue;
    const [title, body] = node.content ?? [];
    const id = String(node.attrs?.id ?? '');
    const task: TaskDto = {
      id,
      done: node.attrs?.done === true,
      title: originals.inlineText(title?.content, taskSlot(id)),
      fields: ((node.attrs?.fields as TaskField[] | undefined) ?? []).map((f) => ({ key: f.key, value: f.value })),
      body: originals.bodyText(body?.content, taskSlot(id)),
    };
    // A task nothing was typed into is not worth a line in the file.
    if (task.title !== '' || task.body !== '') tasks.push(task);
  }
  return tasks;
}

/** The markdown as the editor writes it, which is how the halves of a note know each other. */
const inlineForm = (markdown: string) => serializeInline(parseInline(markdown));
const bodyForm = (markdown: string) => serializeBody(parseBody(markdown));

function noteParts(heading: string, body: string, originals: Originals, scope: string): NodeJSON[] {
  const lines = originals.body(body, noteSlot(scope, inlineForm(heading)));
  return [
    titled('cardTitle', heading, originals, noteSlot(scope, bodyForm(body))),
    { type: 'body', content: lines.length ? lines : [EMPTY_LINE] },
  ];
}

export function notesToDoc(notes: readonly NoteDto[], originals: Originals): NodeJSON {
  return {
    type: 'doc',
    content: notes.map((note) => ({
      type: 'card',
      content: [
        ...noteParts(note.heading, note.body, originals, ''),
        ...note.sides.map((side) => ({ type: 'side', content: noteParts(side.heading, side.body, originals, inlineForm(note.heading)) })),
      ],
    })),
  };
}

export function docToNotes(doc: NodeJSON, originals: Originals): NoteDto[] {
  const read = (node: NodeJSON, scope: string): SideDto => {
    const [title, body] = node.content ?? [];
    return {
      heading: originals.inlineText(title?.content, noteSlot(scope, serializeBody(body?.content as BlockJSON[] | undefined))),
      body: originals.bodyText(body?.content, noteSlot(scope, serializeInline(title?.content as InlineJSON[] | undefined))),
    };
  };
  const isEmpty = (note: SideDto) => note.heading === '' && note.body === '';

  const notes: NoteDto[] = [];
  for (const node of doc.content ?? []) {
    if (node.type !== 'card') continue;
    const heading = serializeInline(node.content?.[0]?.content as InlineJSON[] | undefined);
    const sides = (node.content ?? [])
      .filter((n) => n.type === 'side')
      .map((side) => read(side, heading))
      .filter((side) => !isEmpty(side));
    const note: NoteDto = { ...read(node, ''), sides };
    if (!isEmpty(note) || sides.length > 0) notes.push(note);
  }
  return notes;
}

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
 */
export class Originals {
  private readonly byNormalised = new Map<string, string>();

  inline(markdown: string): InlineJSON[] {
    const nodes = parseInline(markdown);
    this.byNormalised.set('i:' + serializeInline(nodes), markdown);
    return nodes;
  }

  body(markdown: string): BlockJSON[] {
    const blocks = parseBody(markdown);
    this.byNormalised.set('b:' + serializeBody(blocks), markdown);
    return blocks;
  }

  inlineText(nodes: NodeJSON[] | undefined): string {
    const text = serializeInline(nodes as InlineJSON[] | undefined);
    return this.byNormalised.get('i:' + text) ?? text;
  }

  bodyText(blocks: NodeJSON[] | undefined): string {
    const text = serializeBody(blocks as BlockJSON[] | undefined);
    return this.byNormalised.get('b:' + text) ?? text;
  }
}

const EMPTY_LINE: LineJSON = { type: 'line', attrs: { kind: 'text', indent: 0, checked: false } };

function titled(type: string, markdown: string, originals: Originals): NodeJSON {
  const content = originals.inline(markdown);
  return content.length ? { type, content } : { type };
}

export function tasksToDoc(tasks: readonly TaskDto[], originals: Originals): NodeJSON {
  return {
    type: 'doc',
    content: tasks.map((task) => {
      const lines = originals.body(task.body);
      return {
        type: 'task',
        attrs: { id: task.id, done: task.done, fields: task.fields.map((f) => ({ ...f })) },
        content: [titled('taskTitle', task.title, originals), ...(lines.length ? [{ type: 'body', content: lines }] : [])],
      };
    }),
  };
}

export function docToTasks(doc: NodeJSON, originals: Originals): TaskDto[] {
  const tasks: TaskDto[] = [];
  for (const node of doc.content ?? []) {
    if (node.type !== 'task') continue;
    const [title, body] = node.content ?? [];
    const task: TaskDto = {
      id: String(node.attrs?.id ?? ''),
      done: node.attrs?.done === true,
      title: originals.inlineText(title?.content),
      fields: ((node.attrs?.fields as TaskField[] | undefined) ?? []).map((f) => ({ key: f.key, value: f.value })),
      body: originals.bodyText(body?.content),
    };
    // A task nothing was typed into is not worth a line in the file.
    if (task.title !== '' || task.body !== '') tasks.push(task);
  }
  return tasks;
}

function noteParts(heading: string, body: string, originals: Originals): NodeJSON[] {
  const lines = originals.body(body);
  return [titled('cardTitle', heading, originals), { type: 'body', content: lines.length ? lines : [EMPTY_LINE] }];
}

export function notesToDoc(notes: readonly NoteDto[], originals: Originals): NodeJSON {
  return {
    type: 'doc',
    content: notes.map((note) => ({
      type: 'card',
      content: [
        ...noteParts(note.heading, note.body, originals),
        ...note.sides.map((side) => ({ type: 'side', content: noteParts(side.heading, side.body, originals) })),
      ],
    })),
  };
}

export function docToNotes(doc: NodeJSON, originals: Originals): NoteDto[] {
  const read = (node: NodeJSON): SideDto => {
    const [title, body] = node.content ?? [];
    return { heading: originals.inlineText(title?.content), body: originals.bodyText(body?.content) };
  };
  const isEmpty = (note: SideDto) => note.heading === '' && note.body === '';

  const notes: NoteDto[] = [];
  for (const node of doc.content ?? []) {
    if (node.type !== 'card') continue;
    const sides = (node.content ?? []).filter((n) => n.type === 'side').map(read).filter((side) => !isEmpty(side));
    const note: NoteDto = { ...read(node), sides };
    if (!isEmpty(note) || sides.length > 0) notes.push(note);
  }
  return notes;
}

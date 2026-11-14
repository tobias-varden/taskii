// Body markdown <-> ProseMirror JSON blocks.
//
// A body is the free-form text under a task or inside a note card. It is line-oriented, the
// way the day files are written and the way OneNote behaves: every line of the file is one
// line in the editor. A line is plain text, a bullet or a checkbox, at some indent. Fenced
// code is the one multi-line block, and an image on a line of its own is shown as the image.

import { parseInline, serializeInline, type InlineJSON } from './inline';

export type LineKind = 'text' | 'bullet' | 'check';

export interface LineJSON {
  type: 'line';
  attrs: { kind: LineKind; indent: number; checked: boolean };
  content?: InlineJSON[];
}

export interface CodeBlockJSON {
  type: 'codeBlock';
  attrs: { language: string | null; indent: number };
  content?: InlineJSON[];
}

export interface ImageJSON {
  type: 'image';
  /** `src` is what the file says: a path such as assets/3fa9c1d2e7.png, or a URL. */
  attrs: { src: string; alt: string; indent: number };
}

export type BlockJSON = LineJSON | CodeBlockJSON | ImageJSON;

export const MAX_INDENT = 8;
const INDENT = '  ';

const FENCE_OPEN = /^```([\w+#.-]*)\s*$/;
const IMAGE = /^!\[([^\]]*)\]\(([^()\s]+)\)$/;
const CHECK = /^[-*] \[([ xX])\](?: (.*))?$/;
const BULLET = /^[-*](?: (.*))?$/;

export function parseBody(markdown: string): BlockJSON[] {
  if (markdown === '') return [];

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockJSON[] = [];

  for (let i = 0; i < lines.length; i++) {
    const [, space, rest] = /^([ \t]*)(.*)$/.exec(lines[i])!;
    const indent = Math.min(MAX_INDENT, Math.floor(width(space) / 2));

    const fence = FENCE_OPEN.exec(rest);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && lines[i].trim() !== '```'; i++) {
        code.push(stripIndent(lines[i], space.length));
      }
      const text = code.join('\n');
      blocks.push({
        type: 'codeBlock',
        attrs: { language: fence[1] || null, indent },
        ...(text ? { content: [{ type: 'text', text }] } : {}),
      });
      continue;
    }

    const image = IMAGE.exec(rest);
    if (image) {
      blocks.push({ type: 'image', attrs: { src: image[2], alt: image[1], indent } });
      continue;
    }

    const check = CHECK.exec(rest);
    if (check) {
      blocks.push(line('check', indent, check[2] ?? '', check[1] !== ' '));
      continue;
    }

    const bullet = BULLET.exec(rest);
    if (bullet) {
      blocks.push(line('bullet', indent, bullet[1] ?? ''));
      continue;
    }

    blocks.push(rest === '' ? line('text', 0, '') : line('text', indent, unescapeLine(rest)));
  }

  return blocks;
}

export function serializeBody(blocks: readonly BlockJSON[] | undefined): string {
  const out: string[] = [];

  for (const block of blocks ?? []) {
    const pad = INDENT.repeat(block.attrs.indent ?? 0);

    if (block.type === 'codeBlock') {
      const code = (block.content ?? []).map((n) => n.text ?? '').join('');
      out.push(pad + '```' + (block.attrs.language ?? ''));
      for (const codeLine of code.split('\n')) out.push(codeLine === '' ? '' : pad + codeLine);
      out.push(pad + '```');
      continue;
    }

    if (block.type === 'image') {
      out.push(`${pad}![${block.attrs.alt ?? ''}](${block.attrs.src})`);
      continue;
    }

    const text = serializeInline(block.content);
    switch (block.attrs.kind) {
      case 'check':
        out.push((pad + `- [${block.attrs.checked ? 'x' : ' '}] ` + text).trimEnd());
        break;
      case 'bullet':
        out.push((pad + '- ' + text).trimEnd());
        break;
      default:
        out.push(text.trim() === '' ? '' : (pad + escapeLine(text)).trimEnd());
    }
  }

  while (out.length && out[out.length - 1] === '') out.pop();
  while (out.length && out[0] === '') out.shift();
  return out.join('\n');
}

function line(kind: LineKind, indent: number, text: string, checked = false): LineJSON {
  const content = parseInline(text);
  return { type: 'line', attrs: { kind, indent, checked }, ...(content.length ? { content } : {}) };
}

function width(space: string): number {
  let n = 0;
  for (const ch of space) n += ch === '\t' ? 2 : 1;
  return n;
}

function stripIndent(text: string, columns: number): string {
  let i = 0;
  while (i < columns && i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return text.slice(i);
}

/** True when plain text would be read back as a heading, a bullet or a code fence. */
function looksLikeBlock(text: string): boolean {
  return /^(#{1,6}([ \t]|$)|[-*]([ \t]|$)|```)/.test(text);
}

function needsEscape(text: string): boolean {
  return looksLikeBlock(text) || (text.startsWith('\\') && needsEscape(text.slice(1)));
}

function escapeLine(text: string): string {
  return needsEscape(text) ? '\\' + text : text;
}

function unescapeLine(text: string): string {
  return text.startsWith('\\') && needsEscape(text.slice(1)) ? text.slice(1) : text;
}

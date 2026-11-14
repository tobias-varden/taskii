// Inline markdown <-> ProseMirror JSON text nodes.
//
// The dialect is deliberately small: **bold**, *italic*, ~~strike~~, `code`, [text](url) and
// bare URLs. Everything else is literal text and is written back exactly as typed, so the
// file never fills up with backslash escapes. Underscores are not emphasis: snake_case names
// are far more common in a work log than _italics_.

export interface MarkJSON {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TextJSON {
  type: 'text';
  text: string;
  marks?: MarkJSON[];
}

/** Any inline node as ProseMirror serialises it. Only text nodes carry content here. */
export interface InlineJSON {
  type: string;
  text?: string;
  marks?: MarkJSON[];
}

const DELIMITERS = [
  ['**', 'bold'],
  ['~~', 'strike'],
  ['*', 'italic'],
] as const;

const DELIMITER_OF: Record<string, string> = { bold: '**', italic: '*', strike: '~~' };
const NESTING_ORDER = ['bold', 'italic', 'strike'];

const LINK = /\[([^[\]]+)\]\(([^()\s]+(?:\([^()\s]*\)[^()\s]*)*)\)/y;
const URL = /https?:\/\/[^\s<>]+/y;

export function parseInline(source: string): TextJSON[] {
  const out: TextJSON[] = [];
  new InlineParser(source).parseUntil(0, null, [], out);
  return mergeAdjacent(out);
}

class InlineParser {
  /** Openers already known not to close, so pathological input stays linear-ish. */
  private readonly dead = new Set<string>();

  constructor(private readonly src: string) {}

  /** Parses from `start` until `closer`. Returns the index after the closer, or -1 if it never comes. */
  parseUntil(start: number, closer: string | null, marks: MarkJSON[], out: TextJSON[]): number {
    const src = this.src;
    let text = '';
    const flush = () => {
      if (text) out.push(textNode(text, marks));
      text = '';
    };

    let i = start;
    while (i < src.length) {
      if (closer && i > start && src.startsWith(closer, i) && !isSpace(src[i - 1])) {
        flush();
        return i + closer.length;
      }

      const ch = src[i];

      if (ch === '`') {
        const end = src.indexOf('`', i + 1);
        if (end > i + 1) {
          flush();
          // Code excludes every other mark in the editor, so it carries none here either.
          out.push(textNode(src.slice(i + 1, end), [{ type: 'code' }]));
          i = end + 1;
          continue;
        }
      }

      const inLink = marks.some((m) => m.type === 'link');

      if (ch === '[' && !inLink) {
        LINK.lastIndex = i;
        const m = LINK.exec(src);
        if (m) {
          flush();
          const inner: TextJSON[] = [];
          new InlineParser(m[1]).parseUntil(0, null, [...marks, linkMark(m[2])], inner);
          out.push(...inner);
          i += m[0].length;
          continue;
        }
      }

      if (ch === 'h' && !inLink && (i === 0 || !/[A-Za-z0-9]/.test(src[i - 1]))) {
        URL.lastIndex = i;
        const m = URL.exec(src);
        if (m) {
          const url = trimUrl(m[0]);
          flush();
          out.push(textNode(url, [...marks, linkMark(url)]));
          i += url.length;
          continue;
        }
      }

      const opened = this.tryOpen(i, marks, out, flush);
      if (opened >= 0) {
        i = opened;
        continue;
      }

      text += ch;
      i++;
    }

    flush();
    return closer ? -1 : src.length;
  }

  private tryOpen(i: number, marks: MarkJSON[], out: TextJSON[], flush: () => void): number {
    const src = this.src;
    for (const [delimiter, type] of DELIMITERS) {
      if (!src.startsWith(delimiter, i)) continue;
      if (marks.some((m) => m.type === type)) continue;

      const from = i + delimiter.length;
      if (from >= src.length || isSpace(src[from])) continue;

      const key = `${i}${delimiter}`;
      if (this.dead.has(key)) continue;

      const inner: TextJSON[] = [];
      const end = this.parseUntil(from, delimiter, [...marks, { type }], inner);
      if (end >= 0 && inner.length > 0) {
        flush();
        out.push(...inner);
        return end;
      }
      this.dead.add(key);
    }
    return -1;
  }
}

function textNode(text: string, marks: MarkJSON[]): TextJSON {
  return marks.length ? { type: 'text', text, marks: marks.map((m) => ({ ...m })) } : { type: 'text', text };
}

function linkMark(href: string): MarkJSON {
  return { type: 'link', attrs: { href } };
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === ' ';
}

/** A URL in running text rarely ends with punctuation; that belongs to the sentence. */
function trimUrl(url: string): string {
  for (;;) {
    const last = url[url.length - 1];
    if ('.,;:!?\'"'.includes(last)) {
      url = url.slice(0, -1);
    } else if (last === ')' && count(url, ')') > count(url, '(')) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

function mergeAdjacent(nodes: TextJSON[]): TextJSON[] {
  const out: TextJSON[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (prev && JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      prev.text += node.text;
    } else {
      out.push(node);
    }
  }
  return out;
}

interface Char {
  ch: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  href: string | null;
}

type Emphasis = 'bold' | 'italic' | 'strike';

export function serializeInline(content: readonly InlineJSON[] | undefined): string {
  const chars: Char[] = [];
  for (const node of content ?? []) {
    if (node.type !== 'text' || !node.text) continue;
    const has = (type: string) => !!node.marks?.some((m) => m.type === type);
    const link = node.marks?.find((m) => m.type === 'link');
    const code = has('code');
    const base = {
      bold: !code && has('bold'),
      italic: !code && has('italic'),
      strike: !code && has('strike'),
      code,
      href: link ? String(link.attrs?.href ?? '') : null,
    };
    for (const ch of node.text.replace(/[\r\n]+/g, ' ')) chars.push({ ch, ...base });
  }

  // "**bold **" does not read back as bold, so emphasis never starts or ends on whitespace.
  for (const type of NESTING_ORDER as Emphasis[]) {
    let i = 0;
    while (i < chars.length) {
      if (!chars[i][type]) {
        i++;
        continue;
      }
      let end = i;
      while (end < chars.length && chars[end][type] && chars[end].href === chars[i].href) end++;
      let a = i;
      let b = end - 1;
      while (a <= b && isSpace(chars[a].ch)) chars[a++][type] = false;
      while (b >= a && isSpace(chars[b].ch)) chars[b--][type] = false;
      i = end;
    }
  }

  let out = '';
  let i = 0;
  while (i < chars.length) {
    const href = chars[i].href;
    let end = i;
    while (end < chars.length && chars[end].href === href) end++;
    const run = chars.slice(i, end);

    if (href === null) {
      out += emit(run);
    } else {
      const plain = run.every((c) => !c.bold && !c.italic && !c.strike && !c.code);
      const text = run.map((c) => c.ch).join('');
      out += plain && text === href && trimUrl(href) === href && /^https?:\/\//.test(href) ? href : `[${emit(run)}](${href})`;
    }
    i = end;
  }
  return out;
}

function emit(run: Char[]): string {
  let out = '';
  const open: string[] = [];
  const closeTo = (depth: number) => {
    while (open.length > depth) out += DELIMITER_OF[open.pop()!];
  };

  let i = 0;
  while (i < run.length) {
    const c = run[i];

    if (c.code) {
      closeTo(0);
      let end = i;
      while (end < run.length && run[end].code) end++;
      out += '`' + run.slice(i, end).map((x) => x.ch).join('') + '`';
      i = end;
      continue;
    }

    const wanted = NESTING_ORDER.filter((type) => c[type as Emphasis]);
    let keep = 0;
    while (keep < open.length && wanted.includes(open[keep])) keep++;
    closeTo(keep);
    for (const type of wanted) {
      if (!open.includes(type)) {
        open.push(type);
        out += DELIMITER_OF[type];
      }
    }

    out += c.ch;
    i++;
  }

  closeTo(0);
  return out;
}

import { describe, expect, it } from 'vitest';
import { parseBody, serializeBody } from './body';
import { parseInline, serializeInline } from './inline';

const marksOf = (source: string) =>
  parseInline(source).map((n) => [n.text, ...(n.marks ?? []).map((m) => (m.type === 'link' ? `link:${m.attrs?.href}` : m.type))]);

describe('inline', () => {
  it('reads the supported marks', () => {
    expect(marksOf('plain **bold** *it* ~~gone~~ `code`')).toEqual([
      ['plain '],
      ['bold', 'bold'],
      [' '],
      ['it', 'italic'],
      [' '],
      ['gone', 'strike'],
      [' '],
      ['code', 'code'],
    ]);
  });

  it('nests emphasis', () => {
    expect(marksOf('**a *b***')).toEqual([
      ['a ', 'bold'],
      ['b', 'bold', 'italic'],
    ]);
    expect(marksOf('***x***')).toEqual([['x', 'bold', 'italic']]);
  });

  it('reads markdown links and bare URLs', () => {
    expect(marksOf('see [widget-service#413](https://github.com/o/r/pull/413).')).toEqual([
      ['see '],
      ['widget-service#413', 'link:https://github.com/o/r/pull/413'],
      ['.'],
    ]);
    expect(marksOf('at https://example.com/a_b(c), ok')).toEqual([
      ['at '],
      ['https://example.com/a_b(c)', 'link:https://example.com/a_b(c)'],
      [', ok'],
    ]);
  });

  it.each([
    'snake_case_name and _underscores_ stay literal',
    '2 * 3 * 4 = 24',
    'a lone * star, a lone ` tick, a lone ** pair',
    'stats 1 234 (~500 have space in the middle)',
    'array[0] and [not a link] (really)',
    'C:\\Users\\Sky\\file.txt',
    '<b>not html</b> &amp; friends',
  ])('leaves %j alone', (text) => {
    expect(parseInline(text)).toEqual([{ type: 'text', text }]);
    expect(serializeInline(parseInline(text))).toBe(text);
  });

  it.each([
    'plain **bold** *it* ~~gone~~ `code`',
    '**a *b***',
    '***x***',
    'see [widget-service#413](https://github.com/o/r/pull/413).',
    'bare https://dev.azure.com/org/proj/_workitems/edit/4521 link',
    '[**bold** link](https://example.com)',
    '`kubectl logs -f deploy/identity --since=10m`',
    'ACME: Catalog: exact-match search',
    '',
  ])('round-trips %j', (text) => {
    expect(serializeInline(parseInline(text))).toBe(text);
  });

  it('keeps emphasis off the surrounding spaces', () => {
    const bold = [{ type: 'bold' }];
    expect(
      serializeInline([
        { type: 'text', text: 'a' },
        { type: 'text', text: ' bold ', marks: bold },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a **bold** b');
  });

  it('closes marks in the order that reads back', () => {
    const out = serializeInline([
      { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] },
      { type: 'text', text: 'c', marks: [{ type: 'italic' }] },
    ]);
    expect(out).toBe('**a*b****c*');
    expect(marksOf(out).map(([text]) => text).join('')).toBe('abc');
  });

  it('never takes exponential time on a wall of asterisks', () => {
    const wall = '*a'.repeat(400);
    const started = performance.now();
    parseInline(wall);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('body', () => {
  it('reads one line of the file as one line in the editor', () => {
    const blocks = parseBody('Get stats\n- bullet\n  - [x] nested done\n\n    indented text');
    expect(blocks.map((b) => [b.type === 'line' ? b.attrs.kind : 'code', b.attrs.indent])).toEqual([
      ['text', 0],
      ['bullet', 0],
      ['check', 1],
      ['text', 0],
      ['text', 2],
    ]);
    expect(blocks[2]).toMatchObject({ attrs: { checked: true }, content: [{ text: 'nested done' }] });
  });

  it('reads fenced code as a single block', () => {
    const blocks = parseBody('  ```sh\n  kubectl get pods\n\n  # a comment\n  ```\nafter');
    expect(blocks).toEqual([
      { type: 'codeBlock', attrs: { language: 'sh', indent: 1 }, content: [{ type: 'text', text: 'kubectl get pods\n\n# a comment' }] },
      { type: 'line', attrs: { kind: 'text', indent: 0, checked: false }, content: [{ type: 'text', text: 'after' }] },
    ]);
  });

  it.each([
    'Get stats 1 234 (~500 have space in the middle)\nTell Support about it\nRun the script',
    '- [ ] Apply new portalv3 and portal-admin',
    '- one\n  - two\n    - [x] three\n- [ ]\n-',
    'para\n\npara after a blank line',
    '```\nkubectl logs -f deploy/identity --since=10m\naz account get-access-token\n```',
    '  ```sh\n  indented code\n  ```',
    'Draft ready. [widget-service#413](https://github.com/owner/widget-service/pull/413)',
    '1. numbered lists stay as typed\n2. second',
    '#hashtag and #123 are not headings',
    'before\n![](assets/3fa9c1d2e7.png)\nafter',
    '- item\n  ![login error](assets/0123456789.jpg)',
    'an inline ![image](assets/x.png) stays as typed',
    '',
  ])('round-trips %j', (text) => {
    expect(serializeBody(parseBody(text))).toBe(text);
  });

  it('escapes text that would otherwise turn into structure when read back', () => {
    const text = (value: string) => [{ type: 'line' as const, attrs: { kind: 'text' as const, indent: 0, checked: false }, content: [{ type: 'text', text: value }] }];

    for (const tricky of ['## not a card', '# Todo', '- not a bullet', '* nor this', '```', '\\## already escaped']) {
      const written = serializeBody(text(tricky));
      expect(written).toBe('\\' + tricky);
      expect(parseBody(written)).toEqual(text(tricky));
    }
  });

  it('reads an image on its own line as an image', () => {
    expect(parseBody('  ![shot](assets/3fa9c1d2e7.png)')).toEqual([{ type: 'image', attrs: { src: 'assets/3fa9c1d2e7.png', alt: 'shot', indent: 1 } }]);
    expect(parseBody('see ![shot](assets/3fa9c1d2e7.png)')[0].type).toBe('line');
  });

  it('writes an unterminated fence back closed', () => {
    expect(serializeBody(parseBody('```\nno end'))).toBe('```\nno end\n```');
  });
});

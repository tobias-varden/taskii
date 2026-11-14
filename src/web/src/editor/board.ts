// The board: what a card can do beyond holding text.
//
// A card is the unit for moving, collapsing and deleting. A side note is a card docked to
// another card. None of this is stored as positions: the board is a display of sections that
// are linear in the file, so moving a card is moving its section.

import { Extension, type Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

const STORAGE = 'taskii.collapsedCards';
const boardKey = new PluginKey('board');

// Cards have no IDs, so a collapsed card is remembered by its heading. Like folding, this is
// how this machine looks at the board and is never written to the day.
const collapsed = new Set<string>(read());

function read(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]');
    return Array.isArray(value) ? value.filter((heading): heading is string => typeof heading === 'string') : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE, JSON.stringify([...collapsed]));
  } catch {
    // Collapsing still works for this session.
  }
}

const headingOf = (card: PMNode) => card.child(0).textContent;

interface Found {
  pos: number;
  node: PMNode;
}

/** The card or side note that a DOM element of the board belongs to. */
function nodeAtElement(view: EditorView, el: Element): Found | null {
  const wanted = el.classList.contains('side') ? 'side' : 'card';
  const $pos = view.state.doc.resolve(view.posAtDOM(el, 0));
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === wanted) return { pos: $pos.before(depth), node: $pos.node(depth) };
  }
  return null;
}

/** The time as a card heading starts with it, for example "10:05 ". */
export function timeHeading(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} `;
}

/** Adds a card after the one being edited, or at the end, and puts the cursor at the end of its heading. */
export function addCard(editor: Editor, heading = ''): void {
  const { state, view } = editor;
  const { $from } = state.selection;
  const { card, cardTitle, body, line } = state.schema.nodes;

  const at = editor.isFocused && $from.depth >= 1 ? $from.after(1) : state.doc.content.size;
  const node = card.create(null, [cardTitle.create(null, heading ? state.schema.text(heading) : null), body.create(null, line.create())]);
  const tr = state.tr.insert(at, node);
  tr.setSelection(TextSelection.create(tr.doc, at + 2 + heading.length));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Docks a new side note to the card being edited. */
export function addSide(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  if (!editor.isFocused || $from.depth < 1 || $from.node(1).type.name !== 'card') return false;

  const { side, cardTitle, body, line } = state.schema.nodes;
  const at = $from.before(1) + $from.node(1).nodeSize - 1;
  const tr = state.tr.insert(at, side.create(null, [cardTitle.create(), body.create(null, line.create())]));
  tr.setSelection(TextSelection.create(tr.doc, at + 2));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function toggleCollapsed(view: EditorView, found: Found): void {
  const heading = headingOf(found.node);
  if (!heading) return;

  const tr = view.state.tr.setMeta(boardKey, true);
  if (collapsed.delete(heading)) {
    persist();
    view.dispatch(tr);
    return;
  }

  collapsed.add(heading);
  persist();
  // The cursor must not be left inside what is about to be hidden.
  const titleEnd = found.pos + found.node.child(0).nodeSize;
  const { from, to } = view.state.selection;
  if (to > titleEnd && from < found.pos + found.node.nodeSize) tr.setSelection(TextSelection.create(tr.doc, titleEnd));
  view.dispatch(tr);
}

export interface BoardOptions {
  onGrab: (event: PointerEvent, editor: Editor, element: HTMLElement) => void;
}

/** The tools that appear on a card on hover, and the collapsed look. */
export const Board = Extension.create<BoardOptions>({
  name: 'board',

  addOptions() {
    return { onGrab: () => {} };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { onGrab } = this.options;

    const button = (label: string, title: string, act: (view: EditorView, found: Found) => void, owner: () => Element | null) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tool';
      el.textContent = label;
      el.title = title;
      el.addEventListener('mousedown', (event) => event.preventDefault());
      el.addEventListener('click', () => {
        const target = owner();
        const found = target && nodeAtElement(editor.view, target);
        if (found) act(editor.view, found);
      });
      return el;
    };

    const tools = (kind: 'card' | 'side') => () => {
      const box = document.createElement('span');
      box.className = 'card-tools';
      const owner = () => box.closest(kind === 'card' ? '.card' : '.side');

      const grip = document.createElement('span');
      grip.className = 'grip';
      grip.title = kind === 'card' ? 'Drag to move. Drop on the right edge of a card to dock it as a side note.' : 'Drag off to make this a card of its own';
      grip.addEventListener('pointerdown', (event) => {
        const target = owner();
        if (event.button === 0 && target instanceof HTMLElement) onGrab(event, editor, target);
      });
      box.append(grip);

      if (kind === 'card') box.append(button('⌄', 'Collapse or expand', toggleCollapsed, owner));
      box.append(
        button('✕', kind === 'card' ? 'Delete card' : 'Delete side note', (view, found) => {
          view.dispatch(view.state.tr.delete(found.pos, found.pos + found.node.nodeSize));
          view.focus();
        }, owner),
      );
      return box;
    };

    return [
      new Plugin({
        key: boardKey,

        // Anything that puts the cursor inside a collapsed card opens it.
        appendTransaction(_transactions, _old, state) {
          const { $from } = state.selection;
          if ($from.depth >= 2 && $from.node(1).type.name === 'card' && $from.node(2).type.name !== 'cardTitle') {
            if (collapsed.delete(headingOf($from.node(1)))) persist();
          }
          return null;
        },

        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            const editable = editor.isEditable;

            state.doc.forEach((card, pos) => {
              const isCollapsed = collapsed.has(headingOf(card)) && headingOf(card) !== '';
              if (isCollapsed) decorations.push(Decoration.node(pos, pos + card.nodeSize, { class: 'collapsed' }));

              // Past days can still be collapsed for reading, so the tools show there too; the
              // ones that change the day are hidden by the stylesheet.
              decorations.push(Decoration.widget(pos + 1, tools('card'), { side: -1, key: `card-tools${editable ? '' : '-ro'}`, ignoreSelection: true, stopEvent: () => true }));

              card.forEach((child, offset) => {
                if (child.type.name !== 'side' || !editable) return;
                decorations.push(Decoration.widget(pos + 1 + offset + 1, tools('side'), { side: -1, key: 'side-tools', ignoreSelection: true, stopEvent: () => true }));
              });
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

type CardDrop = { kind: 'before' | 'after' | 'dock'; pos: number } | { kind: 'end' };

/** Width of the strip at the right edge of a card where a drop docks instead of reorders. */
const DOCK_EDGE = 44;
const EDGE = 48;
const SCROLL_STEP = 14;

/** Moves the card or side note at `sourcePos` to where it was dropped. */
function moveCard(editor: Editor, sourcePos: number, drop: CardDrop): boolean {
  const { state, view } = editor;
  const node = state.doc.nodeAt(sourcePos);
  if (!node) return false;

  const { card, side } = state.schema.nodes;
  const main = (n: PMNode) => [n.child(0), n.child(1)];
  const sidesOf = (n: PMNode) => {
    const sides: PMNode[] = [];
    n.forEach((child) => {
      if (child.type === side) sides.push(child);
    });
    return sides;
  };

  let at: number;
  let nodes: PMNode[];
  if (drop.kind === 'dock') {
    const target = state.doc.nodeAt(drop.pos);
    if (!target) return false;
    at = drop.pos + target.nodeSize - 1;
    // Docking to a collapsed card opens it, or the note would vanish from sight.
    if (collapsed.delete(headingOf(target))) persist();
    // A card docked with side notes of its own brings them along as side notes of the target.
    nodes = node.type === side ? [node] : [side.create(null, main(node)), ...sidesOf(node)];
  } else {
    const target = drop.kind === 'end' ? null : state.doc.nodeAt(drop.pos);
    at = drop.kind === 'end' || !target ? state.doc.content.size : drop.kind === 'before' ? drop.pos : drop.pos + target.nodeSize;
    // A side note dropped among the cards becomes a card.
    nodes = [node.type === side ? card.create(null, main(node)) : node];
  }

  const end = sourcePos + node.nodeSize;
  if (at > sourcePos && at < end) return false;
  if (node.type === card && drop.kind !== 'dock' && (at === sourcePos || at === end)) return false;

  const tr = state.tr.delete(sourcePos, end);
  tr.insert(tr.mapping.map(at), Fragment.fromArray(nodes));
  view.dispatch(tr);
  return true;
}

export class CardDrag {
  private readonly line = document.createElement('div');
  /** Dims the card being dragged without touching it: the editor owns that element. */
  private readonly veil = document.createElement('div');

  constructor() {
    this.line.className = 'drop-line';
    this.veil.className = 'drag-veil';
    this.line.hidden = this.veil.hidden = true;
    document.body.append(this.line, this.veil);
  }

  start(event: PointerEvent, editor: Editor, element: HTMLElement): void {
    const source = nodeAtElement(editor.view, element);
    if (!source) return;
    event.preventDefault();

    const box = element.getBoundingClientRect();
    Object.assign(this.veil.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    this.veil.hidden = false;
    document.body.classList.add('dragging-task');

    let drop: CardDrop | null = null;
    const onMove = (e: PointerEvent) => {
      drop = this.locate(editor, source, e.clientX, e.clientY);
    };
    const finish = (commit: boolean) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('dragging-task');
      this.line.hidden = this.veil.hidden = true;
      if (commit && drop) moveCard(editor, source.pos, drop);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey, true);
  }

  private show(left: number, top: number, width: number, height: number): void {
    Object.assign(this.line.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    this.line.hidden = false;
  }

  private locate(editor: Editor, source: Found, x: number, y: number): CardDrop | null {
    this.line.hidden = true;

    const view = editor.view;
    const root = view.dom;
    const scroller = root.parentElement ?? root;
    const bounds = scroller.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;

    if (y < bounds.top + EDGE) scroller.scrollTop -= SCROLL_STEP;
    if (y > bounds.bottom - EDGE) scroller.scrollTop += SCROLL_STEP;

    const over = document.elementFromPoint(x, y)?.closest('.card');
    const target = over && root.contains(over) ? nodeAtElement(view, over) : null;

    if (over && target) {
      const rect = over.getBoundingClientRect();
      const sourceCard = source.node.type.name === 'side' ? view.state.doc.resolve(source.pos).before(1) : source.pos;
      const own = target.pos === sourceCard;

      if (x > rect.right - DOCK_EDGE) {
        // Onto the right edge: dock as a side note. Docking to itself means nothing.
        if (own) return null;
        this.show(rect.right - 3, rect.top, 3, rect.height);
        return { kind: 'dock', pos: target.pos };
      }

      if (own && source.node.type.name === 'card') return null;
      const before = y < rect.top + rect.height / 2;
      this.show(rect.left, before ? rect.top - 8 : rect.bottom + 6, rect.width, 2);
      return { kind: before ? 'before' : 'after', pos: target.pos };
    }

    // Empty space: the end of the board.
    const cards = root.querySelectorAll(':scope > .card');
    const last = cards[cards.length - 1];
    if (last) {
      const rect = last.getBoundingClientRect();
      this.show(rect.left, rect.bottom + 6, rect.width, 2);
    }
    return { kind: 'end' };
  }
}

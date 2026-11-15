// The small list that asks what a task is waiting for: pick an open task, or type the title
// of a new one.

import { tagOf } from './editor/decorations';

export interface PickerTask {
  id: string;
  title: string;
  backlog: boolean;
}

export interface PickerRequest {
  /** Where the task's title is on screen; the list opens under it. */
  anchor: { left: number; bottom: number };
  tasks: PickerTask[];
  /** What the task waits for now. */
  current: string | null;
  /** An existing task was picked, or null for "not blocked". */
  choose: (id: string | null) => void;
  /** A title was typed for a task that does not exist yet. */
  create: (title: string) => void;
  /** The list is gone, whatever happened. */
  closed: () => void;
}

type Row = { kind: 'clear' } | { kind: 'task'; task: PickerTask } | { kind: 'create'; title: string };

const MAX_SHOWN = 8;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class BlockerPicker {
  private readonly box = el('div', 'picker');
  private readonly input = el('input');
  private readonly list = el('div', 'picker-list');
  private request: PickerRequest | null = null;
  private rows: Row[] = [];
  private active = 0;

  constructor() {
    this.box.hidden = true;
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-label', 'Blocked by');
    this.input.type = 'text';
    this.input.placeholder = 'Blocked by… pick a task or type a new one';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.box.append(this.input, this.list);
    document.body.append(this.box);

    this.input.addEventListener('input', () => this.draw());
    this.input.addEventListener('keydown', (event) => this.handleKey(event));
    // Clicking anywhere else gives it up.
    document.addEventListener('pointerdown', (event) => {
      if (this.request && !this.box.contains(event.target as Node)) this.close();
    });
    this.input.addEventListener('blur', () => {
      // Not when the whole window loses focus: coming back should find the list still there.
      if (document.hasFocus()) this.close();
    });
  }

  get isOpen(): boolean {
    return this.request !== null;
  }

  open(request: PickerRequest): void {
    this.close();
    this.request = request;
    this.input.value = '';
    this.box.hidden = false;
    this.draw();

    // Under the title, but never off the edge of the window.
    const { width, height } = this.box.getBoundingClientRect();
    this.box.style.left = `${Math.max(8, Math.min(request.anchor.left, window.innerWidth - width - 8))}px`;
    this.box.style.top = `${Math.max(8, Math.min(request.anchor.bottom + 4, window.innerHeight - height - 8))}px`;
    this.input.focus();
  }

  close(): void {
    const request = this.request;
    if (!request) return;
    this.request = null;
    this.box.hidden = true;
    request.closed();
  }

  private draw(): void {
    const request = this.request;
    if (!request) return;
    const typed = this.input.value.trim();
    const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = request.tasks.filter((task) => words.every((word) => task.title.toLowerCase().includes(word)));

    this.rows = [
      ...(request.current && !typed ? [{ kind: 'clear' } as Row] : []),
      ...matches.slice(0, MAX_SHOWN).map((task): Row => ({ kind: 'task', task })),
      ...(typed && !matches.some((task) => task.title.toLowerCase() === typed.toLowerCase()) ? [{ kind: 'create', title: typed } as Row] : []),
    ];
    // Start on what it waits for now, so Enter straight away changes nothing.
    const current = this.rows.findIndex((row) => row.kind === 'task' && row.task.id === request.current);
    this.active = !typed && current >= 0 ? current : this.rows.findIndex((row) => row.kind !== 'clear');
    if (this.active < 0) this.active = 0;

    this.list.replaceChildren(...this.rows.map((row, index) => this.drawRow(row, index)));
    if (this.rows.length === 0) this.list.append(el('div', 'picker-none', 'No other open tasks. Type a title to add one.'));
    if (matches.length > MAX_SHOWN) this.list.append(el('div', 'picker-none', `${matches.length - MAX_SHOWN} more. Type to narrow.`));
  }

  private drawRow(row: Row, index: number): HTMLElement {
    const node = el('div', 'picker-row');
    node.dataset.index = String(index);
    node.classList.toggle('active', index === this.active);

    if (row.kind === 'clear') {
      node.append(el('span', 'picker-quiet', 'Not blocked'));
    } else if (row.kind === 'create') {
      node.append(el('span', 'picker-quiet', 'New task above: '), el('span', '', row.title));
    } else {
      const tag = tagOf(row.task.title);
      if (tag) node.append(el('span', 'su-tag', tag), ' ');
      node.append(el('span', 'picker-name', tag ? row.task.title.slice(tag.length + 1).trimStart() : row.task.title));
      const notes = [row.task.id === this.request?.current ? 'current' : '', row.task.backlog ? 'backlog' : ''].filter(Boolean);
      if (notes.length) node.append(el('span', 'picker-more', notes.join(' · ')));
    }

    // Before the input loses focus, which would close the list.
    node.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.take(row);
    });
    return node;
  }

  private setActive(index: number): void {
    if (this.rows.length === 0) return;
    this.active = (index + this.rows.length) % this.rows.length;
    this.list.querySelectorAll('.picker-row').forEach((row, at) => row.classList.toggle('active', at === this.active));
  }

  private take(row: Row | undefined): void {
    const request = this.request;
    if (!request || !row) return;
    // Closed first, so focus is back in the editor before the document changes.
    this.close();
    if (row.kind === 'clear') request.choose(null);
    else if (row.kind === 'task') request.choose(row.task.id);
    else request.create(row.title);
  }

  private handleKey(event: KeyboardEvent): void {
    // These keys are spent here: Esc must not also clear the tag filter of the day underneath.
    switch (event.key) {
      case 'ArrowDown':
        this.setActive(this.active + 1);
        break;
      case 'ArrowUp':
        this.setActive(this.active - 1);
        break;
      case 'Enter':
        this.take(this.rows[this.active]);
        break;
      case 'Escape':
      case 'Tab':
        this.close();
        break;
      default:
        event.stopPropagation();
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
}

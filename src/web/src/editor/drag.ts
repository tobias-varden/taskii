// Dragging a task by its grip: to reorder it, to move it to the other column, or onto the
// collapsed backlog rail.
//
// This uses pointer events rather than the browser's drag and drop, because the drop targets
// are two separate editors and a button, and the drop position needs to be shown precisely.

import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface GripOptions {
  onGrab: (event: PointerEvent, editor: Editor, taskId: string) => void;
}

/** The grip that appears beside a task on hover. */
export const Grips = Extension.create<GripOptions>({
  name: 'grips',

  addOptions() {
    return { onGrab: () => {} };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { onGrab } = this.options;

    const grip = (id: string) => () => {
      const el = document.createElement('span');
      el.className = 'grip';
      el.title = 'Drag to move';
      el.addEventListener('pointerdown', (event) => {
        if (event.button === 0) onGrab(event, editor, id);
      });
      return el;
    };

    return [
      new Plugin({
        key: new PluginKey('grips'),
        props: {
          decorations(state) {
            if (!editor.isEditable) return null;
            const decorations: Decoration[] = [];
            state.doc.forEach((task, pos) => {
              const id: string = task.attrs.id;
              if (!id) return;
              decorations.push(
                Decoration.widget(pos + 1, grip(id), { side: -1, key: `grip-${id}`, ignoreSelection: true, stopEvent: () => true }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export interface DragColumn {
  editor: Editor;
  /** The element that scrolls and that counts as "over this column". */
  scroller: HTMLElement;
}

export type DropIndex = number | 'start' | 'end';

type Drop = { editor: Editor; index: DropIndex } | null;

const EDGE = 48;
const SCROLL_STEP = 14;

export class TaskDrag {
  private readonly line = document.createElement('div');
  /** Dims the task being dragged. A rule rather than a class on the task: the editor owns that element. */
  private readonly dim = document.createElement('style');

  constructor(
    private readonly columns: () => DragColumn[],
    private readonly rail: HTMLElement,
    private readonly railColumn: () => Editor,
    private readonly move: (source: Editor, taskId: string, target: Editor, index: DropIndex) => void,
  ) {
    this.line.className = 'drop-line';
    this.line.hidden = true;
    document.body.append(this.line);
    document.head.append(this.dim);
  }

  start(event: PointerEvent, source: Editor, taskId: string): void {
    event.preventDefault();
    this.dim.textContent = `.task[data-id="${CSS.escape(taskId)}"] { opacity: 0.35; }`;
    document.body.classList.add('dragging-task');

    let drop: Drop = null;

    const onMove = (e: PointerEvent) => {
      drop = this.locate(e.clientX, e.clientY);
    };
    const finish = (commit: boolean) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey, true);
      this.dim.textContent = '';
      document.body.classList.remove('dragging-task');
      this.rail.classList.remove('drop-target');
      this.line.hidden = true;
      if (commit && drop) this.move(source, taskId, drop.editor, drop.index);
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

  /** Works out where a drop at this point would land, and shows it. */
  private locate(x: number, y: number): Drop {
    this.line.hidden = true;

    const railBox = this.rail.getBoundingClientRect();
    const overRail = railBox.width > 0 && x >= railBox.left && x <= railBox.right && y >= railBox.top && y <= railBox.bottom;
    this.rail.classList.toggle('drop-target', overRail);
    if (overRail) return { editor: this.railColumn(), index: 'start' };

    for (const { editor, scroller } of this.columns()) {
      const box = scroller.getBoundingClientRect();
      if (box.width === 0 || x < box.left || x > box.right || y < box.top || y > box.bottom) continue;

      if (y < box.top + EDGE) scroller.scrollTop -= SCROLL_STEP;
      if (y > box.bottom - EDGE) scroller.scrollTop += SCROLL_STEP;

      const root = editor.view.dom;
      const tasks = [...root.querySelectorAll<HTMLElement>(':scope > .task')].filter((el) => el.offsetParent !== null);
      const indexOf = (el: HTMLElement) => editor.state.doc.resolve(editor.view.posAtDOM(el, 0)).index(0);

      let index: DropIndex = 'end';
      let lineY = tasks.length ? tasks[tasks.length - 1].getBoundingClientRect().bottom : root.getBoundingClientRect().top;
      for (const task of tasks) {
        const rect = task.getBoundingClientRect();
        if (y < rect.top + rect.height / 2) {
          index = indexOf(task);
          lineY = rect.top;
          break;
        }
      }

      const rootBox = root.getBoundingClientRect();
      this.line.style.left = `${rootBox.left}px`;
      this.line.style.width = `${rootBox.width}px`;
      this.line.style.top = `${Math.max(box.top, Math.min(box.bottom, lineY)) - 1}px`;
      this.line.hidden = false;
      return { editor, index };
    }

    return null;
  }
}

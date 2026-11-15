// The calendar under the date: jumps to any day up to today, and marks the days that have something on them.

import { addDays, formatDate, monthTitle } from './dates';

export interface CalendarHooks {
  today(): string;
  /** The day on screen. */
  shown(): string | null;
  /** Every day that has a file. */
  days(): Promise<string[]>;
  open(date: string): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const pad = (n: number) => String(n).padStart(2, '0');

// Months are counted from year 0, so stepping over a year end is plain arithmetic.
const monthOf = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const yearOf = (month: number) => Math.floor(month / 12);
const lengthOf = (month: number) => new Date(Date.UTC(yearOf(month), (month % 12) + 1, 0)).getUTCDate();
const dayIn = (month: number, day: number) => `${yearOf(month)}-${pad((month % 12) + 1)}-${pad(Math.min(day, lengthOf(month)))}`;

const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

export class Calendar {
  /** The month on show. */
  private month = 0;
  /** The earliest month there is anything to see in. */
  private firstMonth = 0;
  /** The day the arrow keys move from. Always in the month on show. */
  private cursor = '';
  private days = new Set<string>();
  private opening = false;

  constructor(private readonly hooks: CalendarHooks) {
    const anchor = $('cal-anchor');
    const popover = $('cal');

    $('date').addEventListener('click', () => (popover.hidden ? void this.open() : this.close(true)));
    for (const [id, by] of [['cal-prev', -1], ['cal-next', 1]] as const) {
      $<HTMLButtonElement>(id).addEventListener('click', (event) => {
        this.stepMonth(by);
        // At the last month the button goes out of use, and would take the keyboard with it.
        if ((event.currentTarget as HTMLButtonElement).disabled) this.focusCursor();
      });
    }
    $('cal-days').addEventListener('click', (event) => {
      const date = (event.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date;
      if (!date) return;
      this.close(true);
      this.hooks.open(date);
    });

    popover.addEventListener('keydown', (event) => this.handleKey(event));
    document.addEventListener('pointerdown', (event) => {
      if (!anchor.contains(event.target as Node)) this.close();
    });
    // Focus going elsewhere on the page closes it; the whole window losing focus does not.
    popover.addEventListener('focusout', (event) => {
      const to = event.relatedTarget as Node | null;
      if (to && !anchor.contains(to)) this.close();
    });
  }

  close(refocus = false): void {
    if ($('cal').hidden) return;
    $('cal').hidden = true;
    $('date').setAttribute('aria-expanded', 'false');
    if (refocus) $('date').focus();
  }

  private async open(): Promise<void> {
    if (this.opening || !this.hooks.shown()) return;
    this.opening = true;
    try {
      this.days = new Set(await this.hooks.days());
    } catch (error) {
      // Still a way to get to a day, only without the marks.
      console.error(error);
    } finally {
      this.opening = false;
    }

    const shown = this.hooks.shown();
    if (!shown) return;
    const today = this.hooks.today();
    this.firstMonth = monthOf([...this.days, shown, today].reduce((a, b) => (a < b ? a : b)));
    this.cursor = shown > today ? today : shown;
    this.render(monthOf(this.cursor));
    $('cal').hidden = false;
    $('date').setAttribute('aria-expanded', 'true');
    this.focusCursor();
  }

  private stepMonth(by: number): void {
    this.moveTo(dayIn(this.month + by, Number(this.cursor.slice(8))));
  }

  /** Puts the cursor on a day, or on the nearest one that can be reached, and shows its month. */
  private moveTo(date: string): void {
    const today = this.hooks.today();
    if (date > today) date = today;
    if (monthOf(date) < this.firstMonth) date = dayIn(this.firstMonth, 1);
    this.cursor = date;
    this.render(monthOf(date));
  }

  private focusCursor(): void {
    $('cal-days').querySelector<HTMLElement>(`[data-date="${this.cursor}"]`)?.focus();
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (event.key === 'Escape') {
      this.close(true);
    } else if (event.key in STEPS) {
      this.moveTo(addDays(this.cursor, STEPS[event.key]));
      this.focusCursor();
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      this.stepMonth(event.key === 'PageUp' ? -1 : 1);
      this.focusCursor();
    } else {
      return;
    }
    // These keys are spent here: Esc must not also clear the tag filter of the day underneath.
    event.preventDefault();
    event.stopPropagation();
  }

  private render(month: number): void {
    const today = this.hooks.today();
    const shown = this.hooks.shown();
    this.month = month;

    $('cal-title').textContent = monthTitle(yearOf(month), month % 12);
    $<HTMLButtonElement>('cal-prev').disabled = month <= this.firstMonth;
    $<HTMLButtonElement>('cal-next').disabled = month >= monthOf(today);

    // Weeks start on Monday.
    const lead = (new Date(Date.UTC(yearOf(month), month % 12, 1)).getUTCDay() + 6) % 7;
    const buttons: HTMLElement[] = [];
    for (let day = 1; day <= lengthOf(month); day++) {
      const date = dayIn(month, day);
      const has = this.days.has(date);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cal-day';
      button.textContent = String(day);
      button.dataset.date = date;
      button.title = has || date >= today ? formatDate(date) : `${formatDate(date)}, nothing written`;
      button.disabled = date > today;
      button.tabIndex = date === this.cursor ? 0 : -1;
      button.classList.toggle('has', has);
      button.classList.toggle('today', date === today);
      button.classList.toggle('sel', date === shown);
      if (date === shown) button.setAttribute('aria-current', 'date');
      if (day === 1) button.style.gridColumnStart = String(lead + 1);
      buttons.push(button);
    }
    $('cal-days').replaceChildren(...buttons);
  }
}

// How dates are written on the page. Days travel as yyyy-MM-dd.

const long = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const short = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const shortWithYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const monthAndYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function toDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** "Mon 16 Nov 2026" */
export function formatDate(iso: string): string {
  return long.format(toDate(iso)).replace(',', '');
}

/** "November 2026". `month` counts from 0. */
export function monthTitle(year: number, month: number): string {
  return monthAndYear.format(new Date(Date.UTC(year, month, 1)));
}

/** The day that many days after `iso`, or before it when negative. */
export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** "16 Nov", with the year when it is not the year of `today`. */
export function shortDate(iso: string, today: string): string {
  return (iso.slice(0, 4) === today.slice(0, 4) ? short : shortWithYear).format(toDate(iso));
}

/** "Fri 13 Nov", with the year when it is not the year of `today`. */
export function weekdayDate(iso: string, today: string): string {
  return iso.slice(0, 4) === today.slice(0, 4) ? weekday.format(toDate(iso)).replace(',', '') : formatDate(iso);
}

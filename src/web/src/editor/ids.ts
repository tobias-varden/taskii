const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A new task ID. Six characters rather than the four in the design's example: IDs must stay
 * unique across every day ever written, and at four characters a few years of tasks would
 * be expected to collide.
 */
export function newTaskId(taken?: ReadonlySet<string>): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let id = '';
    for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
    if (!taken?.has(id)) return id;
  }
}

/** Local time as it is written in a task's `done` field, for example 2026-11-16T08:40. */
export function localStamp(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}`;
}

import { describe, expect, it } from 'vitest';
import { candidates, type OpenTask } from './blocked';

const task = (id: string, blockedBy: string | null = null): OpenTask => ({ id, title: id, blockedBy });

describe('blocked by', () => {
  it('offers every other open task except those that wait for this one', () => {
    // c waits for b, b waits for a: neither can be what a waits for.
    const open = [task('a'), task('b', 'a'), task('c', 'b'), task('d'), task('e', 'gone')];
    expect(candidates('a', open).map((t) => t.id)).toEqual(['d', 'e']);
    expect(candidates('c', open).map((t) => t.id)).toEqual(['a', 'b', 'd', 'e']);
  });

  it('survives tasks that already wait for each other', () => {
    const open = [task('a', 'b'), task('b', 'a'), task('c')];
    expect(candidates('c', open).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

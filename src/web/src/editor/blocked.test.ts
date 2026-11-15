import { describe, expect, it } from 'vitest';
import { blockerOf, candidates, type OpenTask } from './blocked';

const task = (id: string, blockedBy: string | null = null): OpenTask => ({ id, title: id, blockedBy });

describe('blocked by', () => {
  it('reads the task to wait for from the fields', () => {
    expect(blockerOf([{ key: 'done', value: '2026-11-16T08:40' }, { key: 'blocked-by', value: '^c9d0' }])).toBe('c9d0');
    expect(blockerOf([{ key: 'blocked-by', value: '' }])).toBeNull();
    expect(blockerOf([])).toBeNull();
  });

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

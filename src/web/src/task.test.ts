import { describe, expect, it } from 'vitest';
import { blockerOf, blockersOf, doneAt, splitTag, tagOf } from './task';

describe('task', () => {
  it('reads the tag before the first colon', () => {
    expect(tagOf('ACME: Fix users')).toBe('ACME');
    expect(tagOf('Portal infra: Use refresh tokens')).toBe('Portal infra');
    expect(tagOf('ACME:no space')).toBeNull();
    expect(tagOf('https://example.com')).toBeNull();
    expect(tagOf('No tag here')).toBeNull();
  });

  it('takes a title apart into its tag and the rest', () => {
    expect(splitTag('ACME:  Fix users')).toEqual({ tag: 'ACME', title: 'Fix users' });
    expect(splitTag('Fix users')).toEqual({ tag: null, title: 'Fix users' });
  });

  it('reads the task to wait for from the fields', () => {
    expect(blockerOf([{ key: 'done', value: '2026-11-16T08:40' }, { key: 'blocked-by', value: '^c9d0' }])).toBe('c9d0');
    expect(blockerOf([{ key: 'blocked-by', value: '' }])).toBeNull();
    expect(blockerOf([])).toBeNull();
    expect(blockersOf([{ key: 'blocked-by', value: '^a' }, { key: 'blocked-by', value: '' }, { key: 'blocked-by', value: 'b' }])).toEqual(['a', 'b']);
  });

  it('reads when a task was done from its last done field', () => {
    expect(doneAt([{ key: 'done', value: '2026-11-15T09:00' }, { key: 'done', value: '2026-11-16T08:40' }])).toBe('2026-11-16T08:40');
    expect(doneAt([])).toBeNull();
  });
});

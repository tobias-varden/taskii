import { describe, expect, it } from 'vitest';
import { blockerOf, splitTag } from './task';

describe('task', () => {
  // tagOf, blockersOf and doneAt are run on the shared cases in tests/rules/cases.json, by rules.test.ts.

  it('takes a title apart into its tag and the rest', () => {
    expect(splitTag('ACME:  Fix users')).toEqual({ tag: 'ACME', title: 'Fix users' });
    expect(splitTag('Fix users')).toEqual({ tag: null, title: 'Fix users' });
  });

  it('reads the one task to wait for from the fields', () => {
    expect(blockerOf([{ key: 'done', value: '2026-11-16T08:40' }, { key: 'blocked-by', value: '^c9d0' }])).toBe('c9d0');
    expect(blockerOf([{ key: 'blocked-by', value: '' }])).toBeNull();
    expect(blockerOf([])).toBeNull();
  });
});

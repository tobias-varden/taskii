// The rules both sides implement, run on the cases they share with Taskii.Core.Tests.
import { describe, expect, it } from 'vitest';
import cases from '../../../tests/rules/cases.json';
import { termsOf } from './search';
import { blockersOf, doneAt, tagOf } from './task';
import type { TaskField } from './types';

const fields = (pairs: string[][]): TaskField[] => pairs.map(([key, value]) => ({ key, value }));
// Entries without the case's own key, such as a lone "$comment", describe the list and are skipped.
const real = <T extends object, K extends string>(list: T[], key: K) => list.filter((entry): entry is Extract<T, Record<K, unknown>> => key in entry);

describe('shared rule cases', () => {
  it.each(real(cases.tag, 'title'))('tag of $title', ({ title, tag }) => {
    expect(tagOf(title)).toBe(tag);
  });

  it.each(real(cases.blockers, 'fields'))('blockers of $fields', ({ fields: pairs, ids }) => {
    expect(blockersOf(fields(pairs))).toEqual(ids);
  });

  it.each(real(cases.doneAt, 'fields'))('done at of $fields', ({ fields: pairs, stamp }) => {
    expect(doneAt(fields(pairs))).toBe(stamp);
  });

  it.each(real(cases.terms, 'query'))('terms of $query', ({ query, terms }) => {
    expect(termsOf(query)).toEqual(terms);
  });
});

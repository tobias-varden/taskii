// What a task's title and fields mean: its tag, what it waits for, when it was done.
// No DOM and no editor here, so any part of the page can use it. Taskii.Core has the same
// rules in TaskTags and TaskFields.

import type { TaskField } from './types';

/** The inline fields Taskii itself writes on a task, as `[key:: value]` on its title line. */
export const FIELD = {
  /** When the task was checked off, local time: `[done:: 2026-11-16T08:40]`. */
  done: 'done',
  /** The ID of the open task this one waits for: `[blocked-by:: ^c9d0]`. */
  blockedBy: 'blocked-by',
} as const;

/** The tag is the text before the first colon in a task title: "ACME" in "ACME: Fix users". */
const TAG = /^([^\s:][^:]{0,23}):(?= |$)/;

export function tagOf(title: string): string | null {
  const match = TAG.exec(title);
  // "https://..." is a link, not a tag called "https".
  return match && !/https?$/i.test(match[1]) ? match[1] : null;
}

/** The title after `tag` and its colon. */
export const afterTag = (title: string, tag: string) => title.slice(tag.length + 1).trimStart();

/** A title taken apart into its tag, if it has one, and the rest. */
export function splitTag(title: string): { tag: string | null; title: string } {
  const tag = tagOf(title);
  return { tag, title: tag ? afterTag(title, tag) : title };
}

/** The IDs of every task these fields say to wait for. */
export function blockersOf(fields: readonly TaskField[] | undefined): string[] {
  return (fields ?? [])
    .filter((field) => field.key === FIELD.blockedBy)
    .map((field) => field.value.replace(/^\^/, ''))
    .filter(Boolean);
}

/** The ID of the task these fields say to wait for. Taskii only ever writes one. */
export const blockerOf = (fields: readonly TaskField[] | undefined): string | null => blockersOf(fields)[0] ?? null;

/** When the task was checked off, as its `done` field says. Null if it does not say. */
export const doneAt = (fields: readonly TaskField[]): string | null => fields.findLast((field) => field.key === FIELD.done)?.value ?? null;

/** The `done` field for a task checked off at `stamp`. */
export const doneField = (stamp: string): TaskField => ({ key: FIELD.done, value: stamp });

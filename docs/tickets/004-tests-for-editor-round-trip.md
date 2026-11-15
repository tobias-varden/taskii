# Tests for the editor's round trip of untouched text

## Problem

Taskii's central promise is that text the user did not touch is written back exactly as it
was typed. The C# half (`DayFile`, `DayFormat`) has thorough tests in `DayFileTests`. The
browser half has none: `Originals` and the converters in `src/web/src/editor/convert.ts`.

`Originals` remembers the markdown each title and body was loaded from. On the way out, any
text that normalises to the same thing as an original is written as the original, so a `*`
bullet stays `*` and a tab stays a tab. If that breaks, every save quietly rewrites the
user's file into Taskii's own style. The C# side then sees a real change, and the "unchanged
items keep their text" guarantee is lost.

`markdown.test.ts` covers parsing and serializing, but not the step that puts the original
back.

## Proposal

Add `src/web/src/editor/convert.test.ts`. No editor or DOM is needed: `tasksToDoc` /
`docToTasks` and `notesToDoc` / `docToNotes` work on plain JSON.

Cases:

1. **Round trip is exact** for non-canonical markdown: `*` bullets, `_italic_` vs `*italic*`,
   `__bold__`, tabs, extra spaces in a title, a fenced block, nested checkbox lines, an image
   line. `docToTasks(tasksToDoc(tasks, o), o)` equals `tasks`, and the same for notes.
2. **An edited item is written canonically**: change one node in the doc JSON and check that
   only that title or body comes back normalised, and its neighbours keep their originals.
3. **Same text in two places**: two tasks with identical bodies typed differently (`*` and
   `-`). Document what happens, since `byNormalised` keeps one original per normalised form.
   Fix it if the answer is wrong.
4. **Empty items are dropped**: a task or card with no title and body is not returned, and a
   card with only side notes is kept.
5. **Fields survive**: `done` / `blocked-by` and unknown fields come back unchanged and in order.

## Done when

- `convert.test.ts` exists with the cases above and runs in `pnpm test`.
- Any bug found by case 3 is either fixed or written down as a known limitation in `convert.ts`.

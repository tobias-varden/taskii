# One set of test cases for the rules both sides implement

## Problem

Some rules about task text are implemented twice, in C# for the files, index and CLI, and in
TypeScript for the editor, standup and capture bar. Only comments keep them in agreement:

| Rule | C# | TS |
|---|---|---|
| A title's tag | `TaskTags.Of` | `tagOf` in `src/web/src/task.ts` |
| What a task waits for | `TaskFields.BlockersOf` | `blockersOf` / `blockerOf` in `task.ts` |
| When a task was done | `TaskFields.DoneAt` (parses the stamp) | `doneAt` in `task.ts` (raw string, compared as text) |
| Search words | `SearchIndex.MatchExpression` | `termsOf` / `finder` in `search.ts` |

If one side changes, for example the tag length limit (24) or the `https` exception, the
other keeps the old rule. Then the capture bar's tag list (C#) and the editor's tag labels
(TS) disagree on the same title.

## Proposal

Add one shared file of cases, say `tests/rules/cases.json`:

```json
{
  "tag": [
    { "title": "ACME: Fix users", "tag": "ACME" },
    { "title": "https://example.com", "tag": null },
    { "title": "ACME:no space", "tag": null }
  ],
  "blockers": [
    { "fields": [["blocked-by", "^c9d0"], ["blocked-by", ""]], "ids": ["c9d0"] }
  ],
  "terms": [
    { "query": "contoso-edu client", "terms": ["contoso", "edu", "client"] }
  ]
}
```

Run it from both sides:

- an xUnit theory in `Taskii.Core.Tests` that loads the file, and
- a vitest suite next to `task.test.ts` that imports it.

Move the existing hand-written cases for these rules into the file, so there is one list to
add to.

## Done when

- Both test suites read the same file, and each of the four rules above has cases in it.
- The "same rule as …" comments in `TaskTags.cs` and `task.ts` point at the shared cases.

## Notes

- Search words already differ slightly. `MatchExpression` splits on `char.IsLetterOrDigit`,
  which only counts decimal digits as digits; `termsOf` splits on `\p{L}\p{N}`, which also
  counts `²`, `½` and `Ⅻ`. Add a case like `"x² ½"` and decide which side is right.
  `MatchExpression` returns `"word"*` FTS syntax, so the C# test should pull the words out
  of it (or the split should move to a small helper both can be tested on).

- `doneAt` is deliberately different: TS compares raw stamps as text, C# parses them. Test
  only the inputs where both have to agree, such as which field is picked when there are two.
- `TicketRefs` has no TS copy since ticket [001](001-mock-host-stops-reimplementing-search.md)
  removes the mock's. If that ticket hasn't landed yet, add ticket cases here too.

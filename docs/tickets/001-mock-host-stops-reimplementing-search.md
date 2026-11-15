# Mock host stops reimplementing the index

## Problem

`src/web/src/mockHost.ts` is the stand-in shell for `pnpm dev`. About 200 of its lines
rebuild what `Taskii.Core.Search.SearchIndex` does: item histories, related items, search
matching and note ages. It is a second backend, and it has already drifted:

- `ticketsIn` only knows the typed short form (`repo#123`). `TicketRefs.cs` also reads
  pasted GitHub and Azure DevOps links, so related items differ between dev and the app.
- Notes are keyed `'n:' + JSON.stringify(note)`. The index keys them by a hash of their
  file text. Anything that ever looks at the key shape behaves differently.
- `noteAges` matches by heading and body itself instead of following `NotesSince`.

Every search feature has to be written twice, and the browser copy is the one nobody tests.

## Proposal

Keep the parts of the mock that need state: `init`, `loadDay`, `saveDay` (including
`?conflict`), `listDays`, `peek`, `standup`/`finishStandup` and `capture`.

Replace `search`, `searchItem` and `noteAges` with **canned responses**: a small fixture
module of `SearchResponse` / `ItemHistory` / `NoteAgeDto[]` values built from the sample
days. Filter search hits with a plain substring check on the title, so typing still changes
the list. The point is to give the page something realistic to draw, not to be right.

Optionally, the fixtures could later be produced from the real index by a small script or
CLI flag, so they stay true to the C# shapes.

## Done when

- `mockHost.ts` no longer contains `histories`, `relatedTo`, `ticketsIn` or its own search.
- It no longer imports `finder`/`termsOf` from `search.ts`.
- `pnpm dev` still shows search results, the item history panel with related items, and
  note ages on the board.
- `mockHost.ts` is substantially shorter (target: under 200 lines).

## Notes

- The sample data in `sampleDays()` can stay; the calendar and day navigation need it.
- Related tickets: [003](003-shared-rule-cases-for-csharp-and-ts.md), which removes the
  other place the C# and TS rules can drift apart.

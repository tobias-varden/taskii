# Taskii design

Taskii is a personal daily work log for Windows. It replaces a OneNote habit: one page per day holding a task list and free-form working notes, copied forward each morning. This document records the design agreed so far and is written so that someone with no other context can start building from it.

Status: design agreed in conversation. Nothing is built yet. Items under [Open questions](#open-questions) are not decided.

## Background: the workflow being replaced

The user keeps a daily log in OneNote:

- Each day is a page with a TODO list, a Backlog list, and free-form notes placed around the page. Images are pasted in sometimes.
- Each task is a checkbox line with a title, usually prefixed by an area (`ACME: Fix users with space in username`), followed by indented notes: stats, next steps, who they are waiting on.
- Every morning the previous day's page is copied to a new page. Done tasks are removed once they have been reported at the daily standup.
- Old pages are kept, so the user can go back to see what they worked on and when. Pages are nested by month and year by hand. Search is used to find things.

The chores in this are the daily copy, the pruning after standup, and the month and year filing. The valuable properties are that every past day is preserved exactly as it was, and that nothing disappears until the user removes it.

## Principles

1. **The day is a snapshot, the task is a thing with a lifespan.** Each day is stored whole and never changes afterwards. Tasks have identity across days.
2. **Everything carries forward until the user lets it go.** Tasks leave by being completed and reported. Notes leave by being deleted. Nothing is dropped silently.
3. **Deleting is safe.** Past days are frozen, so removing something from today only stops it travelling forward.
4. **Plain files are the truth.** One markdown file per day in a folder that OneDrive syncs. The files must be readable and useful without Taskii.
5. **No ceremony.** Creating a task or a note is typing. There are no forms.
6. **Structure is optional.** The app never forces the user to link, categorise or nest anything.

## Concepts

| Concept | Meaning |
| --- | --- |
| Day | One calendar day's page. Stored as one markdown file. Only today is editable. |
| Task | A checkbox with a title and an optional free-form body of notes. Has a stable hidden ID. Lives in Todo or Backlog. |
| Task body | The indented notes under a task. Rich text: paragraphs, bullets, links, images, nested checkboxes. Travels with the task. |
| Tag | The text before the first colon in a task title, for example `ACME`. Used for filtering and autocomplete. |
| Blocked by | A link from one task to another open task that must be finished first. |
| Backlog | Tasks that are not a priority right now. Same shape as Todo tasks. |
| Note card | A free-form note on the board, not tied to any task. Has a heading and a body. |
| Side note | A note card docked to another card, for related detail that should not clutter the main note. |
| Standup | The moment the user reports progress. Finishing a standup is what releases done tasks. |

## Screens

### Main window

The window has three areas, left to right:

- **Todo column.** The tasks being worked on, each with its body beneath it. A task body can be folded to just its title, with a hint such as "4 lines".
- **Backlog column.** Collapsed to a thin rail by default, showing only its name and a count. Clicking the rail, or a keyboard shortcut, expands it.
- **Board.** Note cards flowing into as many columns as the window width allows. The page scrolls vertically only.

The top bar has previous and next day, a calendar jump, search across all days, and the Standup button.

With the backlog expanded it is a full column with the same layout as Todo, and the board narrows. Whether the backlog is open is a view setting remembered locally. It is not written to the day file.

#### Tasks

- Typing `[]` and a space at the start of a line makes a checkbox. Enter on a task title starts the next task.
- A task's body is free-form and indented under it. Nested checkboxes are allowed inside a body for occasional sub-tasks, but tasks are otherwise flat.
- Tasks are reordered by dragging a grip that appears on hover, or with Alt+Up and Alt+Down. Order is the order of lines in the file, so it carries forward.
- Tasks move between Todo and Backlog by dragging, including onto the collapsed rail, or with a shortcut.
- A done task stays in place, struck through, until the next standup is finished.
- A line of note text can be promoted to a task with a shortcut.

#### Tags

- The text before the first colon in a task title is its tag. The user keeps typing `ACME: Fix users...` as today, and the file keeps that as plain text.
- The tag is drawn as a small label. Typing a new task offers existing tags as autocomplete, which prevents drift such as `ACME` and `AC-ME`.
- Clicking a tag filters Todo and Backlog to that tag. Search accepts a tag as a filter.

#### Blocked by

- On a task, Alt+B opens a picker of open tasks. Picking one, or typing a new title, marks the current task as blocked by it. A new blocker is created directly above the blocked task.
- A blocked task is dimmed and shows a "blocked by" label.
- Checking off the blocker unblocks the task automatically. Nothing is rewritten for that: the `blocked-by` field stays on the task, and a task counts as blocked only while the task it points at is open. Unchecking the blocker blocks it again.
- Clicking the label, or Alt+B again, changes the blocker or removes it. A task that already waits for this one, directly or through others, is not offered.

#### Note cards and side notes

- The board is for anything not tied to a task: meeting jottings, commands, screenshots, loose thoughts.
- A new card is started by typing in the empty space at the end of the board. A shortcut inserts a card with a timestamped heading such as `10:05 Sprint planning`.
- A card is the unit for moving, collapsing and deleting. Cards are reordered by dragging.
- A side note is a card docked to another card. It moves with its parent, can be edited or deleted on its own, and can be dragged off to become a normal card. It is created with a shortcut or by dragging a card onto another card's edge. On a wide board it sits to the right of its parent; on a narrow one it tucks underneath.
- Each card shows its age, such as `today`, `3d` or `2w`, so stale notes are obvious. The age is how long the card has read exactly as it does now, so editing one makes it `today` again. A card and each of its side notes age on their own.
- Images are pasted from the clipboard into cards and task bodies.

There is deliberately no free canvas. Positions are never stored. The board is a display of sections that are linear in the file.

#### Ticket links

The user works with both Azure DevOps and GitHub.

- A pasted Azure DevOps work item or pull request URL, or a GitHub issue or pull request URL, becomes a compact chip such as `AB#4521` or `widget-service#413` that opens the page when clicked.
- Typed short forms need a prefix: `AB#123` means Azure DevOps, `repo#123` means GitHub, using a settings list that maps short repository names to `owner/repo`. A bare `#123` is left as plain text because it is ambiguous.
- In the file a chip is an ordinary markdown link.
- A note that mentions the same ticket as a task is considered related to it. This is shown in the task's history and needs no action from the user.

### Standup mode

Standup mode is a read-through view for the daily standup. It covers everything since the last time a standup was finished, so a Monday standup includes Friday.

- **Done:** tasks completed since the last standup, with their bodies.
- **Working on:** open Todo tasks. Body lines added since the last standup are marked. Untouched tasks say "no change", and tasks created since then say "new task".
- **Blocked:** tasks marked as blocked, with what they are waiting for.
- Backlog tasks are not shown.
- Sections are ordered by status, with tasks sorted by tag inside each section.

Two actions:

- **Finish standup** records the time. Done tasks completed before that moment stop carrying forward. This replaces the manual pruning. A standup takes nothing from the day it is finished on: what was reported stays in today's list, struck through, and is gone from the next day.
- **Copy as text** puts the summary on the clipboard as plain text, for standups held in chat.

### Quick capture

A global hotkey opens a small bar over whatever the user is doing. The main window does not open. After sending, the bar disappears and focus returns to the previous window, with no confirmation popup.

- The first line is the task title. Tag autocomplete works here.
- **Shift+Enter** adds a line, and the bar grows. Lines after the first become the task's body. It is the same editor as the main window, so bullets, links, pasted ticket URLs and pasted screenshots work.
- **Enter** adds the task to the bottom of Todo.
- Small buttons send it to the **Backlog** or make it a **Note card** instead. Both are reachable with Tab.
- Starting with `@` picks an existing open task. Whatever is typed is appended to that task's body.
- **Esc** closes without saving.

A second global hotkey opens the main window.

### Search

Search runs from the top bar across all days and updates as the user types.

- **One result per thing, not per day.** Content is copied forward, so the same task or note exists on many days. A task is one result however many days it lived on, identified by its ID. Identical notes collapse into one, identified by their content. Each result shows the span it covers, for example "9 Sep → today · 48 days" or "2 Oct → 6 Oct · done".
- **Results are grouped into Tasks and Notes**, newest first, with the matching text highlighted in the title or in a snippet of the body.
- **Filters** narrow results to tasks or notes, to one tag, and to open or done tasks.
- **The preview pane** on the right shows the selected result as it was on the latest day it appeared. A pager above it steps through the days the item existed: first day, previous day, next day and latest day, with a label such as "day 48 of 48". Items can live for months, especially in the backlog, so the days are never all listed at once. Because most of those days are identical copies, "Previous change" and "Next change" jump straight to the days where the item's content differs.
- **Related** lists the task's blocker and any notes that mention the same ticket or were found alongside it.
- **Keyboard:** Up and Down move through results, Enter opens the day shown in the preview, Esc returns to today.

### Navigating time

- The app opens on today.
- Previous and next move one day at a time between days that exist. The calendar jumps to any day, and should indicate which days have content.
- Past days are shown exactly as they were and are read-only.
- A task has a history view listing the day it first appeared, the day it was done, every day in between, and notes on any day that mention the same ticket.
- Year and month grouping comes from the dates. There is nothing to file by hand.

## Day lifecycle and carry-forward

- Today's file is created the first time the user edits on a new day. Opening the app only to look something up creates nothing.
- Before that first edit, today is shown as a preview carried from the most recent existing day, so Monday carries from Friday.
- When today's file is created it receives, from the most recent day:
  - every open task in Todo and Backlog, with its body, in the same order;
  - every done task that was completed after the last finished standup;
  - every note card and side note.
- Done tasks completed before the last finished standup are not copied. They remain on the days they appeared.
- Editing a carried item today never changes a past day, so a note's evolution can be traced through the days.

## Storage

### Data folder

A folder chosen by the user, expected to be inside OneDrive. Proposed layout:

```
<data folder>/
  2026/
    11/
      2026-11-13.md
      2026-11-16.md
  assets/
    3fa9c1d2e7.png
  standups/
    2026-11-16T0915.md
```

- One markdown file per day that was edited. Only today's file is ever written, which keeps sync conflicts rare.
- Images are stored once in `assets`, named by a hash of their content, so carrying a note forward does not duplicate the image.
- Finishing a standup saves a copy of today's file as `standups/2026-11-16T0915.md`, named by the minute it was finished. The newest one says when done tasks were last reported, and is what "new since the last standup" is compared against. It syncs with the rest of the folder.

### Day file format

The file is plain markdown that reads sensibly in any editor. Proposed shape:

```markdown
# Todo

- [ ] ACME: Fix users with space in username ^t7k2
  Get stats 1 234 (~500 have space in the middle)
  Tell Support about it
- [ ] Federation: Get client secret from Contoso ^c9d0
- [ ] Federation: Add Contoso Edu to our TEST environment ^a1b3 [blocked-by:: ^c9d0]
  Onboard them, details in Mail
- [x] Dev: Switch all repos to use SharedBuild agent pool ^q2w3 [done:: 2026-11-16T08:40]

# Backlog

- [ ] Portal infra: Use refresh tokens on PROD ^m4n5
  - [ ] Apply new portalv3 and portal-admin

# Notes

## Catalog search PR
Draft ready, waiting on review. [widget-service#413](https://github.com/owner/widget-service/pull/413)

### Edge cases
Email match must ignore case, username must not.

## 10:05 Sprint planning
Security fixes go out before the 24th.
```

- `# Todo`, `# Backlog` and `# Notes` are the three fixed sections.
- A task is a top-level checkbox item. Its body is the indented content beneath it.
- Each task carries a short stable ID at the end of its title line (`^t7k2`). The editor hides it. The ID is what links a task across days and what `blocked-by` refers to.
- A note card is a `##` heading and what follows it. A side note is a `###` heading under its parent card.
- Note cards have no IDs. The index identifies a note by a fingerprint of its content, which is enough to find its first appearance and to collapse duplicates in search. Editing a note makes it new again, which suits the age marker.
- The exact inline syntax for `blocked-by` and `done` is a proposal and may be changed, provided the file stays readable.

### Search index

- SQLite with full-text search, used for search, task history, tag lists and note ages.
- The database lives outside the synced folder, under the user's local application data. A live SQLite file inside OneDrive risks corruption and conflict copies.
- The index is a cache. It can be deleted and rebuilt from the day files at any time, and it must pick up files that OneDrive changes in the background.

## Technology

- **Shell:** C# on .NET 10 with WinUI 3 (Windows App SDK, unpackaged), Windows only. It owns the window, tray icon, global hotkeys, file reading and writing, the file watcher and the SQLite index. The app should be single-instance and stay running in the tray so quick capture is instant.
- **UI:** WebView2 hosting a web front end. The whole page (Todo, Backlog, board, standup mode) is web content, talking to the shell over the WebView2 message bridge.
- **Editor:** TipTap, for checkboxes, nested content, image paste and custom inline elements such as tags and ticket chips.
- **Quick capture:** a second small borderless window using the same editor bundle, kept warm so it appears immediately.

The main technical risk is the round trip between the editor's document and markdown. Loading a day file and saving it without edits must leave the file unchanged, including hidden task IDs and inline fields. This deserves automated tests from the start.

## Suggested build order

1. Shell with WebView2 and the editor, loading and saving today's file in a chosen data folder.
2. Tasks: checkboxes with bodies, hidden IDs, folding, reordering, tags with autocomplete, the backlog column.
3. Day navigation, carry-forward, and read-only past days.
4. Board: note cards, side notes, timestamped headings, image paste into `assets`.
5. Quick capture, global hotkeys and the tray icon.
6. Standup mode, including finishing a standup and copying as text.
7. Index, search with collapsed duplicates, note ages, task history.
8. Ticket chips and blocked-by.

## Open questions

- **Hotkeys.** The global hotkeys for quick capture and for opening the main window, and the in-app shortcuts for blocked-by, promote to task, move to backlog, new side note and timestamped heading, are not chosen.
- **Editing the past.** Past days are read-only. Whether there should be a deliberate way to correct one is undecided.
- **Sync conflicts.** What to do when OneDrive produces a conflict copy of today's file, for example after editing on two machines.
- **Related items in search.** Which notes count as related to a task, beyond its blocker and notes mentioning the same ticket, is not settled.
- **Settings.** Where the data folder path, repository aliases and Azure DevOps organisation are configured.

## Later, not in the first version

- Fetching ticket titles from Azure DevOps and GitHub when a link is pasted, using existing `az` and `gh` logins.
- Importing existing OneNote pages, with a tag alias list to merge variants such as `ACME` and `AC-ME`.
- An explicit link from a note card to a task, so the note leaves with the task when it is done.
- A layout option that shows Todo and Backlog stacked instead of side by side.

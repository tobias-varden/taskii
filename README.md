# Taskii

A daily work log for Windows. Each day is one page with a task list and free-form notes. Each morning Taskii carries the page forward to a new day, so you don't copy it by hand. Past days are kept as they were, and nothing drops off until you let it go.

## Why

Taskii replaces a OneNote habit: one page per day, copied forward every morning, pruned after standup and filed by month by hand. Taskii keeps the useful parts (every past day preserved, nothing disappearing silently) and handles the chores itself.

- **The day is a snapshot.** Only today is editable. Past days are read-only and never change.
- **Everything carries forward.** Open tasks, recently finished tasks and note cards all move to the next day. Done tasks leave only after you've reported them at a standup.
- **Plain files are the truth.** Each day is a markdown file in a folder you choose, such as one OneDrive syncs. The files are still readable without Taskii.
- **No ceremony.** You create a task or a note by typing. There are no forms.

## Features

- **Todo and Backlog** columns of checkbox tasks, each with its own rich-text notes underneath. Tasks can be folded, reordered and moved between the two columns.
- **Tags.** The text before the first colon in a title (`ACME: Fix users with space in username`) becomes a tag, with autocomplete and filtering.
- **Blocked by.** Press Alt+B on a task to pick the task it is waiting for. When the blocker is checked off, the task is unblocked automatically.
- **Board.** Note cards and docked side notes for anything not tied to a task. Each card shows how long it has been unchanged, so stale notes stand out.
- **Images.** Paste screenshots into cards and task notes. Each image is stored once, named by a hash of its content.
- **Ticket links.** GitHub and Azure DevOps URLs become compact chips such as `widget-service#413` or `AB#4521`.
- **Standup mode.** Shows what's done, what you're working on and what's blocked since the last standup. *Finish standup* releases done tasks, and *Copy as text* copies the summary for chat.
- **Quick capture.** A global hotkey opens a small bar over whatever you're doing. Type a task and press Enter, and it goes into Todo without opening the main window.
- **Search** across every day. A task that lived for 48 days is one result, and you can page through its history to see how it changed.
- **Tray app.** Taskii runs as a single instance in the notification area and can start with Windows, so quick capture is always instant.
- **CLI.** `taskii-cli` reads your days from a terminal, with optional JSON output. It never writes to them.

## The day file

```markdown
# Todo

- [ ] ACME: Fix users with space in username ^t7k2
  Get stats 1 234 (~500 have space in the middle)
- [ ] Federation: Add Contoso Edu to our TEST environment ^a1b3 [blocked-by:: ^c9d0]
- [x] Dev: Switch all repos to the new agent pool ^q2w3 [done:: 2026-11-16T08:40]

# Backlog

- [ ] Portal infra: Use refresh tokens on PROD ^m4n5

# Notes

## 10:05 Sprint planning
Security fixes go out before the 24th.

### Edge cases
Email match must ignore case, username must not.
```

The data folder is laid out as `YYYY/MM/YYYY-MM-DD.md`, plus `assets/` for images and `standups/` for a snapshot of each finished standup. The `^id` at the end of a task line is hidden in the editor and links the task across days. The search index is a SQLite cache kept outside the synced folder, and it can be rebuilt from the files at any time.

## Shortcuts

| Keys | Action |
| --- | --- |
| Win+Shift+N | Quick capture (global) |
| Win+Shift+J | Open the main window (global) |
| `[]` then Space | Start a checkbox |
| Ctrl+Enter | Check or uncheck a task |
| Alt+Up / Alt+Down | Move a task |
| Alt+B | Set or change what a task is blocked by |
| Shift+Enter | New line in quick capture |

You can change the global hotkeys in `settings.json`.

## Building

You need Windows 10 1809 or later, the [.NET 10 SDK](https://dotnet.microsoft.com/download), Node.js and [pnpm](https://pnpm.io).

```bash
dotnet build Taskii.slnx
dotnet run --project src/Taskii.App
```

Building the app also runs `pnpm install` and `pnpm build` in `src/web` and copies the bundle beside `Taskii.exe`. The app is a plain unpackaged exe (no MSIX) with the Windows App SDK bundled.

### Tests

```bash
dotnet test                 # Core, Host and CLI tests
pnpm --dir src/web test     # Editor, markdown and rules tests
```

Both sides run the shared cases in `tests/rules/cases.json`, so the C# and TypeScript rules stay in agreement.

### Working on the UI

```bash
pnpm --dir src/web dev
```

This serves the front end on its own in a browser, at port 5199. A mock host stands in for the Windows shell and loads sample days, so you don't need the app running.

## Settings and environment

| | |
| --- | --- |
| `%LOCALAPPDATA%\Taskii\settings.json` | Data folder, window placement, hotkeys |
| `TASKII_HOME` | Moves the settings, log and cache folder, so a dev copy can run beside the real one |
| `TASKII_DATA` | Data folder for `taskii-cli` |

## Command line

```bash
taskii-cli today [--json]
taskii-cli search [<words>...] [--kind task|note] [--tag <tag>] [--state open|done] [--limit <n>] [--json]
```

`taskii-cli --help` shows the full list of options.

## Project layout

```
src/
  Taskii.App    WinUI 3 shell: windows, tray, hotkeys, WebView2
  Taskii.Host   Message bridge between the shell and the web UI, settings, live index
  Taskii.Core   Day files, carry-forward, standups, assets, SQLite search
  Taskii.Cli    Read-only command line
  web           TypeScript + TipTap front end (Vite)
tests/          xUnit projects and shared rule cases
docs/           Design notes
```

More detail is in [docs/design.md](docs/design.md).

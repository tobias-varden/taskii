# Typed requests for the host bridge, and tests for it

## Problem

The page and the shell talk through `HostBridge.HandleAsync(string type, JsonElement payload)`
in `src/Taskii.App/HostBridge.cs`. The TS side is typed: `Requests` in `src/web/src/host.ts`
maps every request to its payload and result. The C# side reads payloads by hand:

```csharp
var baseVersion = payload.GetProperty("baseVersion").GetString() ?? "";
var overwrite = payload.GetProperty("overwrite").GetBoolean();
```

Renaming a payload field in `host.ts` compiles on both sides and fails at runtime. Response
records (`DayDto`, `SearchResponse`, …) are shared C# types, but nothing checks them against
`types.ts` either; only a comment says they mirror each other.

HostBridge is also about 450 lines doing five jobs: routing, the search index's lifetime and
freshness, quick capture, standup, and data folder setup. None of it is tested. The test
projects can't easily reach it, because it lives in the WinUI app project. Untested logic
that matters:

- Saves are accepted only for the day last handed out as editable (`_editable`), so an edit
  made just before midnight still lands on the right day.
- prev/next navigation in `LoadDay`, including "next always gets back to today".
- `CaptureAsync`: flushing the page first, the `append` kind, marking the index stale.
- `FreshIndex`: how long the index is trusted between refreshes.

## Proposal

1. **One request record per message type**, for example
   `SaveDayRequest(string Date, string BaseVersion, bool Overwrite, DayContent Content)`,
   deserialized with `HostBridge.Json` in one place. Dispatch from a table of
   `type → handler`, not a switch that parses payloads.
2. **Move the bridge out of the WinUI project** into a plain library (say `Taskii.Host`),
   together with `SettingsStore` and `Log`, which it needs. What is really UI-bound stays
   behind interfaces the app implements: `IShell` (folder picker) already exists, so add one
   for opening links and the data folder (`Process.Start`).
3. **Split out the index's lifetime** (`FreshIndex`, `WarmIndex`, `_indexStale`) into its
   own small class, so the bridge is just routing and day logic.
4. **Add `tests/Taskii.Host.Tests`** covering the cases listed above, using a fake
   `TimeProvider` (the bridge already takes one) and a temp data folder.
5. **Protocol check** (cheap and worth it): a test that reads the request names out of the
   `Requests` interface in `host.ts` and asserts each one is handled by the bridge or by a
   window (`captureResize`, `captureClose`, `captureOpenMain`, `flushed`). A request added
   on one side only then fails the build.

## Done when

- `HandleAsync` no longer calls `GetProperty` on payloads.
- `Taskii.App` holds windows, tray, hotkeys and WebView plumbing only.
- The new test project covers the editable-day check, navigation, capture and index freshness.
- The protocol check test exists and passes.

## Notes

- Step 1 can land on its own, before any project is moved.
- `CaptureWindow.HandleAsync` reads `payload.GetProperty("height")` the same way; give it a
  request record too.

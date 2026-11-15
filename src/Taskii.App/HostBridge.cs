using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Taskii.Core.Days;
using Taskii.Core.Search;

namespace Taskii.App;

/// <summary>What the bridge needs from the window.</summary>
public interface IShell
{
    Task<string?> PickFolderAsync();
}

// The shapes exchanged with the page. They mirror src/web/src/types.ts.
public sealed record DayDto(
    string Date,
    bool Exists,
    string Version,
    bool Editable,
    string? CarriedFrom,
    string? Prev,
    string? Next,
    IReadOnlyList<TaskItem> Todo,
    IReadOnlyList<TaskItem> Backlog,
    IReadOnlyList<NoteCard> Notes);

public sealed record InitResult(string Today, string? DataFolder, string? SuggestedFolder, DayDto? Day, string AssetBase);

public sealed record AssetResult(string Path);

public sealed record FolderResult(string DataFolder, DayDto Day);

public sealed record SaveDayResult(string Status, string Version);

public sealed record PeekResult(string Today, string Version);

public sealed record CaptureTag(string Tag, int Open);

public sealed record CaptureTask(string Id, string Title, bool Backlog);

/// <summary>What the quick capture bar needs to know about today.</summary>
/// <param name="Ready">False until a data folder has been chosen.</param>
public sealed record CaptureContext(bool Ready, string AssetBase, IReadOnlyList<CaptureTag> Tags, IReadOnlyList<CaptureTask> Tasks);

/// <summary>The last standup that was finished. Both are null when there has been none.</summary>
/// <param name="Since">When it was finished, local time, written like the time on a done task: 2026-11-13T09:15.</param>
/// <param name="Baseline">The day as it was at that moment.</param>
public sealed record StandupDto(string? Since, DayContent? Baseline);

/// <summary>What a search found, and the tags there are to narrow it by.</summary>
public sealed record SearchResponse(IReadOnlyList<SearchHit> Hits, int Total, int Days, IReadOnlyList<string> Tags);

/// <summary>
/// Answers the page's requests: which day to show, and reading and writing day files.
/// </summary>
public sealed class HostBridge(SettingsStore settings, TimeProvider? time = null)
{
    /// <summary>The window that can show a folder picker.</summary>
    public IShell? Shell { get; set; }

    /// <summary>
    /// Called before the day is changed from outside the main page, so the page can write what
    /// it has pending first and the two never overwrite each other.
    /// </summary>
    public Func<Task>? BeforeOutsideEdit { get; set; }

    /// <summary>Called after such a change, so the main page can show it.</summary>
    public Action? AfterOutsideEdit { get; set; }

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    /// <summary>The host the page loads pasted images from. The window answers requests to it from the asset folder.</summary>
    public const string AssetHost = "assets.taskii.example";

    /// <summary>Pasted screenshots are small. This only stops something absurd from being read into memory.</summary>
    private const int MaxAssetBytes = 25 * 1024 * 1024;

    private const string DateFormat = "yyyy-MM-dd";
    private const string StampFormat = "yyyy-MM-dd'T'HH:mm";
    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private DayStore? _store;

    /// <summary>How long the search index is trusted before the day files are looked at again.</summary>
    private static readonly TimeSpan IndexFreshFor = TimeSpan.FromSeconds(3);

    private readonly Lock _indexGate = new();
    private SearchIndex? _index;
    private long _indexChecked;
    private volatile bool _indexStale = true;

    /// <summary>
    /// The day that was last handed out as editable. Saves are accepted for this day only. It
    /// is not simply "today": an edit made a second before midnight must still be saved to the
    /// day it was made on.
    /// </summary>
    private DateOnly? _editable;

    private DateOnly Today => DateOnly.FromDateTime(_time.GetLocalNow().DateTime);

    public async Task<object?> HandleAsync(string type, JsonElement payload)
    {
        switch (type)
        {
            case "init":
                return await Task.Run(Init);

            case "chooseFolder":
                return await ChooseFolderAsync(payload.GetProperty("useSuggested").GetBoolean());

            case "loadDay":
            {
                var date = ReadDate(payload);
                return await Task.Run(() => LoadDay(date));
            }

            case "listDays":
                return await Task.Run(() => Store.ListDays().Select(Format).ToList());

            case "saveDay":
            {
                var date = ReadDate(payload);
                var baseVersion = payload.GetProperty("baseVersion").GetString() ?? "";
                var overwrite = payload.GetProperty("overwrite").GetBoolean();
                var content = payload.GetProperty("content").Deserialize<DayContent>(Json) ?? DayContent.Empty;
                return await Task.Run(() => SaveDay(date, content, baseVersion, overwrite));
            }

            case "peek":
            {
                var date = ReadDate(payload);
                return await Task.Run(() => new PeekResult(Format(Today), Store.VersionOf(date, carry: date == _editable)));
            }

            case "saveAsset":
            {
                var mediaType = payload.GetProperty("mediaType").GetString() ?? "";
                var bytes = payload.GetProperty("data").GetBytesFromBase64();
                if (bytes.Length > MaxAssetBytes) throw new InvalidOperationException("That image is too large to paste.");
                var assets = new AssetStore(Store.Root);
                return await Task.Run(() => new AssetResult(assets.Save(bytes, mediaType)));
            }

            case "captureContext":
                return await Task.Run(BuildCaptureContext);

            case "capture":
            {
                var kind = payload.GetProperty("kind").GetString() ?? "";
                var title = payload.GetProperty("title").GetString() ?? "";
                var body = payload.GetProperty("body").GetString() ?? "";
                var taskId = payload.TryGetProperty("taskId", out var id) ? id.GetString() ?? "" : "";
                return await CaptureAsync(kind, title, body, taskId);
            }

            case "standup":
                return await Task.Run(LastStandup);

            case "finishStandup":
                return await Task.Run(FinishStandup);

            case "search":
            {
                var query = new SearchQuery
                {
                    Text = payload.GetProperty("text").GetString() ?? "",
                    Kind = payload.GetProperty("kind").GetString() switch { "task" => ItemKind.Task, "note" => ItemKind.Note, _ => null },
                    Tag = payload.GetProperty("tag").GetString(),
                    State = payload.GetProperty("state").GetString() switch { "open" => TaskState.Open, "done" => TaskState.Done, _ => TaskState.Any },
                };
                return await Task.Run(() => Search(query));
            }

            case "searchItem":
            {
                var key = payload.GetProperty("key").GetString() ?? "";
                return await Task.Run(() => FreshIndex().History(key));
            }

            case "openLink":
                OpenLink(payload.GetProperty("url").GetString());
                return null;

            case "openDataFolder":
                Process.Start(new ProcessStartInfo("explorer.exe") { ArgumentList = { Store.Root } });
                return null;

            default:
                throw new InvalidOperationException($"Unknown request '{type}'.");
        }
    }

    /// <summary>A pasted image by file name, with its media type. Null if there is no such image.</summary>
    public (byte[] Bytes, string MediaType)? ReadAsset(string name) =>
        _store is not null && new AssetStore(_store.Root).Read(name) is { } bytes ? (bytes, AssetStore.MediaTypeOf(name)) : null;

    public static void OpenLink(string? url)
    {
        // Only web links leave the app; a note must not be able to launch a program.
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
    }

    private static string AssetBase => $"https://{AssetHost}/";

    private DayStore Store => _store ?? throw new InvalidOperationException("No data folder has been chosen.");

    /// <summary>Opens the data folder from settings if that has not happened yet. False if there is none.</summary>
    private bool EnsureStore() =>
        _store is not null || (settings.Current.DataFolder is { Length: > 0 } folder && TryUse(folder));

    private SearchResponse Search(SearchQuery query)
    {
        var index = FreshIndex();
        // Nothing typed and no tag chosen is not a search yet; it would list everything there is.
        var results = string.IsNullOrWhiteSpace(query.Text) && string.IsNullOrWhiteSpace(query.Tag) ? SearchResults.None : index.Search(query);
        return new SearchResponse(results.Hits, results.Total, results.Days, index.Tags());
    }

    /// <summary>
    /// The index, caught up with the day files. They are only looked at again after a save
    /// from here, or once a few seconds have passed, so typing a query does not keep doing it.
    /// </summary>
    private SearchIndex FreshIndex()
    {
        var store = Store;
        lock (_indexGate)
        {
            if (_index is null)
            {
                _index = new SearchIndex(store, Path.Combine(SettingsStore.Home, "index.db"));
                _indexStale = true;
            }

            if (_indexStale || _time.GetElapsedTime(_indexChecked) > IndexFreshFor)
            {
                _indexStale = false;
                _index.Refresh();
                _indexChecked = _time.GetTimestamp();
            }

            return _index;
        }
    }

    /// <summary>Reads the day files into the index ahead of the first search, which can take a moment the very first time.</summary>
    private void WarmIndex() => Task.Run(() =>
    {
        try
        {
            FreshIndex();
        }
        catch (Exception e)
        {
            Log.Write("Could not build the search index", e);
        }
    });

    private CaptureContext BuildCaptureContext()
    {
        if (!EnsureStore()) return new CaptureContext(false, AssetBase, [], []);

        var day = Store.Load(Today, carry: true).File.Content;
        var open = day.Todo.Select(t => (Task: t, Backlog: false))
            .Concat(day.Backlog.Select(t => (Task: t, Backlog: true)))
            .Where(t => !t.Task.Done && t.Task.Id.Length > 0)
            .ToList();

        var tags = open
            .Select(t => TaskTags.Of(t.Task.Title))
            .OfType<string>()
            .GroupBy(tag => tag)
            .OrderByDescending(group => group.Count())
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .Select(group => new CaptureTag(group.Key, group.Count()))
            .ToList();

        return new CaptureContext(true, AssetBase, tags, [.. open.Select(t => new CaptureTask(t.Task.Id, t.Task.Title, t.Backlog))]);
    }

    /// <summary>Writes something typed into the quick capture bar to today.</summary>
    private async Task<bool> CaptureAsync(string kind, string title, string body, string taskId)
    {
        if (!EnsureStore()) throw new InvalidOperationException("Choose a data folder in Taskii first.");

        if (BeforeOutsideEdit is not null) await BeforeOutsideEdit();

        var today = Today;
        var changed = await Task.Run(() => Store.Update(today, day => kind switch
        {
            "todo" => DayEdits.AddTask(day, title, body),
            "backlog" => DayEdits.AddTask(day, title, body, toBacklog: true),
            "note" => DayEdits.AddNote(day, title, body),
            "append" when string.IsNullOrWhiteSpace(body) => null,
            "append" => DayEdits.AppendToTask(day, taskId, body) ?? throw new InvalidOperationException("That task is no longer in today's list."),
            _ => throw new InvalidOperationException($"Unknown capture kind '{kind}'."),
        }));

        _indexStale = true;
        AfterOutsideEdit?.Invoke();
        return changed;
    }

    private StandupDto LastStandup() =>
        Store.Standups.Latest() is { } last
            ? new StandupDto(last.At.ToString(StampFormat, CultureInfo.InvariantCulture), last.Content)
            : new StandupDto(null, null);

    /// <summary>
    /// Records that everything up to now has been reported. The page has written what it had
    /// pending before asking, so the day on disk is the day that was read out.
    /// </summary>
    private StandupDto FinishStandup()
    {
        var day = Store.Load(Today, carry: true);
        Store.Standups.Finish(_time.GetLocalNow().DateTime, day.File.Text);
        return LastStandup();
    }

    private InitResult Init()
    {
        var folder = settings.Current.DataFolder;
        if (!string.IsNullOrWhiteSpace(folder) && TryUse(folder))
        {
            return new InitResult(Format(Today), Store.Root, null, LoadDay(Today), AssetBase);
        }

        return new InitResult(Format(Today), null, SuggestedFolder(), null, AssetBase);
    }

    private async Task<FolderResult?> ChooseFolderAsync(bool useSuggested)
    {
        var folder = useSuggested ? SuggestedFolder() : Shell is null ? null : await Shell.PickFolderAsync();
        if (string.IsNullOrWhiteSpace(folder)) return null;

        if (!TryUse(folder)) throw new InvalidOperationException($"Taskii cannot use {folder}.");

        settings.Current.DataFolder = Store.Root;
        settings.Save();
        return new FolderResult(Store.Root, LoadDay(Today));
    }

    private bool TryUse(string folder)
    {
        try
        {
            Directory.CreateDirectory(folder);
            _store = new DayStore(folder);
            lock (_indexGate)
            {
                _index?.Dispose();
                _index = null;
            }

            WarmIndex();
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            Log.Write($"Cannot use data folder {folder}", e);
            return false;
        }
    }

    private static string SuggestedFolder()
    {
        var oneDrive = new[] { "OneDrive", "OneDriveConsumer", "OneDriveCommercial" }
            .Select(Environment.GetEnvironmentVariable)
            .FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && Directory.Exists(path));
        return Path.Combine(oneDrive ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Taskii");
    }

    private DayDto LoadDay(DateOnly date)
    {
        var today = Today;
        // Today starts as a continuation of the most recent day; past days are shown as they are.
        var editable = date == today;
        var snapshot = Store.Load(date, carry: editable);
        if (editable) _editable = date;

        // Navigation steps between days that exist, and can always get back to today.
        var days = Store.ListDays();
        DateOnly? prev = days.Where(d => d < date).Cast<DateOnly?>().LastOrDefault();
        DateOnly? next = days.Where(d => d > date && d <= today).Cast<DateOnly?>().FirstOrDefault();
        if (next is null && date < today) next = today;

        var content = snapshot.File.Content;
        return new DayDto(
            Format(date),
            snapshot.Exists,
            snapshot.Version,
            editable,
            snapshot.CarriedFrom is { } from ? Format(from) : null,
            prev is { } p ? Format(p) : null,
            next is { } n ? Format(n) : null,
            content.Todo,
            content.Backlog,
            content.Notes);
    }

    private SaveDayResult SaveDay(DateOnly date, DayContent content, string baseVersion, bool overwrite)
    {
        if (date != _editable) throw new InvalidOperationException("Past days are read-only.");

        var result = Store.Save(date, content, baseVersion, overwrite);
        if (result.Status == SaveStatus.Saved) _indexStale = true;
        return new SaveDayResult(result.Status.ToString().ToLowerInvariant(), result.Version);
    }

    private static DateOnly ReadDate(JsonElement payload) =>
        DateOnly.ParseExact(payload.GetProperty("date").GetString() ?? "", DateFormat, CultureInfo.InvariantCulture);

    private static string Format(DateOnly date) => date.ToString(DateFormat, CultureInfo.InvariantCulture);
}

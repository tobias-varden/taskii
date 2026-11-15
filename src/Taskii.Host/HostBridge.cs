using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Taskii.Core.Days;
using Taskii.Core.Search;

namespace Taskii.Host;

/// <summary>
/// Answers the page's requests: which day to show, and reading and writing day files.
/// </summary>
public sealed class HostBridge : IDisposable
{
    /// <summary>The host the page loads pasted images from. The window answers requests to it from the asset folder.</summary>
    public const string AssetHost = "assets.taskii.example";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    /// <summary>
    /// For payloads only: a field that is missing or null when it should not be is an error
    /// that names it, rather than a default that fails somewhere further on.
    /// </summary>
    private static readonly JsonSerializerOptions PayloadJson = new(Json)
    {
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true,
    };

    /// <summary>Pasted screenshots are small. This only stops something absurd from being read into memory.</summary>
    private const int MaxAssetBytes = 25 * 1024 * 1024;

    private const string DateFormat = "yyyy-MM-dd";
    private const string StampFormat = "yyyy-MM-dd'T'HH:mm";

    private readonly SettingsStore _settings;
    private readonly TimeProvider _time;
    private readonly Dictionary<string, Handler> _handlers = [];
    private DayStore? _store;
    private LiveIndex? _index;

    /// <summary>
    /// The day that was last handed out as editable. Saves are accepted for this day only. It
    /// is not simply "today": an edit made a second before midnight must still be saved to the
    /// day it was made on.
    /// </summary>
    private DateOnly? _editable;

    /// <param name="settings">Where the data folder is remembered. The search index is kept beside the settings.</param>
    /// <param name="time">The clock, which decides what today is.</param>
    public HostBridge(SettingsStore settings, TimeProvider? time = null)
    {
        _settings = settings;
        _time = time ?? TimeProvider.System;

        On("init", Init);
        OnAsync<ChooseFolderRequest>("chooseFolder", async r => await ChooseFolderAsync(r.UseSuggested));
        On<DayRequest>("loadDay", r => LoadDay(r.Date));
        On("listDays", () => Store.ListDays().Select(Format).ToList());
        On<SaveDayRequest>("saveDay", SaveDay);
        On<DayRequest>("peek", r => new PeekResult(Format(Today), Store.VersionOf(r.Date, carry: r.Date == _editable)));
        On<SaveAssetRequest>("saveAsset", SaveAsset);
        On("captureContext", BuildCaptureContext);
        OnAsync<CaptureRequest>("capture", async r => await CaptureAsync(r));
        On<DayRequest>("noteAges", r => NoteAges(r.Date));
        On("standup", LastStandup);
        On("finishStandup", FinishStandup);
        On<SearchRequest>("search", Search);
        On<SearchItemRequest>("searchItem", r => Index.Fresh().History(r.Key));
        On<OpenLinkRequest>("openLink", r =>
        {
            OpenLink(r.Url);
            return null;
        });
        On("openDataFolder", () =>
        {
            Shell?.OpenFolder(Store.Root);
            return null;
        });
    }

    /// <summary>The window that can show a folder picker, and open links and folders.</summary>
    public IShell? Shell { get; set; }

    /// <summary>
    /// Called before the day is changed from outside the main page, so the page can write what
    /// it has pending first and the two never overwrite each other.
    /// </summary>
    public Func<Task>? BeforeOutsideEdit { get; set; }

    /// <summary>Called after such a change, so the main page can show it.</summary>
    public Action? AfterOutsideEdit { get; set; }

    /// <summary>Every request the bridge answers, with its payload type, or null for none.</summary>
    public IReadOnlyDictionary<string, Type?> Requests => _handlers.ToDictionary(h => h.Key, h => h.Value.Payload);

    /// <summary>Completes when the index of the current data folder has been read for the first time.</summary>
    internal Task IndexWarmed { get; private set; } = Task.CompletedTask;

    private DateOnly Today => DateOnly.FromDateTime(_time.GetLocalNow().DateTime);

    private static string AssetBase => $"https://{AssetHost}/";

    private DayStore Store => _store ?? throw new InvalidOperationException("No data folder has been chosen.");

    private LiveIndex Index => _index ?? throw new InvalidOperationException("No data folder has been chosen.");

    public Task<object?> HandleAsync(string type, JsonElement payload) =>
        _handlers.TryGetValue(type, out var handler)
            ? handler.Run(payload)
            : throw new InvalidOperationException($"Unknown request '{type}'.");

    /// <summary>Reads the payload of a request into its record.</summary>
    public static T ReadPayload<T>(string type, JsonElement payload)
    {
        try
        {
            return payload.Deserialize<T>(PayloadJson) ?? throw new JsonException("There is no payload.");
        }
        catch (JsonException e)
        {
            throw new InvalidOperationException($"The '{type}' request is malformed: {e.Message}", e);
        }
    }

    /// <summary>A pasted image by file name, with its media type. Null if there is no such image.</summary>
    public (byte[] Bytes, string MediaType)? ReadAsset(string name) =>
        _store is not null && new AssetStore(_store.Root).Read(name) is { } bytes ? (bytes, AssetStore.MediaTypeOf(name)) : null;

    /// <summary>Opens a link from a page in the browser, if it is a web link.</summary>
    public void OpenLink(string? url)
    {
        // Only web links leave the app; a note must not be able to launch a program.
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
        {
            Shell?.OpenLink(uri);
        }
    }

    public void Dispose()
    {
        _index?.Dispose();
        _index = null;
    }

    private sealed record Handler(Type? Payload, Func<JsonElement, Task<object?>> Run);

    /// <summary>A request with no payload, worked out off the UI thread.</summary>
    private void On(string type, Func<object?> work) =>
        _handlers.Add(type, new(null, _ => Task.Run(work)));

    /// <summary>A request with a payload, worked out off the UI thread.</summary>
    private void On<T>(string type, Func<T, object?> work) =>
        _handlers.Add(type, new(typeof(T), payload =>
        {
            var request = ReadPayload<T>(type, payload);
            return Task.Run(() => work(request));
        }));

    /// <summary>A request with a payload that does its own waiting.</summary>
    private void OnAsync<T>(string type, Func<T, Task<object?>> work) =>
        _handlers.Add(type, new(typeof(T), payload => work(ReadPayload<T>(type, payload))));

    /// <summary>Opens the data folder from settings if that has not happened yet. False if there is none.</summary>
    private bool EnsureStore() =>
        _store is not null || (_settings.Current.DataFolder is { Length: > 0 } folder && TryUse(folder));

    private SearchResponse Search(SearchRequest request)
    {
        var index = Index.Fresh();
        var query = new SearchQuery { Text = request.Text, Kind = request.Kind, Tag = request.Tag, State = request.State };
        // Nothing typed and no tag chosen is not a search yet; it would list everything there is.
        var results = string.IsNullOrWhiteSpace(query.Text) && string.IsNullOrWhiteSpace(query.Tag) ? SearchResults.None : index.Search(query);
        return new SearchResponse(results.Hits, results.Total, results.Days, index.Tags());
    }

    private AssetResult SaveAsset(SaveAssetRequest request)
    {
        if (request.Data.Length > MaxAssetBytes) throw new InvalidOperationException("That image is too large to paste.");
        return new AssetResult(new AssetStore(Store.Root).Save(request.Data, request.MediaType));
    }

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
    private async Task<bool> CaptureAsync(CaptureRequest request)
    {
        if (!EnsureStore()) throw new InvalidOperationException("Choose a data folder in Taskii first.");

        if (BeforeOutsideEdit is not null) await BeforeOutsideEdit();

        var (kind, title, body, taskId) = request;
        var today = Today;
        var changed = await Task.Run(() => Store.Update(today, day => kind switch
        {
            CaptureKind.Todo => DayEdits.AddTask(day, title, body),
            CaptureKind.Backlog => DayEdits.AddTask(day, title, body, toBacklog: true),
            CaptureKind.Note => DayEdits.AddNote(day, title, body),
            CaptureKind.Append when string.IsNullOrWhiteSpace(body) => null,
            CaptureKind.Append => DayEdits.AppendToTask(day, taskId, body) ?? throw new InvalidOperationException("That task is no longer in today's list."),
            _ => throw new InvalidOperationException($"Unknown capture kind '{kind}'."),
        }));

        Index.MarkStale();
        AfterOutsideEdit?.Invoke();
        return changed;
    }

    /// <summary>
    /// How long each card and side note of a day has been left alone. Asked for after the day
    /// is on screen, because the very first time the index has every day file to read.
    /// </summary>
    private List<NoteAgeDto> NoteAges(DateOnly date)
    {
        var notes = Store.Load(date, carry: date == Today).File.Content.Notes;
        var since = Index.Fresh().NotesSince(notes, date);

        var ages = new List<NoteAgeDto>();
        for (var i = 0; i < notes.Count; i++)
        {
            ages.Add(new NoteAgeDto(notes[i].Heading, notes[i].Body, Format(since[i].Card)));
            for (var s = 0; s < notes[i].Sides.Count; s++)
            {
                // A side note says so in its heading, as the file does, so it is never taken for a card with the same text.
                ages.Add(new NoteAgeDto("### " + notes[i].Sides[s].Heading, notes[i].Sides[s].Body, Format(since[i].Sides[s])));
            }
        }

        return ages;
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
        var folder = _settings.Current.DataFolder;
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

        _settings.Current.DataFolder = Store.Root;
        _settings.Save();
        return new FolderResult(Store.Root, LoadDay(Today));
    }

    private bool TryUse(string folder)
    {
        try
        {
            Directory.CreateDirectory(folder);
            var store = new DayStore(folder);
            _index?.Dispose();
            _store = store;
            _index = new LiveIndex(store, Path.Combine(_settings.Folder, "index.db"), _time);
            IndexWarmed = _index.WarmAsync();
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

    private SaveDayResult SaveDay(SaveDayRequest request)
    {
        if (request.Date != _editable) throw new InvalidOperationException("Past days are read-only.");

        var result = Store.Save(request.Date, request.Content, request.BaseVersion, request.Overwrite);
        if (result.Status == SaveStatus.Saved) Index.MarkStale();
        return new SaveDayResult(result.Status.ToString().ToLowerInvariant(), result.Version);
    }

    private static string Format(DateOnly date) => date.ToString(DateFormat, CultureInfo.InvariantCulture);
}

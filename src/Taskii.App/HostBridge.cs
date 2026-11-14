using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Taskii.Core.Days;

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

/// <summary>
/// Answers the page's requests: which day to show, and reading and writing day files.
/// </summary>
public sealed class HostBridge(SettingsStore settings, IShell shell, TimeProvider? time = null)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The host the page loads pasted images from. The window answers requests to it from the asset folder.</summary>
    public const string AssetHost = "assets.taskii.example";

    /// <summary>Pasted screenshots are small. This only stops something absurd from being read into memory.</summary>
    private const int MaxAssetBytes = 25 * 1024 * 1024;

    private const string DateFormat = "yyyy-MM-dd";
    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private DayStore? _store;

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
        var folder = useSuggested ? SuggestedFolder() : await shell.PickFolderAsync();
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
        return new SaveDayResult(result.Status.ToString().ToLowerInvariant(), result.Version);
    }

    private static DateOnly ReadDate(JsonElement payload) =>
        DateOnly.ParseExact(payload.GetProperty("date").GetString() ?? "", DateFormat, CultureInfo.InvariantCulture);

    private static string Format(DateOnly date) => date.ToString(DateFormat, CultureInfo.InvariantCulture);
}

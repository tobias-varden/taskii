using Taskii.Core.Days;
using Taskii.Core.Search;

namespace Taskii.Host;

// What the page sends and gets back. The names and shapes mirror the Requests interface in
// src/web/src/host.ts and the types in src/web/src/types.ts; ProtocolTests holds them to it.

// ---- Payloads ----

public sealed record ChooseFolderRequest(bool UseSuggested);

/// <summary>The payload of every request that is about one day: loadDay, peek, noteAges.</summary>
public sealed record DayRequest(DateOnly Date);

public sealed record SaveDayRequest(DateOnly Date, string BaseVersion, bool Overwrite, DayContent Content);

/// <param name="Data">The image, base64 on the wire.</param>
public sealed record SaveAssetRequest(string MediaType, byte[] Data);

public sealed record OpenLinkRequest(string Url);

public enum CaptureKind
{
    Todo,
    Backlog,
    Note,
    Append,
}

/// <param name="TaskId">The task to append to. Empty for every other kind.</param>
public sealed record CaptureRequest(CaptureKind Kind, string Title, string Body, string TaskId);

public sealed record SearchRequest(string Text, ItemKind? Kind, string? Tag, TaskState State);

public sealed record SearchItemRequest(string Key);

/// <summary>The capture page saying how tall its content is.</summary>
public sealed record CaptureResizeRequest(double Height);

// ---- Results ----

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

/// <summary>A note or side note as it is in the day file, and the first day it read like that.</summary>
public sealed record NoteAgeDto(string Heading, string Body, string Since);

/// <summary>What a search found, and the tags there are to narrow it by.</summary>
public sealed record SearchResponse(IReadOnlyList<SearchHit> Hits, int Total, int Days, IReadOnlyList<string> Tags);

/// <summary>Requests a window answers itself instead of passing them to the bridge.</summary>
public static class WindowRequests
{
    /// <summary>The page has written what it had pending, after a flush event.</summary>
    public const string Flushed = "flushed";

    public const string CaptureResize = "captureResize";
    public const string CaptureClose = "captureClose";
    public const string CaptureOpenMain = "captureOpenMain";

    /// <summary>Each of them, with its payload type, or null for none.</summary>
    public static IReadOnlyDictionary<string, Type?> All { get; } = new Dictionary<string, Type?>
    {
        [Flushed] = null,
        [CaptureResize] = typeof(CaptureResizeRequest),
        [CaptureClose] = null,
        [CaptureOpenMain] = null,
    };
}

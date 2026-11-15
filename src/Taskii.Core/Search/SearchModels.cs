using Taskii.Core.Days;

namespace Taskii.Core.Search;

public enum ItemKind
{
    Task,
    Note,
}

public enum TaskState
{
    Any,
    Open,
    Done,
}

public sealed record SearchQuery
{
    /// <summary>What was typed. Every word must be found, as the start of a word in the item.</summary>
    public string Text { get; init; } = "";

    /// <summary>Only tasks, or only notes.</summary>
    public ItemKind? Kind { get; init; }

    /// <summary>Only tasks with this tag.</summary>
    public string? Tag { get; init; }

    /// <summary>Only tasks that are open, or done, on the last day they appear. Leaves notes out.</summary>
    public TaskState State { get; init; }

    public int Limit { get; init; } = 200;
}

/// <summary>
/// One task or note, however many days it lived on.
/// </summary>
/// <param name="Key">Identifies the item across days. Pass it to <see cref="SearchIndex.History"/>.</param>
/// <param name="Title">The task's title or the note's heading, as markdown, on the latest day it matched.</param>
/// <param name="Body">The rest of its text on that day. For a note this includes its side notes.</param>
/// <param name="Done">Whether a task was done on the last day it appears.</param>
/// <param name="First">The first day it appears on.</param>
/// <param name="Last">The last day it appears on.</param>
/// <param name="Days">How many days it appears on.</param>
public sealed record SearchHit(
    string Key,
    ItemKind Kind,
    string Title,
    string Body,
    string? Tag,
    bool Done,
    DateOnly First,
    DateOnly Last,
    int Days);

/// <param name="Hits">Newest first.</param>
/// <param name="Total">How many items matched, which is more than <paramref name="Hits"/> holds when the limit cut it short.</param>
/// <param name="Days">How many different days the matching items appear on.</param>
public sealed record SearchResults(IReadOnlyList<SearchHit> Hits, int Total, int Days)
{
    public static SearchResults None { get; } = new([], 0, 0);
}

/// <summary>An item as it was on one or more days. Exactly one of <see cref="Task"/> and <see cref="Note"/> is set.</summary>
/// <param name="Section">"todo" or "backlog" for a task, "notes" for a note.</param>
public sealed record ItemVersion(string Section, TaskItem? Task, NoteCard? Note);

/// <param name="Version">Index into <see cref="ItemHistory.Versions"/>.</param>
public sealed record ItemDay(DateOnly Date, int Version);

public enum Relation
{
    /// <summary>The task that must be finished before this one.</summary>
    BlockedBy,

    /// <summary>A task that is waiting for this one.</summary>
    Blocks,

    /// <summary>A task or note that mentions the same ticket.</summary>
    Ticket,
}

/// <summary>Something that has to do with an item.</summary>
/// <param name="Key">The related item. Pass it to <see cref="SearchIndex.History"/>.</param>
/// <param name="Title">Its title or heading on <paramref name="Date"/>. Markdown.</param>
/// <param name="Date">The last day it appears on, or for a shared ticket the last day it mentioned it.</param>
/// <param name="Ticket">The ticket both mention, such as <c>AB#4521</c> or <c>widget-service#413</c>.</param>
public sealed record RelatedItem(string Key, ItemKind Kind, Relation Relation, string Title, bool Done, DateOnly Date, string? Ticket);

/// <summary>Every day an item appears on, oldest first, and what it looked like on each.</summary>
/// <param name="Related">For each of <paramref name="Versions"/>, what the item was related to in that state.</param>
public sealed record ItemHistory(
    string Key,
    ItemKind Kind,
    IReadOnlyList<ItemDay> Days,
    IReadOnlyList<ItemVersion> Versions,
    IReadOnlyList<IReadOnlyList<RelatedItem>> Related);

/// <summary>The first day a card, and each of its side notes, appears with the text it has now.</summary>
public sealed record NoteSince(DateOnly Card, IReadOnlyList<DateOnly> Sides);

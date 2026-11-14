namespace Taskii.Core.Days;

/// <summary>An inline field on a task's title line, written as <c>[key:: value]</c>.</summary>
public sealed record TaskField(string Key, string Value);

/// <summary>A checkbox in Todo or Backlog. <see cref="Title"/> and <see cref="Body"/> are markdown.</summary>
public sealed record TaskItem
{
    /// <summary>Stable ID that links the task across days. Written as <c>^id</c> at the end of the title line.</summary>
    public string Id { get; init; } = "";
    public bool Done { get; init; }
    public string Title { get; init; } = "";
    public IReadOnlyList<TaskField> Fields { get; init; } = [];

    /// <summary>The notes under the task, without the two-space indentation they have in the file.</summary>
    public string Body { get; init; } = "";
}

/// <summary>A note docked to a card. Written as a <c>###</c> heading under its parent.</summary>
public sealed record SideNote
{
    public string Heading { get; init; } = "";
    public string Body { get; init; } = "";
}

/// <summary>A free-form note on the board. Written as a <c>##</c> heading and what follows it.</summary>
public sealed record NoteCard
{
    public string Heading { get; init; } = "";
    public string Body { get; init; } = "";
    public IReadOnlyList<SideNote> Sides { get; init; } = [];
}

/// <summary>Everything Taskii understands in one day file.</summary>
public sealed record DayContent
{
    public IReadOnlyList<TaskItem> Todo { get; init; } = [];
    public IReadOnlyList<TaskItem> Backlog { get; init; } = [];
    public IReadOnlyList<NoteCard> Notes { get; init; } = [];

    public static DayContent Empty { get; } = new();

    public bool IsEmpty => Todo.Count == 0 && Backlog.Count == 0 && Notes.Count == 0;
}

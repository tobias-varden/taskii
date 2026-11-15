using System.Globalization;

namespace Taskii.Core.Days;

/// <summary>
/// The inline fields Taskii itself writes on a task, and what they say. The same rules as the
/// page's task.ts; the cases both are tested on are in tests/rules/cases.json.
/// </summary>
public static class TaskFields
{
    /// <summary>When the task was checked off, local time: <c>[done:: 2026-11-16T08:40]</c>.</summary>
    public const string Done = "done";

    /// <summary>The ID of the open task this one waits for: <c>[blocked-by:: ^c9d0]</c>.</summary>
    public const string BlockedBy = "blocked-by";

    private static readonly string[] StampFormats = ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"];

    /// <summary>When the task was checked off, if it says. Local time.</summary>
    public static DateTime? DoneAt(TaskItem task)
    {
        var stamp = task.Fields.LastOrDefault(field => field.Key == Done)?.Value;
        return DateTime.TryParseExact(stamp, StampFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at) ? at : null;
    }

    /// <summary>The IDs of every task this one says to wait for.</summary>
    public static IEnumerable<string> BlockersOf(TaskItem task) =>
        task.Fields
            .Where(field => field.Key == BlockedBy)
            .Select(field => field.Value.TrimStart('^'))
            .Where(id => id.Length > 0);
}

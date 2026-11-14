using System.Globalization;

namespace Taskii.Core.Days;

/// <summary>
/// What travels from one day to the next: every open task, every note, and every done task
/// that has not been reported at a standup yet. Nothing else is ever left behind.
/// </summary>
public static class DayCarry
{
    private static readonly string[] StampFormats = ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"];

    /// <param name="source">The most recent day.</param>
    /// <param name="lastStandup">
    /// When the last standup was finished, in local time. Done tasks completed before it stay
    /// behind. Null when no standup has been finished, in which case everything carries.
    /// </param>
    public static DayContent Forward(DayContent source, DateTime? lastStandup = null)
    {
        if (lastStandup is not { } standup) return source;

        return source with
        {
            Todo = [.. source.Todo.Where(task => !WasReported(task, standup))],
            Backlog = [.. source.Backlog.Where(task => !WasReported(task, standup))],
        };
    }

    /// <summary>When the task was checked off, if it says. Local time.</summary>
    public static DateTime? DoneAt(TaskItem task)
    {
        var stamp = task.Fields.LastOrDefault(field => field.Key == "done")?.Value;
        return DateTime.TryParseExact(stamp, StampFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at) ? at : null;
    }

    // A done task with no readable time cannot be shown to have been reported, so it stays.
    private static bool WasReported(TaskItem task, DateTime standup) => task.Done && DoneAt(task) is { } at && at < standup;
}

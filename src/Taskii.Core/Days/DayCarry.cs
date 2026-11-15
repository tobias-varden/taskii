namespace Taskii.Core.Days;

/// <summary>
/// What travels from one day to the next: every open task, every note, and every done task
/// that has not been reported at a standup yet. Nothing else is ever left behind.
/// </summary>
public static class DayCarry
{
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

    // A done task with no readable time cannot be shown to have been reported, so it stays.
    private static bool WasReported(TaskItem task, DateTime standup) => task.Done && TaskFields.DoneAt(task) is { } at && at < standup;
}

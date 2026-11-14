using System.Security.Cryptography;

namespace Taskii.Core.Days;

/// <summary>New task IDs. Six characters, lower case letters and digits.</summary>
public static class TaskIds
{
    private const string Alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    private const int Length = 6;

    public static string New(IEnumerable<string> taken)
    {
        var used = taken as ISet<string> ?? new HashSet<string>(taken, StringComparer.Ordinal);
        while (true)
        {
            var id = string.Create(Length, 0, static (span, _) =>
            {
                foreach (ref var c in span) c = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
            });
            if (!used.Contains(id)) return id;
        }
    }
}

/// <summary>
/// Changes made to a day from outside the editor, such as quick capture. Each returns the
/// new content, or null when there is nothing to change.
/// </summary>
public static class DayEdits
{
    /// <summary>Adds a task: at the end of Todo, or at the top of the backlog.</summary>
    public static DayContent? AddTask(DayContent day, string title, string body, bool toBacklog = false)
    {
        title = DayFormat.OneLine(title);
        body = DayFormat.NormalizeBody(body);
        if (title.Length == 0 && body.Length == 0) return null;

        var task = new TaskItem
        {
            Id = TaskIds.New(day.Todo.Concat(day.Backlog).Select(t => t.Id)),
            Title = title,
            Body = body,
        };

        return toBacklog
            ? day with { Backlog = [task, .. day.Backlog] }
            : day with { Todo = [.. day.Todo, task] };
    }

    /// <summary>Adds a note card at the end of the board.</summary>
    public static DayContent? AddNote(DayContent day, string heading, string body)
    {
        heading = DayFormat.OneLine(heading);
        body = DayFormat.NormalizeBody(body);
        if (heading.Length == 0 && body.Length == 0) return null;

        return day with { Notes = [.. day.Notes, new NoteCard { Heading = heading, Body = body }] };
    }

    /// <summary>Appends lines to the notes under a task. Null if the task is not in this day.</summary>
    public static DayContent? AppendToTask(DayContent day, string taskId, string text)
    {
        text = DayFormat.NormalizeBody(text);
        if (text.Length == 0) return null;

        TaskItem Append(TaskItem task) =>
            task.Id == taskId ? task with { Body = task.Body.Length == 0 ? text : task.Body + "\n" + text } : task;

        if (!day.Todo.Concat(day.Backlog).Any(t => t.Id == taskId)) return null;
        return day with { Todo = [.. day.Todo.Select(Append)], Backlog = [.. day.Backlog.Select(Append)] };
    }
}

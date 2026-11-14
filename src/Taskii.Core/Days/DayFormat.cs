using System.Text;

namespace Taskii.Core.Days;

/// <summary>
/// The canonical text of each item in a day file. Used to write new or edited items, and as
/// the key that decides whether an item is unchanged and can keep its original text.
/// </summary>
internal static class DayFormat
{
    public const string TaskIndent = "  ";

    public static string Task(TaskItem task)
    {
        var sb = new StringBuilder("- [").Append(task.Done ? 'x' : ' ').Append(']');

        var title = OneLine(task.Title);
        if (title.Length > 0) sb.Append(' ').Append(title);
        if (task.Id.Length > 0) sb.Append(" ^").Append(task.Id);
        foreach (var field in task.Fields)
        {
            sb.Append(" [").Append(field.Key).Append(":: ").Append(OneLine(field.Value).Replace("]", "")).Append(']');
        }

        var body = NormalizeBody(task.Body);
        if (body.Length > 0)
        {
            foreach (var line in body.Split('\n'))
            {
                sb.Append('\n');
                if (line.Length > 0) sb.Append(TaskIndent).Append(line);
            }
        }

        return sb.ToString();
    }

    public static string Card(NoteCard card) => Note("##", card.Heading, card.Body);

    public static string Side(SideNote side) => Note("###", side.Heading, side.Body);

    private static string Note(string marker, string heading, string body)
    {
        var sb = new StringBuilder(marker);
        var title = OneLine(heading);
        if (title.Length > 0) sb.Append(' ').Append(title);

        var text = NormalizeBody(body);
        if (text.Length > 0)
        {
            var inFence = false;
            foreach (var line in text.Split('\n'))
            {
                sb.Append('\n');
                // A body line that looks like a heading would split the card when read back.
                if (!inFence && LooksLikeHeading(line)) sb.Append('\\');
                if (IsFence(line)) inFence = !inFence;
                sb.Append(line);
            }
        }

        return sb.ToString();
    }

    /// <summary>Unix newlines, whitespace-only lines emptied, blank lines trimmed from both ends.</summary>
    public static string NormalizeBody(string? body)
    {
        if (string.IsNullOrEmpty(body)) return "";

        var lines = body.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        var first = 0;
        var last = lines.Length - 1;
        while (first <= last && IsBlank(lines[first])) first++;
        while (last >= first && IsBlank(lines[last])) last--;
        if (first > last) return "";

        var sb = new StringBuilder();
        for (var i = first; i <= last; i++)
        {
            if (i > first) sb.Append('\n');
            if (!IsBlank(lines[i])) sb.Append(lines[i].TrimEnd());
        }

        return sb.ToString();
    }

    public static string OneLine(string? text) =>
        string.IsNullOrEmpty(text) ? "" : text.Replace("\r\n", " ").Replace('\r', ' ').Replace('\n', ' ').Trim();

    public static bool IsBlank(string line) => string.IsNullOrWhiteSpace(line);

    public static bool IsFence(string line) => line.AsSpan().TrimStart().StartsWith("```");

    private static bool LooksLikeHeading(string line)
    {
        var hashes = 0;
        while (hashes < line.Length && line[hashes] == '#') hashes++;
        return hashes is >= 1 and <= 3 && (hashes == line.Length || line[hashes] is ' ' or '\t');
    }
}

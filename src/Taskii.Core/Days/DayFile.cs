using System.Text.RegularExpressions;

namespace Taskii.Core.Days;

/// <summary>
/// One day's markdown file, parsed.
/// <para>
/// The file belongs to the user as much as to Taskii, so writing is conservative: when nothing
/// has changed the original text is returned untouched, and when something has, every item that
/// was not edited keeps the exact text it had. Content Taskii does not understand (text before
/// the first section, extra sections) is carried along verbatim.
/// </para>
/// </summary>
public sealed partial class DayFile
{
    private readonly IReadOnlyDictionary<string, string> _originals;
    private readonly string _preamble;
    private readonly IReadOnlyList<string> _otherSections;
    private readonly string _newLine;
    private readonly bool _byteOrderMark;

    private DayFile(
        string text,
        DayContent content,
        IReadOnlyDictionary<string, string> originals,
        string preamble,
        IReadOnlyList<string> otherSections,
        string newLine,
        bool byteOrderMark)
    {
        Text = text;
        Content = content;
        _originals = originals;
        _preamble = preamble;
        _otherSections = otherSections;
        _newLine = newLine;
        _byteOrderMark = byteOrderMark;
    }

    /// <summary>The text this was parsed from.</summary>
    public string Text { get; }

    public DayContent Content { get; }

    public static DayFile Empty { get; } = Parse("");

    public static DayFile Parse(string text)
    {
        var byteOrderMark = text.Length > 0 && text[0] == (char)0xFEFF;
        var source = byteOrderMark ? text[1..] : text;
        var newLine = source.Contains("\r\n") ? "\r\n" : "\n";
        var lines = source.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');

        var preamble = new List<string>();
        var sections = new List<(string Heading, List<string> Lines)>();
        var current = preamble;
        var inFence = false;
        foreach (var line in lines)
        {
            if (!inFence && line.StartsWith("# ", StringComparison.Ordinal))
            {
                current = [];
                sections.Add((line, current));
                continue;
            }

            if (DayFormat.IsFence(line)) inFence = !inFence;
            current.Add(line);
        }

        var todo = new List<TaskItem>();
        var backlog = new List<TaskItem>();
        var notes = new List<NoteCard>();
        var others = new List<string>();
        var originals = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var (heading, sectionLines) in sections)
        {
            switch (heading[2..].Trim().ToLowerInvariant())
            {
                case "todo": ParseTasks(sectionLines, todo, originals); break;
                case "backlog": ParseTasks(sectionLines, backlog, originals); break;
                case "notes": ParseNotes(sectionLines, notes, originals); break;
                default: others.Add(JoinTrimmed(sectionLines.Prepend(heading))); break;
            }
        }

        var content = new DayContent { Todo = todo, Backlog = backlog, Notes = notes };
        return new DayFile(text, content, originals, JoinTrimmed(preamble), others, newLine, byteOrderMark);
    }

    /// <summary>
    /// The file text for <paramref name="content"/>. Returns <see cref="Text"/> itself when the
    /// content is what this file already holds.
    /// </summary>
    public string Write(DayContent content)
    {
        if (Render(content, null) == Render(Content, null)) return Text;

        var blocks = new List<string>();
        if (_preamble.Length > 0) blocks.Add(_preamble);
        blocks.Add(Render(content, _originals));
        blocks.AddRange(_otherSections);

        var text = string.Join("\n\n", blocks) + "\n";
        if (_newLine != "\n") text = text.Replace("\n", _newLine);
        return _byteOrderMark ? (char)0xFEFF + text : text;
    }

    private static string Render(DayContent content, IReadOnlyDictionary<string, string>? originals)
    {
        string Keep(string canonical) =>
            originals is not null && originals.TryGetValue(canonical, out var original) ? original : canonical;

        var blocks = new List<string>();

        blocks.Add("# Todo");
        if (content.Todo.Count > 0) blocks.Add(string.Join('\n', content.Todo.Select(t => Keep(DayFormat.Task(t)))));

        blocks.Add("# Backlog");
        if (content.Backlog.Count > 0) blocks.Add(string.Join('\n', content.Backlog.Select(t => Keep(DayFormat.Task(t)))));

        blocks.Add("# Notes");
        foreach (var card in content.Notes)
        {
            blocks.Add(Keep(DayFormat.Card(card)));
            foreach (var side in card.Sides) blocks.Add(Keep(DayFormat.Side(side)));
        }

        return string.Join("\n\n", blocks);
    }

    private static void ParseTasks(List<string> lines, List<TaskItem> into, Dictionary<string, string> originals)
    {
        var i = 0;
        while (i < lines.Count)
        {
            if (DayFormat.IsBlank(lines[i]))
            {
                i++;
                continue;
            }

            // Any top-level line starts an item. One that is not a checkbox is still kept as a
            // task, so a line typed into the section by hand is never dropped.
            var first = lines[i++];
            var body = new List<string>();
            var inFence = false;
            while (i < lines.Count)
            {
                var line = lines[i];
                var indented = line.Length > 0 && line[0] is ' ' or '\t';
                if (!inFence && !indented && !DayFormat.IsBlank(line)) break;
                if (DayFormat.IsFence(line)) inFence = !inFence;
                body.Add(line);
                i++;
            }

            while (body.Count > 0 && DayFormat.IsBlank(body[^1])) body.RemoveAt(body.Count - 1);

            var task = ParseTaskLine(first) with
            {
                Body = DayFormat.NormalizeBody(string.Join('\n', body.Select(Dedent))),
            };
            into.Add(task);
            originals.TryAdd(DayFormat.Task(task), string.Join('\n', body.Prepend(first)));
        }
    }

    internal static TaskItem ParseTaskLine(string line)
    {
        var done = false;
        string rest;

        var checkbox = CheckboxLine().Match(line);
        if (checkbox.Success)
        {
            done = checkbox.Groups[1].Value is "x" or "X";
            rest = checkbox.Groups[2].Value;
        }
        else
        {
            rest = line.TrimStart();
            if (rest.StartsWith("- ", StringComparison.Ordinal) || rest.StartsWith("* ", StringComparison.Ordinal)) rest = rest[2..];
        }

        rest = rest.TrimEnd();

        var fields = new List<TaskField>();
        while (TrailingField().Match(rest) is { Success: true } field)
        {
            fields.Insert(0, new TaskField(field.Groups[1].Value, field.Groups[2].Value.Trim()));
            rest = rest[..field.Index];
        }

        var id = "";
        if (TrailingId().Match(rest) is { Success: true } idMatch)
        {
            id = idMatch.Groups[1].Value;
            rest = rest[..idMatch.Index];
        }

        return new TaskItem { Id = id, Done = done, Title = rest.Trim(), Fields = fields };
    }

    private static void ParseNotes(List<string> lines, List<NoteCard> into, Dictionary<string, string> originals)
    {
        var cards = new List<(NotePart Main, List<NotePart> Sides)>();
        NotePart? current = null;
        var inFence = false;

        foreach (var line in lines)
        {
            if (!inFence)
            {
                var side = SideHeading().Match(line);
                if (side.Success && cards.Count > 0)
                {
                    current = new NotePart(line, side.Groups[1].Value.Trim());
                    cards[^1].Sides.Add(current);
                    continue;
                }

                // A side note with no card above it has nothing to dock to, so it is a card.
                var card = side.Success ? side : CardHeading().Match(line);
                if (card.Success)
                {
                    current = new NotePart(line, card.Groups[1].Value.Trim());
                    cards.Add((current, []));
                    continue;
                }
            }

            if (DayFormat.IsFence(line)) inFence = !inFence;

            if (current is null)
            {
                if (DayFormat.IsBlank(line)) continue;
                current = new NotePart(null, "");
                cards.Add((current, []));
            }

            current.Lines.Add(line);
        }

        foreach (var (main, sides) in cards)
        {
            var sideNotes = new List<SideNote>();
            foreach (var part in sides)
            {
                var side = new SideNote { Heading = part.Heading, Body = part.Body };
                sideNotes.Add(side);
                originals.TryAdd(DayFormat.Side(side), part.Original);
            }

            var card = new NoteCard { Heading = main.Heading, Body = main.Body, Sides = sideNotes };
            into.Add(card);

            // Text with no heading can only keep its original form as the very first thing in
            // the section; anywhere else it would merge into the card above. It gets a heading
            // the first time the file is rewritten instead.
            if (main.HeadingLine is not null) originals.TryAdd(DayFormat.Card(card), main.Original);
        }
    }

    private static string Dedent(string line)
    {
        if (line.StartsWith(DayFormat.TaskIndent, StringComparison.Ordinal)) return line[2..];
        if (line.Length > 0 && line[0] is ' ' or '\t') return line[1..];
        return line;
    }

    private static string JoinTrimmed(IEnumerable<string> lines)
    {
        var list = lines.ToList();
        while (list.Count > 0 && DayFormat.IsBlank(list[^1])) list.RemoveAt(list.Count - 1);
        while (list.Count > 0 && DayFormat.IsBlank(list[0])) list.RemoveAt(0);
        return string.Join('\n', list);
    }

    private sealed class NotePart(string? headingLine, string heading)
    {
        public string? HeadingLine { get; } = headingLine;
        public string Heading { get; } = heading;
        public List<string> Lines { get; } = [];

        public string Body => DayFormat.NormalizeBody(string.Join('\n', Lines));

        public string Original
        {
            get
            {
                var lines = Lines.ToList();
                while (lines.Count > 0 && DayFormat.IsBlank(lines[^1])) lines.RemoveAt(lines.Count - 1);
                return string.Join('\n', HeadingLine is null ? lines : lines.Prepend(HeadingLine));
            }
        }
    }

    [GeneratedRegex(@"^[-*] \[([ xX])\](?:[ \t]+(.*))?$")]
    private static partial Regex CheckboxLine();

    [GeneratedRegex(@"\s*\[([A-Za-z][A-Za-z0-9_-]*)::[ \t]*([^\[\]]*)\]$")]
    private static partial Regex TrailingField();

    [GeneratedRegex(@"(?:^|\s+)\^([A-Za-z0-9]+)$")]
    private static partial Regex TrailingId();

    [GeneratedRegex(@"^##(?:[ \t]+(.*))?$")]
    private static partial Regex CardHeading();

    [GeneratedRegex(@"^###(?:[ \t]+(.*))?$")]
    private static partial Regex SideHeading();
}

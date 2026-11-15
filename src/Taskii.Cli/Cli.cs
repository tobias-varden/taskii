using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Taskii.Core.Days;
using Taskii.Core.Search;

namespace Taskii.Cli;

/// <param name="Home">Where settings are read from and the search cache is kept.</param>
/// <param name="DataEnv">The TASKII_DATA environment variable.</param>
internal sealed record CliContext(TextWriter Out, TextWriter Error, string Home, DateOnly Today, string? DataEnv = null);

/// <summary>Reads the data folder. Never writes to it.</summary>
internal static class Cli
{
    private const string Usage = """
        taskii-cli: read your Taskii days from the command line. Never changes them.

        Usage:
          taskii-cli today [--json]
              Today's Todo, Backlog and Notes, as the app shows them.

          taskii-cli search [<words>...] [--kind task|note] [--tag <tag>] [--state open|done] [--limit <n>] [--json]
              Tasks and notes across all days, newest first. Every word must match the
              start of a word in the item. A task is one result however many days it lived.

        Options:
          --json          Machine-readable output.
          --data <path>   The data folder. Defaults to TASKII_DATA, then the folder the app uses.
          -h, --help      Show this.

        Exit codes: 0 ok, 1 error, 2 bad usage.
        """;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static int Run(string[] args, CliContext context)
    {
        Options options;
        try
        {
            options = Options.Parse(args);
        }
        catch (UsageException e)
        {
            context.Error.WriteLine($"taskii-cli: {e.Message}");
            context.Error.WriteLine("Run 'taskii-cli --help' for usage.");
            return 2;
        }

        if (options.Help || options.Command is null)
        {
            (options.Help ? context.Out : context.Error).WriteLine(Usage);
            return options.Help ? 0 : 2;
        }

        if (options.Command is not ("today" or "search"))
        {
            context.Error.WriteLine($"taskii-cli: unknown command '{options.Command}'.");
            context.Error.WriteLine("Run 'taskii-cli --help' for usage.");
            return 2;
        }

        try
        {
            if (DataFolder(options, context) is not { } folder) return 1;
            var store = new DayStore(folder);

            return options.Command == "today" ? Today(store, options, context) : Search(store, options, context);
        }
        catch (UsageException e)
        {
            context.Error.WriteLine($"taskii-cli: {e.Message}");
            return 2;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            context.Error.WriteLine($"taskii-cli: {e.Message}");
            return 1;
        }
    }

    private static string? DataFolder(Options options, CliContext context)
    {
        var folder = options.Data ?? (context.DataEnv is { Length: > 0 } env ? env : FromSettings(context.Home));
        if (folder is null)
        {
            context.Error.WriteLine("taskii-cli: no data folder. Choose one in Taskii, or pass --data <path>.");
            return null;
        }

        if (!Directory.Exists(folder))
        {
            context.Error.WriteLine($"taskii-cli: the data folder does not exist: {folder}");
            return null;
        }

        return folder;
    }

    /// <summary>The folder the app was told to use, from its settings file.</summary>
    private static string? FromSettings(string home)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(home, "settings.json")));
            return doc.RootElement.TryGetProperty("dataFolder", out var value) && value.GetString() is { Length: > 0 } folder ? folder : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException)
        {
            return null;
        }
    }

    // ---- today ----

    private static int Today(DayStore store, Options options, CliContext context)
    {
        options.NoPositionals();

        // Today starts as a continuation of the most recent day, exactly as the app shows it.
        var day = store.Load(context.Today, carry: true);
        var content = day.File.Content;

        if (options.Json)
        {
            context.Out.WriteLine(JsonSerializer.Serialize(
                new TodayDto(
                    Format(day.Date),
                    day.CarriedFrom is { } from ? Format(from) : null,
                    [.. content.Todo.Where(HasText).Select(TaskDto.From)],
                    [.. content.Backlog.Where(HasText).Select(TaskDto.From)],
                    [.. content.Notes.Select(NoteDto.From)]),
                Json));
            return 0;
        }

        var w = context.Out;
        w.Write($"Today {Format(day.Date)}");
        if (day.CarriedFrom is { } carried) w.Write($" (nothing written yet, carried from {Format(carried)})");
        w.WriteLine();

        WriteTasks(w, "Todo", content.Todo);
        WriteTasks(w, "Backlog", content.Backlog);

        w.WriteLine();
        w.WriteLine("# Notes");
        if (content.Notes.Count == 0) w.WriteLine("  (none)");
        foreach (var note in content.Notes)
        {
            w.WriteLine($"  ## {note.Heading}");
            WriteBody(w, note.Body, "     ");
            foreach (var side in note.Sides)
            {
                w.WriteLine($"     ### {side.Heading}");
                WriteBody(w, side.Body, "       ");
            }
        }

        return 0;
    }

    private static void WriteTasks(TextWriter w, string section, IReadOnlyList<TaskItem> tasks)
    {
        w.WriteLine();
        w.WriteLine($"# {section}");
        var shown = tasks.Where(HasText).ToList();
        if (shown.Count == 0) w.WriteLine("  (none)");
        foreach (var task in shown)
        {
            w.Write($"  [{(task.Done ? 'x' : ' ')}] {task.Title}");
            if (task.Id.Length > 0) w.Write($"  ^{task.Id}");
            foreach (var field in task.Fields) w.Write($"  [{field.Key}:: {field.Value}]");
            w.WriteLine();
            WriteBody(w, task.Body, "      ");
        }
    }

    private static void WriteBody(TextWriter w, string body, string indent)
    {
        if (body.Length == 0) return;
        foreach (var line in body.Split('\n')) w.WriteLine(line.Length == 0 ? "" : indent + line);
    }

    private static bool HasText(TaskItem task) => task.Title.Length > 0 || task.Body.Length > 0;

    // ---- search ----

    private static int Search(DayStore store, Options options, CliContext context)
    {
        var query = new SearchQuery
        {
            Text = string.Join(' ', options.Positionals),
            Kind = options.Kind,
            Tag = options.Tag,
            State = options.State,
            Limit = options.Limit,
        };

        // Its own cache, not the app's: the index starts over when it is opened for another
        // data folder, and this keeps the two from contending for one file.
        using var index = new SearchIndex(store, Path.Combine(context.Home, "cli-index.db"));
        index.Refresh();
        var results = index.Search(query);

        if (options.Json)
        {
            context.Out.WriteLine(JsonSerializer.Serialize(
                new SearchDto(results.Total, results.Days, [.. results.Hits.Select(HitDto.From)]),
                Json));
            return 0;
        }

        var w = context.Out;
        if (results.Total == 0)
        {
            w.WriteLine("No matches.");
            return 0;
        }

        w.WriteLine($"{results.Total} {(results.Total == 1 ? "match" : "matches")} on {results.Days} {(results.Days == 1 ? "day" : "days")}"
            + (results.Hits.Count < results.Total ? $", showing the newest {results.Hits.Count}" : ""));

        foreach (var hit in results.Hits)
        {
            w.WriteLine();
            var mark = hit.Kind == ItemKind.Note ? "note" : hit.Done ? "[x]" : "[ ]";
            w.WriteLine($"{mark} {hit.Title}");
            var span = hit.First == hit.Last ? Format(hit.First) : $"{Format(hit.First)} to {Format(hit.Last)}";
            w.WriteLine($"    {span}, {hit.Days} {(hit.Days == 1 ? "day" : "days")}  {hit.Key}");
            WriteBody(w, hit.Body, "    ");
        }

        return 0;
    }

    private static string Format(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    // ---- output shapes ----

    private sealed record TodayDto(string Date, string? CarriedFrom, IReadOnlyList<TaskDto> Todo, IReadOnlyList<TaskDto> Backlog, IReadOnlyList<NoteDto> Notes);

    private sealed record TaskDto(string Id, bool Done, string Title, string? Tag, IReadOnlyList<TaskField> Fields, string Body)
    {
        public static TaskDto From(TaskItem task) => new(task.Id, task.Done, task.Title, TaskTags.Of(task.Title), task.Fields, task.Body);
    }

    private sealed record NoteDto(string Heading, string Body, IReadOnlyList<SideNote> Sides)
    {
        public static NoteDto From(NoteCard note) => new(note.Heading, note.Body, note.Sides);
    }

    private sealed record SearchDto(int Total, int Days, IReadOnlyList<HitDto> Hits);

    private sealed record HitDto(string Key, ItemKind Kind, string Title, string? Tag, bool Done, string First, string Last, int Days, string Body)
    {
        public static HitDto From(SearchHit hit) =>
            new(hit.Key, hit.Kind, hit.Title, hit.Tag, hit.Done, Format(hit.First), Format(hit.Last), hit.Days, hit.Body);
    }

    // ---- arguments ----

    private sealed class UsageException(string message) : Exception(message);

    private sealed class Options
    {
        public string? Command { get; private set; }
        public List<string> Positionals { get; } = [];
        public bool Json { get; private set; }
        public bool Help { get; private set; }
        public string? Data { get; private set; }
        public ItemKind? Kind { get; private set; }
        public string? Tag { get; private set; }
        public TaskState State { get; private set; }
        public int Limit { get; private set; } = 50;

        public void NoPositionals()
        {
            if (Positionals.Count > 0) throw new UsageException($"'{Command}' takes no arguments, got '{Positionals[0]}'.");
        }

        public static Options Parse(string[] args)
        {
            var options = new Options();
            for (var i = 0; i < args.Length; i++)
            {
                var arg = args[i];
                string Value() => i + 1 < args.Length ? args[++i] : throw new UsageException($"{arg} needs a value.");

                switch (arg)
                {
                    case "-h" or "--help": options.Help = true; break;
                    case "--json": options.Json = true; break;
                    case "--data": options.Data = Value(); break;
                    case "--tag": options.Tag = Value(); break;
                    case "--kind":
                        options.Kind = Value() switch
                        {
                            "task" => ItemKind.Task,
                            "note" => ItemKind.Note,
                            var other => throw new UsageException($"--kind is 'task' or 'note', not '{other}'."),
                        };
                        break;
                    case "--state":
                        options.State = Value() switch
                        {
                            "open" => TaskState.Open,
                            "done" => TaskState.Done,
                            "any" => TaskState.Any,
                            var other => throw new UsageException($"--state is 'open', 'done' or 'any', not '{other}'."),
                        };
                        break;
                    case "--limit":
                        var limit = Value();
                        options.Limit = int.TryParse(limit, NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n > 0
                            ? n
                            : throw new UsageException($"--limit is a positive number, not '{limit}'.");
                        break;
                    case "--":
                        options.Positionals.AddRange(args[(i + 1)..]);
                        i = args.Length;
                        break;
                    default:
                        if (arg.StartsWith('-') && arg.Length > 1) throw new UsageException($"unknown option '{arg}'.");
                        if (options.Command is null) options.Command = arg;
                        else options.Positionals.Add(arg);
                        break;
                }
            }

            return options;
        }
    }
}

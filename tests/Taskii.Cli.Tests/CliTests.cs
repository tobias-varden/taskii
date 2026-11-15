using System.Text.Json;
using Taskii.Core.Days;

namespace Taskii.Cli.Tests;

public sealed class CliTests : IDisposable
{
    private static readonly DateOnly Fri = new(2026, 11, 13);
    private static readonly DateOnly Mon = new(2026, 11, 16);

    private static readonly TaskItem Spaces = new() { Id = "t7k2", Title = "ACME: Fix users with space in username", Body = "Repro in AB#4521" };
    private static readonly TaskItem Secret = new() { Id = "c9d0", Title = "Federation: Get client secret", Fields = [new("blocked-by", "^t7k2")] };
    private static readonly NoteCard Planning = new() { Heading = "Sprint planning", Body = "Check who owns the shared folder." };

    private readonly string _root = Path.Combine(Path.GetTempPath(), "taskii-cli-tests-" + Guid.NewGuid().ToString("N"));
    private readonly DayStore _store;

    public CliTests()
    {
        _store = new DayStore(Data);
        Directory.CreateDirectory(Data);
        Directory.CreateDirectory(Home);
    }

    private string Data => Path.Combine(_root, "data");
    private string Home => Path.Combine(_root, "home");

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    private void Put(DateOnly date, DayContent content)
    {
        var path = _store.PathFor(date);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, DayFile.Empty.Write(content));
    }

    private (int Code, string Out, string Error) RunWith(DateOnly today, string? dataEnv, params string[] args)
    {
        var stdout = new StringWriter();
        var stderr = new StringWriter();
        var code = Cli.Run(args, new CliContext(stdout, stderr, Home, today, dataEnv));
        return (code, stdout.ToString(), stderr.ToString());
    }

    private (int Code, string Out, string Error) Run(DateOnly today, params string[] args) => RunWith(today, null, [.. args, "--data", Data]);

    [Fact]
    public void Today_shows_tasks_and_notes_as_text()
    {
        Put(Mon, new DayContent { Todo = [Spaces], Backlog = [Secret], Notes = [Planning] });

        var (code, output, _) = Run(Mon, "today");

        Assert.Equal(0, code);
        Assert.Contains("Today 2026-11-16", output);
        Assert.Contains("[ ] ACME: Fix users with space in username  ^t7k2", output);
        Assert.Contains("      Repro in AB#4521", output);
        Assert.Contains("[blocked-by:: ^t7k2]", output);
        Assert.Contains("## Sprint planning", output);
    }

    [Fact]
    public void Today_without_a_file_is_carried_from_the_last_day_and_nothing_is_written()
    {
        Put(Fri, new DayContent { Todo = [Spaces] });

        var (code, output, _) = Run(Mon, "today", "--json");

        Assert.Equal(0, code);
        using var json = JsonDocument.Parse(output);
        Assert.Equal("2026-11-16", json.RootElement.GetProperty("date").GetString());
        Assert.Equal("2026-11-13", json.RootElement.GetProperty("carriedFrom").GetString());
        var task = json.RootElement.GetProperty("todo")[0];
        Assert.Equal("t7k2", task.GetProperty("id").GetString());
        Assert.Equal("ACME", task.GetProperty("tag").GetString());
        Assert.False(File.Exists(_store.PathFor(Mon)));
    }

    [Fact]
    public void Search_finds_a_task_once_across_the_days_it_lived()
    {
        Put(Fri, new DayContent { Todo = [Spaces] });
        Put(Mon, new DayContent { Todo = [Spaces with { Done = true }], Notes = [Planning] });

        var (code, output, _) = Run(Mon, "search", "fix", "space", "--json");

        Assert.Equal(0, code);
        using var json = JsonDocument.Parse(output);
        Assert.Equal(1, json.RootElement.GetProperty("total").GetInt32());
        var hit = json.RootElement.GetProperty("hits")[0];
        Assert.Equal("t:t7k2", hit.GetProperty("key").GetString());
        Assert.Equal("task", hit.GetProperty("kind").GetString());
        Assert.True(hit.GetProperty("done").GetBoolean());
        Assert.Equal("2026-11-13", hit.GetProperty("first").GetString());
        Assert.Equal(2, hit.GetProperty("days").GetInt32());
    }

    [Fact]
    public void Search_filters_by_kind_and_reports_no_matches()
    {
        Put(Mon, new DayContent { Todo = [Spaces], Notes = [Planning] });

        var notes = Run(Mon, "search", "--kind", "note");
        Assert.Contains("note Sprint planning", notes.Out);
        Assert.DoesNotContain("ACME", notes.Out);

        Assert.Contains("No matches.", Run(Mon, "search", "nothing-like-this").Out);
    }

    [Fact]
    public void The_data_folder_comes_from_the_app_settings_when_not_given()
    {
        Put(Mon, new DayContent { Todo = [Spaces] });
        File.WriteAllText(Path.Combine(Home, "settings.json"), JsonSerializer.Serialize(new { dataFolder = Data }));

        var (code, output, _) = RunWith(Mon, null, "today");

        Assert.Equal(0, code);
        Assert.Contains("ACME", output);
    }

    [Fact]
    public void No_data_folder_is_an_error()
    {
        var (code, _, error) = RunWith(Mon, null, "today");

        Assert.Equal(1, code);
        Assert.Contains("no data folder", error);
    }

    [Theory]
    [InlineData("frobnicate")]
    [InlineData("today", "--bogus")]
    [InlineData("search", "--kind", "card")]
    [InlineData("search", "--limit")]
    [InlineData("today", "extra")]
    [InlineData]
    public void Bad_usage_exits_with_2(params string[] args)
    {
        var (code, _, error) = Run(Mon, args);

        Assert.Equal(2, code);
        Assert.NotEmpty(error);
    }

    [Fact]
    public void Help_goes_to_stdout()
    {
        var (code, output, _) = RunWith(Mon, null, "--help");

        Assert.Equal(0, code);
        Assert.Contains("taskii-cli today", output);
    }
}

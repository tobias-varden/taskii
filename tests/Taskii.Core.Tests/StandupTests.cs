using Taskii.Core.Days;

namespace Taskii.Core.Tests;

public sealed class StandupTests : IDisposable
{
    private static readonly DateOnly Friday = new(2026, 11, 13);
    private static readonly DateOnly Monday = new(2026, 11, 16);
    private static readonly DateOnly Tuesday = new(2026, 11, 17);

    private const string FridayText = """
        # Todo
        - [x] done before friday's standup ^a [done:: 2026-11-13T08:00]
        - [x] done on friday afternoon ^b [done:: 2026-11-13T15:00]
        - [ ] still open ^c

        # Backlog

        # Notes

        """;

    private readonly string _root = Path.Combine(Path.GetTempPath(), "taskii-tests-" + Guid.NewGuid().ToString("N"));
    private readonly DayStore _store;

    public StandupTests()
    {
        _store = new DayStore(_root);
        Write(Friday, FridayText);
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void With_no_standup_finished_there_is_none_and_everything_carries()
    {
        Assert.Null(_store.Standups.Latest());
        Assert.Null(_store.Standups.LatestBefore(DateTime.MaxValue));
        Assert.Equal(3, _store.Load(Monday, carry: true).File.Content.Todo.Count);
    }

    [Fact]
    public void Finishing_a_standup_keeps_the_day_as_it_was_under_the_minute_it_happened()
    {
        var at = _store.Standups.Finish(new DateTime(2026, 11, 13, 9, 15, 42), FridayText);

        Assert.Equal(new DateTime(2026, 11, 13, 9, 15, 0), at);
        Assert.Equal(FridayText, File.ReadAllText(Path.Combine(_root, "standups", "2026-11-13T0915.md")));

        var latest = _store.Standups.Latest()!;
        Assert.Equal(at, latest.At);
        Assert.Equal(["a", "b", "c"], latest.Content.Todo.Select(t => t.Id));
    }

    [Fact]
    public void The_latest_standup_wins_and_conflict_copies_are_not_standups()
    {
        _store.Standups.Finish(new DateTime(2026, 11, 12, 9, 10, 0), "# Todo\n\n- [ ] thursday ^t\n");
        _store.Standups.Finish(new DateTime(2026, 11, 13, 9, 15, 0), FridayText);
        File.WriteAllText(Path.Combine(_store.Standups.Folder, "2026-11-14T0900-LAPTOP.md"), "# Todo\n");
        File.WriteAllText(Path.Combine(_store.Standups.Folder, "notes.md"), "not a standup");

        Assert.Equal(new DateTime(2026, 11, 13, 9, 15, 0), _store.Standups.Latest()!.At);
        Assert.Equal(new DateTime(2026, 11, 12, 9, 10, 0), _store.Standups.LatestBefore(new DateTime(2026, 11, 13, 9, 15, 0)));
    }

    [Fact]
    public void The_next_day_starts_without_the_done_tasks_that_were_reported()
    {
        _store.Standups.Finish(new DateTime(2026, 11, 13, 9, 15, 0), FridayText);

        var monday = _store.Load(Monday, carry: true);

        Assert.Equal(["done on friday afternoon", "still open"], monday.File.Content.Todo.Select(t => t.Title));
        // Friday itself is a past day and stays exactly as it was.
        Assert.Equal(FridayText, File.ReadAllText(_store.PathFor(Friday)));
    }

    [Fact]
    public void A_standup_takes_nothing_from_the_day_it_is_finished_on()
    {
        _store.Standups.Finish(new DateTime(2026, 11, 13, 9, 15, 0), FridayText);
        var before = _store.Load(Monday, carry: true);

        // Monday's standup reports friday afternoon's task. It stays in sight on Monday,
        // whether or not Monday has a file yet, and is gone on Tuesday.
        _store.Standups.Finish(new DateTime(2026, 11, 16, 9, 15, 0), before.File.Text);

        var after = _store.Load(Monday, carry: true);
        Assert.Equal(before.Version, after.Version);
        Assert.Equal(["done on friday afternoon", "still open"], after.File.Content.Todo.Select(t => t.Title));

        Assert.Equal(["still open"], _store.Load(Tuesday, carry: true).File.Content.Todo.Select(t => t.Title));

        var edited = after.File.Content with { Notes = [new NoteCard { Heading = "Monday" }] };
        Assert.Equal(SaveStatus.Saved, _store.Save(Monday, edited, after.Version).Status);
        Assert.Equal(["done on friday afternoon", "still open"], _store.Load(Monday).File.Content.Todo.Select(t => t.Title));
        Assert.Equal(["still open"], _store.Load(Tuesday, carry: true).File.Content.Todo.Select(t => t.Title));
    }

    [Fact]
    public void A_standup_arriving_by_sync_changes_the_version_of_a_day_not_yet_started()
    {
        var monday = _store.Load(Monday, carry: true);

        // Finished on the laptop on Friday, synced here after Monday was opened.
        _store.Standups.Finish(new DateTime(2026, 11, 13, 9, 15, 0), FridayText);

        Assert.NotEqual(monday.Version, _store.VersionOf(Monday, carry: true));
        Assert.Equal(_store.Load(Monday, carry: true).Version, _store.VersionOf(Monday, carry: true));
        Assert.Equal(SaveStatus.Conflict, _store.Save(Monday, monday.File.Content with { Notes = [] }, monday.Version).Status);
    }

    [Fact]
    public void Standups_are_not_days()
    {
        _store.Standups.Finish(new DateTime(2026, 11, 13, 9, 15, 0), FridayText);

        Assert.Equal([Friday], _store.ListDays());
        Assert.Equal(Friday, _store.LatestBefore(Monday));
    }

    private void Write(DateOnly date, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_store.PathFor(date))!);
        File.WriteAllText(_store.PathFor(date), text);
    }
}

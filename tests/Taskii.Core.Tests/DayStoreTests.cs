using Taskii.Core.Days;

namespace Taskii.Core.Tests;

public sealed class DayStoreTests : IDisposable
{
    private static readonly DateOnly Day = new(2026, 11, 16);
    private static readonly DayContent OneTask = new() { Todo = [new TaskItem { Id = "a", Title = "one" }] };

    private readonly string _root = Path.Combine(Path.GetTempPath(), "taskii-tests-" + Guid.NewGuid().ToString("N"));
    private readonly DayStore _store;

    public DayStoreTests() => _store = new DayStore(_root);

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    [Fact]
    public void Days_are_filed_by_year_and_month()
    {
        Assert.Equal(Path.Combine(_root, "2026", "11", "2026-11-16.md"), _store.PathFor(Day));
    }

    [Fact]
    public void A_day_with_no_file_loads_as_empty()
    {
        var snapshot = _store.Load(Day);

        Assert.False(snapshot.Exists);
        Assert.Equal("", snapshot.Version);
        Assert.True(snapshot.File.Content.IsEmpty);
    }

    [Fact]
    public void Saving_nothing_creates_nothing()
    {
        var result = _store.Save(Day, DayContent.Empty, baseVersion: "");

        Assert.Equal(SaveStatus.Unchanged, result.Status);
        Assert.False(Directory.Exists(_root));
    }

    [Fact]
    public void Saves_and_loads_a_day()
    {
        var saved = _store.Save(Day, OneTask, baseVersion: "");

        Assert.Equal(SaveStatus.Saved, saved.Status);
        Assert.Equal("# Todo\n\n- [ ] one ^a\n\n# Backlog\n\n# Notes\n", File.ReadAllText(_store.PathFor(Day)));

        var loaded = _store.Load(Day);
        Assert.True(loaded.Exists);
        Assert.Equal(saved.Version, loaded.Version);
        Assert.Equal("one", loaded.File.Content.Todo[0].Title);
    }

    [Fact]
    public void Saving_leaves_no_temporary_file_behind()
    {
        _store.Save(Day, OneTask, baseVersion: "");

        Assert.Equal(["2026-11-16.md"], Directory.GetFiles(Path.GetDirectoryName(_store.PathFor(Day))!).Select(Path.GetFileName));
    }

    [Fact]
    public void Saving_the_same_content_again_does_not_touch_the_file()
    {
        var first = _store.Save(Day, OneTask, baseVersion: "");
        var stamp = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(_store.PathFor(Day), stamp);

        var second = _store.Save(Day, OneTask, first.Version);

        Assert.Equal(SaveStatus.Unchanged, second.Status);
        Assert.Equal(first.Version, second.Version);
        Assert.Equal(stamp, File.GetLastWriteTimeUtc(_store.PathFor(Day)));
    }

    [Fact]
    public void A_file_changed_behind_our_back_is_not_overwritten()
    {
        var first = _store.Save(Day, OneTask, baseVersion: "");
        File.WriteAllText(_store.PathFor(Day), "# Todo\n\n- [ ] synced from the laptop ^z\n");

        var mine = new DayContent { Todo = [new TaskItem { Id = "a", Title = "edited here" }] };
        var result = _store.Save(Day, mine, first.Version);

        Assert.Equal(SaveStatus.Conflict, result.Status);
        Assert.Equal(_store.VersionOf(Day), result.Version);
        Assert.Contains("synced from the laptop", File.ReadAllText(_store.PathFor(Day)));

        var forced = _store.Save(Day, mine, first.Version, overwrite: true);
        Assert.Equal(SaveStatus.Saved, forced.Status);
        Assert.Contains("edited here", File.ReadAllText(_store.PathFor(Day)));
    }

    [Fact]
    public void A_file_that_appeared_since_loading_is_a_conflict_too()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_store.PathFor(Day))!);
        File.WriteAllText(_store.PathFor(Day), "# Todo\n\n- [ ] synced ^z\n");

        Assert.Equal(SaveStatus.Conflict, _store.Save(Day, OneTask, baseVersion: "").Status);
    }

    [Fact]
    public void Lists_only_real_day_files_in_order()
    {
        foreach (var day in new DateOnly[] { new(2026, 11, 16), new(2025, 12, 31), new(2026, 11, 13) })
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_store.PathFor(day))!);
            File.WriteAllText(_store.PathFor(day), "# Todo\n\n- [ ] one ^a\n");
        }

        var november = Path.Combine(_root, "2026", "11");
        File.WriteAllText(Path.Combine(november, "2026-11-13-LAPTOP.md"), "conflict copy");
        File.WriteAllText(Path.Combine(november, "2026-10-01.md"), "filed in the wrong month");
        File.WriteAllText(Path.Combine(november, "notes.md"), "not a day");
        Directory.CreateDirectory(Path.Combine(_root, "assets"));

        Assert.Equal(
            [new DateOnly(2025, 12, 31), new DateOnly(2026, 11, 13), new DateOnly(2026, 11, 16)],
            _store.ListDays());
    }
}

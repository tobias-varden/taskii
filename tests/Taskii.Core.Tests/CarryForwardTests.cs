using Taskii.Core.Days;

namespace Taskii.Core.Tests;

public sealed class CarryForwardTests : IDisposable
{
    private static readonly DateOnly Friday = new(2026, 11, 13);
    private static readonly DateOnly Monday = new(2026, 11, 16);

    /// <summary>Hand-formatted on purpose: carrying must not tidy what the user typed.</summary>
    private const string FridayText = """
        Kept at the top.

        # Todo
        * [ ] open, typed with a star ^a
            notes indented four spaces
        - [x] done on friday ^b [done:: 2026-11-13T15:00]

        # Backlog
        - [ ] someday ^c

        # Notes
        ## Card

        body after a blank line

        ### Side
        docked

        # Scratch
        not a taskii section

        """;

    private readonly string _root = Path.Combine(Path.GetTempPath(), "taskii-tests-" + Guid.NewGuid().ToString("N"));
    private readonly DayStore _store;

    public CarryForwardTests()
    {
        _store = new DayStore(_root);
        Write(Friday, FridayText);
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void A_new_day_starts_as_the_most_recent_day_so_monday_carries_from_friday()
    {
        var monday = _store.Load(Monday, carry: true);

        Assert.False(monday.Exists);
        Assert.Equal(Friday, monday.CarriedFrom);
        Assert.Equal(["open, typed with a star", "done on friday"], monday.File.Content.Todo.Select(t => t.Title));
        Assert.Equal("someday", Assert.Single(monday.File.Content.Backlog).Title);
        Assert.Equal("Side", Assert.Single(Assert.Single(monday.File.Content.Notes).Sides).Heading);
    }

    [Fact]
    public void Looking_at_a_new_day_creates_nothing()
    {
        var monday = _store.Load(Monday, carry: true);

        var result = _store.Save(Monday, monday.File.Content, monday.Version);

        Assert.Equal(SaveStatus.Unchanged, result.Status);
        Assert.False(File.Exists(_store.PathFor(Monday)));
    }

    [Fact]
    public void A_past_day_without_a_file_is_empty_unless_asked_to_carry()
    {
        var saturday = _store.Load(new DateOnly(2026, 11, 14));

        Assert.True(saturday.File.Content.IsEmpty);
        Assert.Null(saturday.CarriedFrom);
        Assert.Equal("", saturday.Version);
    }

    [Fact]
    public void The_first_edit_creates_the_day_as_a_copy_with_only_that_edit()
    {
        var monday = _store.Load(Monday, carry: true);
        var content = monday.File.Content;
        var edited = content with { Backlog = [content.Backlog[0] with { Title = "someday soon" }] };

        var result = _store.Save(Monday, edited, monday.Version);

        Assert.Equal(SaveStatus.Saved, result.Status);

        // A rewritten file gets one blank line after each section heading and unknown sections
        // last. Every item keeps the exact text it had on Friday: the star, the deep indent.
        Assert.Equal("""
            Kept at the top.

            # Todo

            * [ ] open, typed with a star ^a
                notes indented four spaces
            - [x] done on friday ^b [done:: 2026-11-13T15:00]

            # Backlog

            - [ ] someday soon ^c

            # Notes

            ## Card

            body after a blank line

            ### Side
            docked

            # Scratch
            not a taskii section

            """, File.ReadAllText(_store.PathFor(Monday)));
        Assert.Equal(FridayText, File.ReadAllText(_store.PathFor(Friday)));

        var reloaded = _store.Load(Monday, carry: true);
        Assert.True(reloaded.Exists);
        Assert.Null(reloaded.CarriedFrom);
        Assert.Equal(result.Version, reloaded.Version);
    }

    [Fact]
    public void Clearing_a_carried_day_is_an_edit_and_sticks()
    {
        var monday = _store.Load(Monday, carry: true);

        var result = _store.Save(Monday, DayContent.Empty, monday.Version);

        Assert.Equal(SaveStatus.Saved, result.Status);
        Assert.True(_store.Load(Monday, carry: true).File.Content.IsEmpty);
    }

    [Fact]
    public void A_carried_day_notices_when_the_day_it_came_from_changes()
    {
        var monday = _store.Load(Monday, carry: true);
        Assert.Equal(monday.Version, _store.VersionOf(Monday, carry: true));

        Write(Friday, FridayText.Replace("someday", "synced late from the laptop"));

        Assert.NotEqual(monday.Version, _store.VersionOf(Monday, carry: true));
        var mine = monday.File.Content with { Notes = [] };
        Assert.Equal(SaveStatus.Conflict, _store.Save(Monday, mine, monday.Version).Status);
        Assert.False(File.Exists(_store.PathFor(Monday)));
    }

    [Fact]
    public void A_day_that_appears_by_sync_is_not_overwritten_by_edits_to_the_carried_one()
    {
        var monday = _store.Load(Monday, carry: true);
        Write(Monday, "# Todo\n\n- [ ] started on the laptop ^z\n");

        var result = _store.Save(Monday, monday.File.Content with { Notes = [] }, monday.Version);

        Assert.Equal(SaveStatus.Conflict, result.Status);
        Assert.Contains("started on the laptop", File.ReadAllText(_store.PathFor(Monday)));
    }

    [Fact]
    public void Carrying_skips_over_days_without_files_and_ignores_later_ones()
    {
        Write(new DateOnly(2025, 12, 31), "# Todo\n\n- [ ] last year ^y\n");
        Write(new DateOnly(2026, 11, 20), "# Todo\n\n- [ ] the future ^f\n");

        Assert.Equal(Friday, _store.LatestBefore(Monday));
        Assert.Equal(new DateOnly(2025, 12, 31), _store.LatestBefore(Friday));
        Assert.Equal(new DateOnly(2025, 12, 31), _store.LatestBefore(new DateOnly(2026, 3, 1)));
        Assert.Null(_store.LatestBefore(new DateOnly(2025, 12, 31)));
    }

    [Fact]
    public void With_no_earlier_day_a_new_day_starts_empty()
    {
        var first = new DayStore(Path.Combine(_root, "fresh")).Load(Monday, carry: true);

        Assert.True(first.File.Content.IsEmpty);
        Assert.Null(first.CarriedFrom);
        Assert.Equal("", first.Version);
    }

    [Fact]
    public void Done_tasks_stay_behind_once_a_standup_has_reported_them()
    {
        var friday = DayFile.Parse("""
            # Todo
            - [x] reported ^a [done:: 2026-11-13T08:00]
            - [x] done after the standup ^b [done:: 2026-11-13T15:00]
            - [x] done, no time recorded ^c
            - [ ] still open ^d

            # Backlog
            - [x] reported from the backlog ^e [done:: 2026-11-12T17:30]

            # Notes
            ## Stays
            """).Content;

        var carried = DayCarry.Forward(friday, lastStandup: new DateTime(2026, 11, 13, 9, 15, 0));

        Assert.Equal(["done after the standup", "done, no time recorded", "still open"], carried.Todo.Select(t => t.Title));
        Assert.Empty(carried.Backlog);
        Assert.Single(carried.Notes);
        Assert.Same(friday, DayCarry.Forward(friday));
    }

    private void Write(DateOnly date, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_store.PathFor(date))!);
        File.WriteAllText(_store.PathFor(date), text);
    }
}

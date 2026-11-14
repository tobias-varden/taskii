using Taskii.Core.Days;

namespace Taskii.Core.Tests;

public sealed class DayEditsTests : IDisposable
{
    private static readonly DateOnly Friday = new(2026, 11, 13);
    private static readonly DateOnly Monday = new(2026, 11, 16);

    private static readonly DayContent Day = DayFile.Parse("""
        # Todo
        - [ ] first ^a
          already has a note
        - [x] done ^b

        # Backlog
        - [ ] someday ^c

        # Notes
        ## Card
        body
        """).Content;

    private readonly string _root = Path.Combine(Path.GetTempPath(), "taskii-tests-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    [Fact]
    public void A_captured_task_goes_to_the_bottom_of_todo_with_a_fresh_id()
    {
        var day = DayEdits.AddTask(Day, "ACME: e2e test fails", "Only the password reset flow\nStarted after Thursday's deploy")!;

        Assert.Equal(["first", "done", "ACME: e2e test fails"], day.Todo.Select(t => t.Title));
        var added = day.Todo[^1];
        Assert.Matches("^[a-z0-9]{6}$", added.Id);
        Assert.False(added.Done);
        Assert.Equal("Only the password reset flow\nStarted after Thursday's deploy", added.Body);
        Assert.Same(Day.Backlog, day.Backlog);
    }

    [Fact]
    public void A_task_captured_for_later_goes_to_the_top_of_the_backlog()
    {
        var day = DayEdits.AddTask(Day, "later", "", toBacklog: true)!;

        Assert.Equal(["later", "someday"], day.Backlog.Select(t => t.Title));
        Assert.Equal(2, day.Todo.Count);
    }

    [Fact]
    public void A_captured_note_becomes_a_card_at_the_end_of_the_board()
    {
        var day = DayEdits.AddNote(Day, "10:05 Sprint planning", "Security fixes go out before the 24th.")!;

        Assert.Equal(["Card", "10:05 Sprint planning"], day.Notes.Select(n => n.Heading));
        Assert.Equal("Security fixes go out before the 24th.", day.Notes[^1].Body);
    }

    [Fact]
    public void Text_captured_for_a_task_is_added_under_what_is_already_there()
    {
        var day = DayEdits.AppendToTask(Day, "a", "Contoso replied\nsecret arrives tomorrow")!;
        Assert.Equal("already has a note\nContoso replied\nsecret arrives tomorrow", day.Todo[0].Body);

        var backlog = DayEdits.AppendToTask(Day, "c", "first note")!;
        Assert.Equal("first note", backlog.Backlog[0].Body);
    }

    [Fact]
    public void Nothing_typed_changes_nothing()
    {
        Assert.Null(DayEdits.AddTask(Day, "  ", "\n \n"));
        Assert.Null(DayEdits.AddNote(Day, "", ""));
        Assert.Null(DayEdits.AppendToTask(Day, "a", "  "));
        Assert.Null(DayEdits.AppendToTask(Day, "no such task", "text"));
    }

    [Fact]
    public void New_ids_avoid_the_ones_in_use()
    {
        var ids = Enumerable.Range(0, 200).Select(_ => TaskIds.New(["taken1"])).ToList();

        Assert.All(ids, id => Assert.Matches("^[a-z0-9]{6}$", id));
        Assert.DoesNotContain("taken1", ids);
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Fact]
    public void Capturing_on_a_new_day_starts_it_from_the_previous_one_and_keeps_what_was_typed_there()
    {
        var store = new DayStore(_root);
        Directory.CreateDirectory(Path.GetDirectoryName(store.PathFor(Friday))!);
        File.WriteAllText(store.PathFor(Friday), "# Todo\n* [ ] typed with a star ^a\n");

        var changed = store.Update(Monday, day => DayEdits.AddTask(day, "captured on monday", ""));

        Assert.True(changed);
        var text = File.ReadAllText(store.PathFor(Monday));
        Assert.StartsWith("# Todo\n\n* [ ] typed with a star ^a\n- [ ] captured on monday ^", text);
        Assert.Equal("# Todo\n* [ ] typed with a star ^a\n", File.ReadAllText(store.PathFor(Friday)));
    }

    [Fact]
    public void An_update_that_changes_nothing_writes_nothing()
    {
        var store = new DayStore(_root);

        Assert.False(store.Update(Monday, _ => null));
        Assert.False(store.Update(Monday, day => day));
        Assert.False(File.Exists(store.PathFor(Monday)));
    }

    [Fact]
    public void An_update_is_reapplied_when_the_file_changes_underneath_it()
    {
        var store = new DayStore(_root);
        Directory.CreateDirectory(Path.GetDirectoryName(store.PathFor(Monday))!);
        File.WriteAllText(store.PathFor(Monday), "# Todo\n\n- [ ] one ^a\n");
        var interrupted = false;

        var changed = store.Update(Monday, day =>
        {
            if (!interrupted)
            {
                // A sync lands between reading the day and writing it.
                interrupted = true;
                File.WriteAllText(store.PathFor(Monday), "# Todo\n\n- [ ] one ^a\n- [ ] synced ^z\n");
            }

            return DayEdits.AddTask(day, "captured", "");
        });

        Assert.True(changed);
        Assert.Equal(["one", "synced", "captured"], store.Load(Monday).File.Content.Todo.Select(t => t.Title));
    }
}

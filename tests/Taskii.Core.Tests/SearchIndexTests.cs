using Taskii.Core.Days;
using Taskii.Core.Search;

namespace Taskii.Core.Tests;

public sealed class SearchIndexTests : IDisposable
{
    private static readonly DateOnly Mon = new(2026, 11, 9);
    private static readonly DateOnly Tue = new(2026, 11, 10);
    private static readonly DateOnly Wed = new(2026, 11, 11);
    private static readonly DateOnly Thu = new(2026, 11, 12);

    private static readonly TaskItem Contoso = new() { Id = "a1b3", Title = "Federation: Add Contoso Edu to TEST", Body = "Onboard them, details in Mail" };
    private static readonly TaskItem Secret = new() { Id = "c9d0", Title = "Federation: Get client secret" };
    private static readonly TaskItem Spaces = new() { Id = "t7k2", Title = "ACME: Fix users with space in username" };
    private static readonly NoteCard Planning = new() { Heading = "Sprint planning", Body = "Check who owns the Contoso shared folder." };

    private readonly string _root = Path.Combine(Path.GetTempPath(), "taskii-tests-" + Guid.NewGuid().ToString("N"));
    private readonly DayStore _store;
    private readonly SearchIndex _index;

    public SearchIndexTests()
    {
        _store = new DayStore(Path.Combine(_root, "data"));
        _index = new SearchIndex(_store, DatabasePath);
    }

    private string DatabasePath => Path.Combine(_root, "local", "index.db");

    public void Dispose()
    {
        _index.Dispose();
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    /// <summary>Writes a day file directly, as a day that was carried forward and edited would look.</summary>
    private void Put(DateOnly date, DayContent content)
    {
        var path = _store.PathFor(date);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, DayFile.Empty.Write(content));
    }

    private static DayContent Day(TaskItem[]? todo = null, TaskItem[]? backlog = null, NoteCard[]? notes = null) =>
        new() { Todo = todo ?? [], Backlog = backlog ?? [], Notes = notes ?? [] };

    private SearchResults Find(string text) => Find(new SearchQuery { Text = text });

    private SearchResults Find(SearchQuery query)
    {
        _index.Refresh();
        return _index.Search(query);
    }

    [Fact]
    public void A_task_that_lived_on_many_days_is_one_result()
    {
        Put(Mon, Day(todo: [Contoso, Spaces]));
        Put(Tue, Day(todo: [Contoso, Spaces]));
        Put(Thu, Day(todo: [Contoso]));

        var results = Find("contoso");

        var hit = Assert.Single(results.Hits);
        Assert.Equal(ItemKind.Task, hit.Kind);
        Assert.Equal(Contoso.Title, hit.Title);
        Assert.Equal("Federation", hit.Tag);
        Assert.Equal((Mon, Thu, 3), (hit.First, hit.Last, hit.Days));
        Assert.Equal((1, 3), (results.Total, results.Days));
    }

    [Fact]
    public void Every_word_must_match_as_the_start_of_a_word_in_the_title_or_body()
    {
        Put(Mon, Day(todo: [Contoso, Secret, Spaces]));

        Assert.Equal([Contoso.Title], Find("Co").Hits.Select(h => h.Title));
        Assert.Equal([Contoso.Title], Find("mail").Hits.Select(h => h.Title));
        Assert.Equal([Contoso.Title], Find("fed onboard").Hits.Select(h => h.Title));
        Assert.Equal(2, Find("federation").Hits.Count);
        Assert.Empty(Find("federation acme").Hits);
        // Not in the middle of a word.
        Assert.Empty(Find("sername").Hits);
    }

    [Fact]
    public void What_was_typed_cannot_break_the_query()
    {
        Put(Mon, Day(todo: [Contoso]));

        // Operators and punctuation are just words and separators.
        Assert.Single(Find("\"Contoso\" (Edu) -* ^add").Hits);
        Assert.Empty(Find("contoso OR").Hits);
        Assert.Empty(Find("contoso NOT edu").Hits);
        Assert.Single(Find("add: contoso!").Hits);
    }

    [Fact]
    public void A_task_is_found_by_text_it_no_longer_has_and_shown_as_it_was_then()
    {
        Put(Mon, Day(todo: [Contoso with { Body = "Waiting for Sam" }]));
        Put(Tue, Day(todo: [Contoso with { Body = "Folder received" }]));

        var hit = Assert.Single(Find("sam").Hits);

        Assert.Equal("Waiting for Sam", hit.Body);
        Assert.Equal((Mon, Tue, 2), (hit.First, hit.Last, hit.Days));
    }

    [Fact]
    public void Identical_notes_collapse_and_an_edited_note_is_a_new_one()
    {
        var edited = Planning with { Body = "Contoso folder is owned by Sam." };
        Put(Mon, Day(notes: [Planning]));
        Put(Tue, Day(notes: [Planning]));
        Put(Wed, Day(notes: [edited]));

        var hits = Find("contoso").Hits;

        Assert.Equal(2, hits.Count);
        Assert.All(hits, hit => Assert.Equal(ItemKind.Note, hit.Kind));
        // Newest first.
        Assert.Equal((edited.Body, Wed, Wed, 1), (hits[0].Body, hits[0].First, hits[0].Last, hits[0].Days));
        Assert.Equal((Planning.Body, Mon, Tue, 2), (hits[1].Body, hits[1].First, hits[1].Last, hits[1].Days));
    }

    [Fact]
    public void A_note_is_found_by_its_side_notes()
    {
        Put(Mon, Day(notes: [Planning with { Sides = [new SideNote { Heading = "Edge cases", Body = "Email match must ignore case" }] }]));

        Assert.Equal("Sprint planning", Assert.Single(Find("edge").Hits).Title);
        Assert.Contains("ignore case", Assert.Single(Find("email").Hits).Body);
    }

    [Fact]
    public void Results_can_be_narrowed_to_tasks_or_notes_and_to_a_tag()
    {
        Put(Mon, Day(todo: [Contoso, Spaces], backlog: [Secret], notes: [Planning]));

        Assert.Equal(2, Find("contoso").Hits.Count);
        Assert.Equal([ItemKind.Task], Find(new SearchQuery { Text = "contoso", Kind = ItemKind.Task }).Hits.Select(h => h.Kind));
        Assert.Equal([ItemKind.Note], Find(new SearchQuery { Text = "contoso", Kind = ItemKind.Note }).Hits.Select(h => h.Kind));

        // With nothing typed, a tag lists everything that has it.
        var federation = Find(new SearchQuery { Tag = "federation" }).Hits.Select(h => h.Title).Order();
        Assert.Equal([Contoso.Title, Secret.Title], federation);
        Assert.Empty(Find(new SearchQuery { Text = "space", Tag = "Federation" }).Hits);
    }

    [Fact]
    public void Open_and_done_go_by_the_last_day_a_task_appears_on()
    {
        Put(Mon, Day(todo: [Contoso, Secret], notes: [Planning]));
        Put(Tue, Day(todo: [Contoso with { Done = true, Fields = [new TaskField("done", "2026-11-10T08:40")] }, Secret]));

        var done = Find(new SearchQuery { Text = "federation", State = TaskState.Done }).Hits;
        var open = Find(new SearchQuery { Text = "federation", State = TaskState.Open }).Hits;

        Assert.Equal([Contoso.Title], done.Select(h => h.Title));
        Assert.True(done[0].Done);
        Assert.Equal([Secret.Title], open.Select(h => h.Title));
        // Notes are neither.
        Assert.Empty(Find(new SearchQuery { Text = "contoso", State = TaskState.Open }).Hits);
    }

    [Fact]
    public void History_lists_every_day_and_each_state_once()
    {
        var waiting = Contoso with { Body = "Waiting for Sam" };
        Put(Mon, Day(todo: [Contoso]));
        Put(Tue, Day(todo: [Contoso]));
        Put(Wed, Day(todo: [waiting]));
        Put(Thu, Day(backlog: [waiting]));

        var history = _index.History(Assert.Single(Find("contoso").Hits).Key);

        Assert.NotNull(history);
        Assert.Equal(ItemKind.Task, history.Kind);
        Assert.Equal([(Mon, 0), (Tue, 0), (Wed, 1), (Thu, 2)], history.Days.Select(d => (d.Date, d.Version)));
        Assert.Equal(["todo", "todo", "backlog"], history.Versions.Select(v => v.Section));
        Assert.Equal(["Onboard them, details in Mail", "Waiting for Sam", "Waiting for Sam"], history.Versions.Select(v => v.Task!.Body));
        Assert.Equal("a1b3", history.Versions[0].Task!.Id);
    }

    [Fact]
    public void History_of_a_note_has_its_side_notes()
    {
        Put(Mon, Day(notes: [Planning with { Sides = [new SideNote { Heading = "Edge cases", Body = "x" }] }]));

        var history = _index.History(Assert.Single(Find("planning").Hits).Key);

        Assert.Equal("Edge cases", Assert.Single(Assert.Single(history!.Versions).Note!.Sides).Heading);
        Assert.Null(_index.History("t:nothing"));
    }

    private IReadOnlyList<RelatedItem> RelatedTo(string text)
    {
        var history = _index.History(Assert.Single(Find(text).Hits).Key)!;
        return history.Related[history.Days[^1].Version];
    }

    [Fact]
    public void A_blocked_task_and_its_blocker_are_related_both_ways()
    {
        var blocked = Contoso with { Fields = [new TaskField("blocked-by", "^c9d0")] };
        Put(Mon, Day(todo: [Secret, blocked]));
        Put(Tue, Day(todo: [Secret with { Done = true }, blocked]));

        var blocker = Assert.Single(RelatedTo("onboard"));
        Assert.Equal((Relation.BlockedBy, "t:c9d0", Secret.Title, Tue), (blocker.Relation, blocker.Key, blocker.Title, blocker.Date));
        // As it is now, not as it was when the link was made.
        Assert.True(blocker.Done);

        var waiting = Assert.Single(RelatedTo("secret"));
        Assert.Equal((Relation.Blocks, "t:a1b3", Contoso.Title), (waiting.Relation, waiting.Key, waiting.Title));
    }

    [Fact]
    public void Related_items_belong_to_the_state_the_item_was_in()
    {
        Put(Mon, Day(todo: [Secret, Contoso]));
        Put(Tue, Day(todo: [Secret, Contoso with { Fields = [new TaskField("blocked-by", "^c9d0")] }]));

        var history = _index.History(Assert.Single(Find("onboard").Hits).Key)!;

        Assert.Empty(history.Related[history.Days[0].Version]);
        Assert.Single(history.Related[history.Days[1].Version]);
    }

    [Fact]
    public void Whatever_mentions_the_same_ticket_is_related()
    {
        var pr = new NoteCard { Heading = "Catalog search PR", Body = "Draft ready. [widget-service#413](https://github.com/owner/widget-service/pull/413)" };
        var task = Spaces with { Body = "Fixed in widget-service#413, see AB#4521" };
        var other = Secret with { Body = "Tracked as https://dev.azure.com/org/Project/_workitems/edit/4521" };
        Put(Mon, Day(todo: [task, other, Contoso], notes: [pr, Planning]));

        var related = RelatedTo("username");

        Assert.Equal(
            [(Relation.Ticket, ItemKind.Task, Secret.Title, "AB#4521"), (Relation.Ticket, ItemKind.Note, "Catalog search PR", "widget-service#413")],
            related.OrderBy(item => item.Kind).Select(item => (item.Relation, item.Kind, item.Title, item.Ticket)));
        Assert.Equal(Spaces.Title, Assert.Single(RelatedTo("draft")).Title);
        Assert.Empty(RelatedTo("onboard"));
    }

    [Fact]
    public void A_note_that_was_edited_along_the_way_is_related_once_and_not_to_itself()
    {
        var task = Spaces with { Body = "See AB#4521" };
        var note = new NoteCard { Heading = "Space bug", Body = "AB#4521 first thoughts" };
        Put(Mon, Day(todo: [task], notes: [note]));
        Put(Tue, Day(todo: [task], notes: [note with { Body = "AB#4521 second thoughts" }]));

        var related = Assert.Single(RelatedTo("username"));
        Assert.Equal(("Space bug", Tue), (related.Title, related.Date));

        // The note's earlier self is not something else that mentions the ticket.
        Assert.Equal([Spaces.Title], RelatedTo("second").Select(item => item.Title));
    }

    [Theory]
    [InlineData("nothing here, not even #123", new string[0])]
    [InlineData("see AB#4521 and ab#77.", new[] { "AB#4521", "AB#77" })]
    [InlineData("Widget-Service#413 twice widget-service#413", new[] { "widget-service#413" })]
    [InlineData("[pr](https://github.com/Owner/Widget-Service/pull/413) https://github.com/owner/api/issues/9#issuecomment-1", new[] { "widget-service#413", "api#9" })]
    [InlineData("https://dev.azure.com/org/Proj/_workitems/edit/4521 https://org.visualstudio.com/Proj/_workitems/edit/12", new[] { "AB#4521", "AB#12" })]
    [InlineData("https://dev.azure.com/org/Proj/_git/My%20Repo/pullrequest/88", new[] { "my repo!88" })]
    [InlineData("C#12 is fine but a/b#3 and x.#4 are not", new[] { "c#12" })]
    public void Tickets_are_recognised_however_they_are_written(string text, string[] expected)
    {
        Assert.Equal(expected, TicketRefs.In(text));
    }

    [Fact]
    public void Refresh_follows_files_that_change_and_disappear()
    {
        Put(Mon, Day(todo: [Contoso]));
        Put(Tue, Day(todo: [Contoso, Spaces]));

        Assert.True(_index.Refresh());
        Assert.False(_index.Refresh());
        Assert.Single(_index.Search(new SearchQuery { Text = "username" }).Hits);

        Put(Tue, Day(todo: [Contoso, Spaces with { Title = "ACME: Fix users with a blank in the name" }]));
        Assert.True(_index.Refresh());
        Assert.Empty(_index.Search(new SearchQuery { Text = "username" }).Hits);
        Assert.Single(_index.Search(new SearchQuery { Text = "blank" }).Hits);

        File.Delete(_store.PathFor(Tue));
        Assert.True(_index.Refresh());
        Assert.Empty(_index.Search(new SearchQuery { Text = "blank" }).Hits);
        Assert.Equal(Mon, Assert.Single(_index.Search(new SearchQuery { Text = "contoso" }).Hits).Last);
    }

    [Fact]
    public void Tags_are_listed_most_used_first()
    {
        Put(Mon, Day(todo: [Spaces, Contoso, Secret], notes: [Planning]));
        Put(Tue, Day(todo: [Spaces, Contoso, Secret]));
        _index.Refresh();

        Assert.Equal(["Federation", "ACME"], _index.Tags());
    }

    [Fact]
    public void The_index_survives_a_restart_without_reading_the_files_again()
    {
        Put(Mon, Day(todo: [Contoso]));
        _index.Refresh();
        _index.Dispose();

        using var again = new SearchIndex(_store, DatabasePath);

        Assert.False(again.Refresh());
        Assert.Single(again.Search(new SearchQuery { Text = "contoso" }).Hits);
    }

    [Fact]
    public void An_index_for_another_data_folder_is_rebuilt()
    {
        Put(Mon, Day(todo: [Contoso]));
        _index.Refresh();
        _index.Dispose();

        var other = new DayStore(Path.Combine(_root, "other"));
        using var index = new SearchIndex(other, DatabasePath);
        index.Refresh();

        Assert.Empty(index.Search(new SearchQuery { Text = "contoso" }).Hits);
    }

    [Fact]
    public void A_damaged_index_is_thrown_away_and_rebuilt()
    {
        Put(Mon, Day(todo: [Contoso]));
        _index.Dispose();
        Directory.CreateDirectory(Path.GetDirectoryName(DatabasePath)!);
        File.WriteAllText(DatabasePath, new string('x', 5000));

        using var index = new SearchIndex(_store, DatabasePath);

        Assert.True(index.Refresh());
        Assert.Single(index.Search(new SearchQuery { Text = "contoso" }).Hits);
    }

    [Theory]
    [InlineData("", null)]
    [InlineData("  -- ", null)]
    [InlineData("Contoso", "\"Contoso\"*")]
    [InlineData("AB#4521 fix", "\"AB\"* \"4521\"* \"fix\"*")]
    [InlineData("\"quoted\" OR", "\"quoted\"* \"OR\"*")]
    public void What_is_typed_becomes_a_prefix_query(string text, string? expected)
    {
        Assert.Equal(expected, SearchIndex.MatchExpression(text));
    }
}

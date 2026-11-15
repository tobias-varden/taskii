using Taskii.Core.Days;
using Taskii.Core.Search;
using static Taskii.Host.Tests.BridgeFixture;

namespace Taskii.Host.Tests;

public sealed class EditableDayTests : IDisposable
{
    private static readonly DateOnly Tue = new(2026, 11, 10);
    private static readonly DateOnly Fri = new(2026, 11, 13);
    private static readonly DateOnly Sat = new(2026, 11, 14);

    // Thirty seconds to midnight on Friday.
    private readonly BridgeFixture _host = new(new DateTime(2026, 11, 13, 23, 59, 30));

    public void Dispose() => _host.Dispose();

    private Task<SaveDayResult> Save(DateOnly date, DayContent content, string baseVersion) =>
        _host.Request<SaveDayResult>("saveDay", new { date, baseVersion, overwrite = false, content });

    [Fact]
    public async Task An_edit_made_just_before_midnight_is_saved_to_the_day_it_was_made_on()
    {
        var init = await _host.Init();
        Assert.Equal("2026-11-13", init.Day!.Date);

        _host.Clock.Advance(TimeSpan.FromMinutes(1));
        var saved = await Save(Fri, Day("Late thought"), init.Day.Version);

        Assert.Equal("saved", saved.Status);
        Assert.Equal("Late thought", _host.Store.Load(Fri).File.Content.Todo.Single().Title);
        Assert.False(_host.Store.Load(Sat).Exists);
    }

    [Fact]
    public async Task The_new_day_is_not_saved_until_it_has_been_handed_out()
    {
        await _host.Init();
        _host.Clock.Advance(TimeSpan.FromMinutes(1));

        await Assert.ThrowsAsync<InvalidOperationException>(() => Save(Sat, Day("Too soon"), ""));

        var sat = await _host.Request<DayDto>("loadDay", new { date = Sat });
        Assert.True(sat.Editable);
        Assert.Equal("saved", (await Save(Sat, Day("Saturday"), sat.Version)).Status);
    }

    [Fact]
    public async Task A_past_day_is_read_only()
    {
        _host.Put(Tue, Day("Old"));
        await _host.Init();

        var tue = await _host.Request<DayDto>("loadDay", new { date = Tue });

        Assert.False(tue.Editable);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Save(Tue, Day("Rewritten"), tue.Version));
        Assert.Equal("Old", _host.Store.Load(Tue).File.Content.Todo.Single().Title);
    }

    [Fact]
    public async Task Looking_at_a_past_day_leaves_today_editable()
    {
        _host.Put(Tue, Day("Old"));
        var init = await _host.Init();

        await _host.Request<DayDto>("loadDay", new { date = Tue });

        Assert.Equal("saved", (await Save(Fri, Day("Still today"), init.Day!.Version)).Status);
    }

    [Fact]
    public async Task A_payload_with_a_field_missing_is_refused_by_name()
    {
        var init = await _host.Init();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            _host.Raw("saveDay", new { date = Fri, baseVersion = init.Day!.Version, content = Day("No overwrite flag") }));

        Assert.Contains("saveDay", error.Message);
        Assert.Contains("overwrite", error.Message);
        Assert.False(_host.Store.Load(Fri).Exists);
    }
}

public sealed class NavigationTests : IDisposable
{
    private static readonly DateOnly Mon = new(2026, 11, 9);
    private static readonly DateOnly Tue = new(2026, 11, 10);
    private static readonly DateOnly Wed = new(2026, 11, 11);
    private static readonly DateOnly Fri = new(2026, 11, 13);

    private readonly BridgeFixture _host = new(new DateTime(2026, 11, 13, 12, 0, 0));

    public NavigationTests()
    {
        _host.Put(Mon, Day("Mon"));
        _host.Put(Wed, Day("Wed"));
        // A day ahead of today, as a machine with its clock wrong might have written.
        _host.Put(new DateOnly(2026, 11, 20), Day("Future"));
    }

    public void Dispose() => _host.Dispose();

    private async Task<(string? Prev, string? Next)> Around(DateOnly date)
    {
        await _host.Init();
        var day = await _host.Request<DayDto>("loadDay", new { date });
        return (day.Prev, day.Next);
    }

    [Fact]
    public async Task The_first_day_has_nothing_before_it() =>
        Assert.Equal((null, "2026-11-11"), await Around(Mon));

    [Fact]
    public async Task Steps_skip_days_without_a_file() =>
        Assert.Equal(("2026-11-09", "2026-11-11"), await Around(Tue));

    [Fact]
    public async Task Next_from_the_last_day_with_a_file_is_today_even_without_one() =>
        Assert.Equal(("2026-11-09", "2026-11-13"), await Around(Wed));

    [Fact]
    public async Task Today_has_no_next_even_when_a_later_day_has_a_file() =>
        Assert.Equal(("2026-11-11", null), await Around(Fri));
}

public sealed class CaptureTests : IDisposable
{
    private static readonly DateOnly Fri = new(2026, 11, 13);

    private readonly BridgeFixture _host = new(new DateTime(2026, 11, 13, 10, 0, 0));
    private readonly List<string> _events = [];

    public CaptureTests()
    {
        _host.Put(Fri, Day("Write report"));
        _host.Bridge.BeforeOutsideEdit = () =>
        {
            _events.Add("flush, with " + Titles());
            return Task.CompletedTask;
        };
        _host.Bridge.AfterOutsideEdit = () => _events.Add("show, with " + Titles());
    }

    public void Dispose() => _host.Dispose();

    private string Titles() => string.Join(" + ", _host.Store.Load(Fri).File.Content.Todo.Select(t => t.Title));

    private Task<bool> Capture(string kind, string title = "", string body = "", string taskId = "") =>
        _host.Request<bool>("capture", new { kind, title, body, taskId });

    [Fact]
    public async Task The_page_writes_what_it_has_before_the_day_is_changed_and_is_told_after()
    {
        Assert.True(await Capture("todo", "Call the bank"));

        Assert.Equal(["flush, with Write report", "show, with Write report + Call the bank"], _events);
    }

    [Fact]
    public async Task Appending_adds_to_the_task_body()
    {
        Assert.True(await Capture("append", body: "First draft is done", taskId: "task00"));

        Assert.Contains("First draft is done", _host.Store.Load(Fri).File.Content.Todo.Single().Body);
    }

    [Fact]
    public async Task Appending_nothing_changes_nothing()
    {
        var before = _host.Store.Load(Fri).Version;

        Assert.False(await Capture("append", body: "  ", taskId: "task00"));

        Assert.Equal(before, _host.Store.Load(Fri).Version);
    }

    [Fact]
    public async Task Appending_to_a_task_that_is_gone_is_an_error() =>
        await Assert.ThrowsAsync<InvalidOperationException>(() => Capture("append", body: "Lost", taskId: "nosuch"));

    [Fact]
    public async Task An_unknown_kind_is_an_error()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => Capture("poem", "Roses"));
        Assert.Empty(_events);
    }

    [Fact]
    public async Task What_was_captured_can_be_found_at_once()
    {
        await _host.Init();
        Assert.Equal(0, (await Search("unicorn")).Total);

        await Capture("todo", "Unicorn migration");

        Assert.Equal(1, (await Search("unicorn")).Total);
    }

    private Task<SearchResponse> Search(string text) =>
        _host.Request<SearchResponse>("search", new { text, kind = (ItemKind?)null, tag = (string?)null, state = TaskState.Any });
}

public sealed class IndexFreshnessTests : IDisposable
{
    private static readonly DateOnly Wed = new(2026, 11, 11);
    private static readonly DateOnly Fri = new(2026, 11, 13);

    private readonly BridgeFixture _host = new(new DateTime(2026, 11, 13, 10, 0, 0));

    public void Dispose() => _host.Dispose();

    private async Task<int> Found(string text) =>
        (await _host.Request<SearchResponse>("search", new { text, kind = (string?)null, tag = (string?)null, state = "any" })).Total;

    [Fact]
    public async Task A_day_changed_elsewhere_is_found_once_the_index_is_no_longer_trusted()
    {
        await _host.Init();
        Assert.Equal(0, await Found("zebra"));

        _host.Put(Wed, Day("Zebra crossing"));
        _host.Clock.Advance(LiveIndex.FreshFor);
        Assert.Equal(0, await Found("zebra"));

        _host.Clock.Advance(TimeSpan.FromMilliseconds(1));
        Assert.Equal(1, await Found("zebra"));
    }

    [Fact]
    public async Task A_save_from_the_page_is_found_at_once()
    {
        var init = await _host.Init();
        Assert.Equal(0, await Found("zebra"));

        await _host.Request<SaveDayResult>("saveDay", new { date = Fri, baseVersion = init.Day!.Version, overwrite = false, content = Day("Zebra crossing") });

        Assert.Equal(1, await Found("zebra"));
    }

    [Fact]
    public async Task A_save_that_conflicts_does_not_refresh_the_index()
    {
        var init = await _host.Init();
        Assert.Equal(0, await Found("zebra"));

        _host.Put(Wed, Day("Zebra crossing"));
        var result = await _host.Request<SaveDayResult>("saveDay", new { date = Fri, baseVersion = "stale", overwrite = false, content = Day("Mine") });

        Assert.NotEqual("saved", result.Status);
        Assert.Equal(0, await Found("zebra"));
    }
}

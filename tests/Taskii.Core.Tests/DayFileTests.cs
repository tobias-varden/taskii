using Taskii.Core.Days;

namespace Taskii.Core.Tests;

public class DayFileTests
{
    /// <summary>The example day from docs/design.md.</summary>
    private const string Example = """
        # Todo

        - [ ] ACME: Fix users with space in username ^t7k2
          Get stats 1 234 (~500 have space in the middle)
          Tell Support about it
        - [ ] Federation: Get client secret from Contoso ^c9d0
        - [ ] Federation: Add Contoso Edu to our TEST environment ^a1b3 [blocked-by:: ^c9d0]
          Onboard them, details in Mail
        - [x] Dev: Switch all repos to use SharedBuild agent pool ^q2w3 [done:: 2026-11-16T08:40]

        # Backlog

        - [ ] Portal infra: Use refresh tokens on PROD ^m4n5
          - [ ] Apply new portalv3 and portal-admin

        # Notes

        ## Catalog search PR
        Draft ready, waiting on review. [widget-service#413](https://github.com/owner/widget-service/pull/413)

        ### Edge cases
        Email match must ignore case, username must not.

        ## 10:05 Sprint planning
        Security fixes go out before the 24th.

        """;

    [Fact]
    public void Parses_the_example_from_the_design()
    {
        var day = DayFile.Parse(Example).Content;

        Assert.Equal(4, day.Todo.Count);

        var first = day.Todo[0];
        Assert.Equal("t7k2", first.Id);
        Assert.False(first.Done);
        Assert.Equal("ACME: Fix users with space in username", first.Title);
        Assert.Equal("Get stats 1 234 (~500 have space in the middle)\nTell Support about it", first.Body);

        var blocked = day.Todo[2];
        Assert.Equal("Federation: Add Contoso Edu to our TEST environment", blocked.Title);
        Assert.Equal("a1b3", blocked.Id);
        Assert.Equal([new TaskField("blocked-by", "^c9d0")], blocked.Fields);

        var done = day.Todo[3];
        Assert.True(done.Done);
        Assert.Equal([new TaskField("done", "2026-11-16T08:40")], done.Fields);

        var backlog = Assert.Single(day.Backlog);
        Assert.Equal("m4n5", backlog.Id);
        Assert.Equal("- [ ] Apply new portalv3 and portal-admin", backlog.Body);

        Assert.Equal(2, day.Notes.Count);
        Assert.Equal("Catalog search PR", day.Notes[0].Heading);
        Assert.StartsWith("Draft ready, waiting on review.", day.Notes[0].Body);
        var side = Assert.Single(day.Notes[0].Sides);
        Assert.Equal("Edge cases", side.Heading);
        Assert.Equal("Email match must ignore case, username must not.", side.Body);
        Assert.Equal("10:05 Sprint planning", day.Notes[1].Heading);
        Assert.Empty(day.Notes[1].Sides);
    }

    [Fact]
    public void Writing_what_was_read_returns_the_same_text()
    {
        var file = DayFile.Parse(Example);

        Assert.Same(file.Text, file.Write(file.Content));
    }

    [Fact]
    public void A_canonical_file_is_reproduced_from_its_content_alone()
    {
        var content = DayFile.Parse(Example).Content;

        Assert.Equal(Example, DayFile.Empty.Write(content));
    }

    [Theory]
    [InlineData("# Todo\n- [ ] one ^a\n\n\n- [ ] two ^b\n# Notes\n## Card\n\n\nbody\n")]
    [InlineData("Some text I keep at the top.\n\n# Todo\n\n* [X] star and capital ^a\n\tTab indented body\n\n# Ideas\n\n- not a taskii section\n")]
    [InlineData("# Notes\nloose text with no heading\n\n## Card\n```\n# not a heading\n## also not\n```\n")]
    [InlineData("# Backlog\n\n- [ ] backlog first ^a\n\n# Todo\n\n- [ ] then todo ^b")]
    [InlineData("")]
    public void Untidy_files_come_back_byte_for_byte_when_nothing_changed(string text)
    {
        var file = DayFile.Parse(text);

        Assert.Equal(text, file.Write(file.Content));
        // Also when the content has been through a copy, as it has when it comes back from the editor.
        Assert.Equal(text, file.Write(Copy(file.Content)));
    }

    [Fact]
    public void An_edit_leaves_every_other_item_exactly_as_it_was_typed()
    {
        const string text = """
            Preamble stays.

            # Todo
            * [X] hand written, odd markers   ^a
                deeply indented body
            - [ ] edit me ^b

            # Scratch
            anything at all

            # Notes
            ## Card

            body after a blank line
            """;
        var file = DayFile.Parse(text);
        var todo = file.Content.Todo.ToList();
        todo[1] = todo[1] with { Title = "edited" };

        var written = file.Write(file.Content with { Todo = todo });

        Assert.Equal("""
            Preamble stays.

            # Todo

            * [X] hand written, odd markers   ^a
                deeply indented body
            - [ ] edited ^b

            # Backlog

            # Notes

            ## Card

            body after a blank line

            # Scratch
            anything at all

            """, written);
    }

    [Fact]
    public void Line_endings_and_byte_order_mark_are_kept()
    {
        var text = (char)0xFEFF + "# Todo\r\n\r\n- [ ] one ^a\r\n";
        var file = DayFile.Parse(text);
        Assert.Equal("one", file.Content.Todo[0].Title);

        var written = file.Write(file.Content with { Todo = [.. file.Content.Todo, new TaskItem { Id = "b", Title = "two" }] });

        Assert.Equal((char)0xFEFF + "# Todo\r\n\r\n- [ ] one ^a\r\n- [ ] two ^b\r\n\r\n# Backlog\r\n\r\n# Notes\r\n", written);
    }

    [Fact]
    public void A_line_typed_into_a_task_section_by_hand_becomes_a_task()
    {
        var day = DayFile.Parse("# Todo\nremember the milk\n- bullet, no checkbox\n  with a body\n").Content;

        Assert.Equal(["remember the milk", "bullet, no checkbox"], day.Todo.Select(t => t.Title));
        Assert.Equal("with a body", day.Todo[1].Body);
        Assert.All(day.Todo, t => Assert.False(t.Done));
    }

    [Fact]
    public void Task_bodies_keep_blank_lines_nesting_and_fenced_code()
    {
        const string text = "# Todo\n\n- [ ] task ^a\n  first\n\n  - nested\n    - deeper\n  ```\n  # comment\n\n  code\n  ```\n- [ ] next ^b\n";
        var file = DayFile.Parse(text);

        Assert.Equal("first\n\n- nested\n  - deeper\n```\n# comment\n\ncode\n```", file.Content.Todo[0].Body);
        Assert.Equal("next", file.Content.Todo[1].Title);
        Assert.Equal(text + "\n# Backlog\n\n# Notes\n", DayFile.Empty.Write(file.Content));
    }

    [Theory]
    [InlineData("- [ ] Plain title", "", "Plain title")]
    [InlineData("- [ ] Title ^abc123", "abc123", "Title")]
    [InlineData("- [ ] ^abc123", "abc123", "")]
    [InlineData("- [ ]", "", "")]
    [InlineData("- [ ] Costs 2^10 bytes", "", "Costs 2^10 bytes")]
    [InlineData("- [ ] See [the docs](https://example.com) ^k1", "k1", "See [the docs](https://example.com)")]
    public void Reads_the_id_from_the_end_of_the_title_line(string line, string id, string title)
    {
        var task = DayFile.ParseTaskLine(line);

        Assert.Equal(id, task.Id);
        Assert.Equal(title, task.Title);
    }

    [Fact]
    public void Unknown_fields_survive_in_order()
    {
        var task = DayFile.ParseTaskLine("- [x] Title ^a [done:: 2026-11-16T08:40] [due:: friday]");

        Assert.Equal([new TaskField("done", "2026-11-16T08:40"), new TaskField("due", "friday")], task.Fields);
        Assert.Equal("- [x] Title ^a [done:: 2026-11-16T08:40] [due:: friday]", DayFormat.Task(task));
    }

    [Fact]
    public void A_note_body_line_that_looks_like_a_heading_cannot_split_the_card()
    {
        var content = new DayContent
        {
            Notes = [new NoteCard { Heading = "Card", Body = "## not a card\n# Todo\n```\n## inside code\n```" }],
        };

        var text = DayFile.Empty.Write(content);
        var card = Assert.Single(DayFile.Parse(text).Content.Notes);

        Assert.Equal("\\## not a card\n\\# Todo\n```\n## inside code\n```", card.Body);
        Assert.Empty(DayFile.Parse(text).Content.Todo);
    }

    [Fact]
    public void A_side_note_with_no_card_above_it_is_a_card()
    {
        var day = DayFile.Parse("# Notes\n### Orphan\nbody\n").Content;

        var card = Assert.Single(day.Notes);
        Assert.Equal("Orphan", card.Heading);
        Assert.Empty(card.Sides);
    }

    private static DayContent Copy(DayContent content) => new()
    {
        Todo = [.. content.Todo.Select(t => t with { Fields = [.. t.Fields] })],
        Backlog = [.. content.Backlog.Select(t => t with { Fields = [.. t.Fields] })],
        Notes = [.. content.Notes.Select(n => n with { Sides = [.. n.Sides.Select(s => s with { })] })],
    };
}

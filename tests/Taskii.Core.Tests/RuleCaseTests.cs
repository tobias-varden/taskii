using System.Text.Json;
using System.Text.Json.Nodes;
using Taskii.Core.Days;
using Taskii.Core.Search;

namespace Taskii.Core.Tests;

/// <summary>
/// The rules the page implements too, run on the cases shared with its rules.test.ts:
/// tests/rules/cases.json. Each case is passed as its JSON, so a failure names it.
/// </summary>
public class RuleCaseTests
{
    [Theory]
    [MemberData(nameof(Cases), "tag")]
    public void Tag(string json)
    {
        var c = JsonNode.Parse(json)!;
        Assert.Equal((string?)c["tag"], TaskTags.Of((string)c["title"]!));
    }

    [Theory]
    [MemberData(nameof(Cases), "blockers")]
    public void Blockers(string json)
    {
        var c = JsonNode.Parse(json)!;
        Assert.Equal(Strings(c["ids"]!), TaskFields.BlockersOf(TaskWith(c["fields"]!)));
    }

    [Theory]
    [MemberData(nameof(Cases), "doneAt")]
    public void DoneAt(string json)
    {
        var c = JsonNode.Parse(json)!;
        // C# parses the stamp where the page keeps the text, so compare it written back.
        Assert.Equal((string?)c["stamp"], TaskFields.DoneAt(TaskWith(c["fields"]!))?.ToString("yyyy-MM-dd'T'HH:mm"));
    }

    [Theory]
    [MemberData(nameof(Cases), "terms")]
    public void Terms(string json)
    {
        var c = JsonNode.Parse(json)!;
        Assert.Equal(Strings(c["terms"]!), SearchIndex.TermsOf((string)c["query"]!));
    }

    public static TheoryData<string> Cases(string rule)
    {
        var all = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "rules", "cases.json")))!;
        var data = new TheoryData<string>();
        // An entry with nothing but a "$comment" describes the list; it is not a case.
        foreach (var c in all[rule]!.AsArray())
        {
            if (c!.AsObject().Any(property => property.Key != "$comment"))
                data.Add(c.ToJsonString(new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        }

        return data;
    }

    private static TaskItem TaskWith(JsonNode fields) => new()
    {
        Title = "Task",
        Fields = fields.AsArray().Select(pair => new TaskField((string)pair![0]!, (string)pair[1]!)).ToList(),
    };

    private static string[] Strings(JsonNode list) => list.AsArray().Select(item => (string)item!).ToArray();
}

using System.Text.Json;
using System.Text.RegularExpressions;

namespace Taskii.Host.Tests;

/// <summary>
/// Holds the bridge to the Requests interface in src/web/src/host.ts, so a request or a
/// payload field changed on one side only fails here instead of in the running app.
/// </summary>
public sealed partial class ProtocolTests : IDisposable
{
    private static readonly string Web = Path.Combine(RepoRoot(), "src", "web", "src");

    private readonly BridgeFixture _host = new(new DateTime(2026, 11, 13, 10, 0, 0));

    public void Dispose() => _host.Dispose();

    /// <summary>What the page can send, and the payload fields of each: null for none.</summary>
    private static readonly Dictionary<string, SortedSet<string>?> PageRequests = ReadPageRequests();

    private Dictionary<string, Type?> Answered() =>
        _host.Bridge.Requests.Concat(WindowRequests.All).ToDictionary(r => r.Key, r => r.Value);

    [Fact]
    public void The_page_has_requests_to_check() =>
        Assert.True(PageRequests.Count > 10, $"Read only {PageRequests.Count} requests from host.ts; has its layout changed?");

    [Fact]
    public void Every_request_the_page_sends_is_answered() =>
        Assert.Empty(PageRequests.Keys.Except(Answered().Keys).Order());

    [Fact]
    public void Every_request_answered_is_one_the_page_sends() =>
        Assert.Empty(Answered().Keys.Except(PageRequests.Keys).Order());

    [Fact]
    public void A_request_is_answered_by_the_bridge_or_a_window_not_both() =>
        Assert.Empty(_host.Bridge.Requests.Keys.Intersect(WindowRequests.All.Keys));

    [Fact]
    public void Each_payload_has_the_fields_the_page_sends()
    {
        var answered = Answered();
        var wrong = new List<string>();
        foreach (var (type, fields) in PageRequests)
        {
            if (!answered.TryGetValue(type, out var payload)) continue;

            var expected = fields is null ? "none" : string.Join(", ", fields);
            var actual = payload is null ? "none" : string.Join(", ", FieldsOf(payload));
            if (expected != actual) wrong.Add($"{type}: the page sends {expected}, the shell reads {actual}");
        }

        Assert.Empty(wrong);
    }

    private static SortedSet<string> FieldsOf(Type record) =>
        new(record.GetConstructors().Single().GetParameters().Select(p => JsonNamingPolicy.CamelCase.ConvertName(p.Name!)), StringComparer.Ordinal);

    private static Dictionary<string, SortedSet<string>?> ReadPageRequests()
    {
        var host = File.ReadAllText(Path.Combine(Web, "host.ts"));
        var types = File.ReadAllText(Path.Combine(Web, "types.ts"));

        var body = InterfaceBody(host, "Requests");
        return RequestLine().Matches(body).ToDictionary(
            m => m.Groups["name"].Value,
            m => m.Groups["payload"].Value.Trim() switch
            {
                "undefined" => null,
                var inline when inline.StartsWith('{') => Fields(inline),
                var named => Fields(InterfaceBody(types, named)),
            });
    }

    private static string InterfaceBody(string source, string name)
    {
        var match = Regex.Match(source, $@"interface {name}\s*\{{(?<body>.*?)\n\}}", RegexOptions.Singleline);
        Assert.True(match.Success, $"There is no interface {name} in the web sources.");
        return match.Groups["body"].Value;
    }

    private static SortedSet<string> Fields(string body) =>
        new(FieldName().Matches(StripComments(body)).Select(m => m.Groups[1].Value), StringComparer.Ordinal);

    private static string StripComments(string source) => Regex.Replace(source, @"/\*.*?\*/|//[^\n]*", "", RegexOptions.Singleline);

    private static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "Taskii.slnx"))) return dir.FullName;
        }

        throw new InvalidOperationException("Cannot find the repository from " + AppContext.BaseDirectory);
    }

    // One request per line: `name: { payload: ...; result: ... };`
    [GeneratedRegex(@"^\s*(?<name>\w+): \{ payload: (?<payload>.+?); result: ", RegexOptions.Multiline)]
    private static partial Regex RequestLine();

    // A field at the top of an object type: `name: ...` or `name?: ...`, after `{`, `;` or a line start.
    [GeneratedRegex(@"(?:^|[{;])\s*(\w+)\??:", RegexOptions.Multiline)]
    private static partial Regex FieldName();
}

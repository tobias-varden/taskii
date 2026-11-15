using System.Text.RegularExpressions;

namespace Taskii.Core.Days;

/// <summary>
/// The tag of a task is the text before the first colon in its title: "ACME" in
/// "ACME: Fix users". The same rule as tagOf in the page's task.ts; the cases both are
/// tested on are in tests/rules/cases.json.
/// </summary>
public static partial class TaskTags
{
    public static string? Of(string title)
    {
        var match = Tag().Match(title);
        if (!match.Success) return null;

        var tag = match.Groups[1].Value;
        // "https://..." is a link, not a tag called "https".
        return tag.EndsWith("http", StringComparison.OrdinalIgnoreCase) || tag.EndsWith("https", StringComparison.OrdinalIgnoreCase) ? null : tag;
    }

    [GeneratedRegex(@"^([^\s:][^:]{0,23}):(?= |$)")]
    private static partial Regex Tag();
}

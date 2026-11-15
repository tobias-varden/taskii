using System.Text.RegularExpressions;

namespace Taskii.Core.Search;

/// <summary>
/// The tickets a piece of text mentions, in one form however they were written, so that a
/// pasted GitHub link and a typed <c>widget-service#413</c> are the same ticket.
/// <para>
/// A GitHub issue or pull request is <c>repo#123</c>, an Azure DevOps work item is
/// <c>AB#123</c> and an Azure DevOps pull request is <c>repo!123</c>. A bare <c>#123</c> says
/// nothing about where it lives and is not a ticket.
/// </para>
/// </summary>
public static partial class TicketRefs
{
    public static IReadOnlyList<string> In(string text)
    {
        var found = new List<string>();
        void Add(string ticket)
        {
            if (!found.Contains(ticket, StringComparer.OrdinalIgnoreCase)) found.Add(ticket);
        }

        foreach (Match match in GitHub().Matches(text)) Add($"{match.Groups[1].Value.ToLowerInvariant()}#{match.Groups[2].Value}");
        foreach (Match match in WorkItem().Matches(text)) Add($"AB#{match.Groups[1].Value}");
        foreach (Match match in AzurePullRequest().Matches(text)) Add($"{Uri.UnescapeDataString(match.Groups[1].Value).ToLowerInvariant()}!{match.Groups[2].Value}");
        foreach (Match match in Short().Matches(text))
        {
            var name = match.Groups[1].Value;
            Add(name.Equals("AB", StringComparison.OrdinalIgnoreCase) ? $"AB#{match.Groups[2].Value}" : $"{name.ToLowerInvariant()}#{match.Groups[2].Value}");
        }

        return found;
    }

    [GeneratedRegex(@"https?://github\.com/[\w.-]+/([\w.-]+)/(?:pull|issues)/(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex GitHub();

    [GeneratedRegex(@"https?://(?:dev\.azure\.com|[\w-]+\.visualstudio\.com)/[^\s()]*?_workitems/edit/(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex WorkItem();

    [GeneratedRegex(@"https?://(?:dev\.azure\.com|[\w-]+\.visualstudio\.com)/[^\s()]*?_git/([\w.%-]+)/pullrequest/(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex AzurePullRequest();

    // Not part of a URL or a longer word: "issues/#12" and "a/b#3" are something else.
    [GeneratedRegex(@"(?<![\w/#.-])([A-Za-z](?:[\w.-]*\w)?)#(\d+)\b")]
    private static partial Regex Short();
}

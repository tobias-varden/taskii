using System.Globalization;
using System.Text;

namespace Taskii.Core.Days;

/// <summary>A finished standup: when, and what the day looked like at that moment.</summary>
public sealed record Standup(DateTime At, DayContent Content);

/// <summary>
/// The standups that have been finished. Each is a copy of the day file as it was at that
/// moment, kept in the <c>standups</c> folder beside the days and named by the time, such as
/// <c>2026-11-16T0915.md</c>. That one file says when done tasks were last reported and what
/// "new since the last standup" is compared against, and it syncs like everything else.
/// </summary>
public sealed class StandupLog(string root)
{
    private const string NameFormat = "yyyy-MM-dd'T'HHmm";
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    public string Folder { get; } = Path.Combine(Path.GetFullPath(root), "standups");

    /// <summary>The last standup that was finished. Null if there has been none.</summary>
    public Standup? Latest()
    {
        // Newest first; one that cannot be read at this moment is passed over rather than failing.
        foreach (var at in Times().OrderByDescending(at => at))
        {
            try
            {
                return new Standup(at, DayFile.Parse(File.ReadAllText(PathFor(at), Utf8)).Content);
            }
            catch (IOException)
            {
            }
        }

        return null;
    }

    /// <summary>When the last standup before <paramref name="moment"/> was finished. Local time.</summary>
    public DateTime? LatestBefore(DateTime moment)
    {
        DateTime? latest = null;
        foreach (var at in Times())
        {
            if (at < moment && (latest is null || at > latest)) latest = at;
        }

        return latest;
    }

    /// <summary>Records a standup finished at <paramref name="now"/>, local time.</summary>
    /// <param name="dayText">The day file as it is at this moment.</param>
    /// <returns>
    /// The time that was recorded: the start of the minute, as precise as the time on a done
    /// task. A task checked off in the same minute then counts as not reported yet, and is
    /// shown once more rather than being dropped unseen.
    /// </returns>
    public DateTime Finish(DateTime now, string dayText)
    {
        var at = new DateTime(now.Year, now.Month, now.Day, now.Hour, now.Minute, 0);
        Directory.CreateDirectory(Folder);

        var path = PathFor(at);
        var temp = path + ".tmp";
        File.WriteAllText(temp, dayText, Utf8);
        File.Move(temp, path, overwrite: true);
        return at;
    }

    private string PathFor(DateTime at) => Path.Combine(Folder, at.ToString(NameFormat, CultureInfo.InvariantCulture) + ".md");

    private IEnumerable<DateTime> Times()
    {
        if (!Directory.Exists(Folder)) yield break;
        foreach (var file in Directory.EnumerateFiles(Folder, "*.md"))
        {
            // Exact names only, so a conflict copy such as "2026-11-16T0915-LAPTOP.md" is not a standup.
            if (DateTime.TryParseExact(Path.GetFileNameWithoutExtension(file), NameFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at))
            {
                yield return at;
            }
        }
    }
}

using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Taskii.Core.Days;

/// <summary>A day as it is on disk right now, or as it would start if it has no file yet.</summary>
/// <param name="Exists">Whether the day has a file.</param>
/// <param name="Version">
/// Fingerprint of what the day is based on: its own file, or for a day carried forward, the
/// file it was carried from. Empty when there is neither.
/// </param>
/// <param name="CarriedFrom">The day this one was carried from, when it has no file of its own.</param>
public sealed record DaySnapshot(DateOnly Date, bool Exists, string Version, DayFile File, DateOnly? CarriedFrom = null);

public enum SaveStatus
{
    /// <summary>The file was written.</summary>
    Saved,

    /// <summary>The content is what the file already holds. Nothing was written.</summary>
    Unchanged,

    /// <summary>The file changed on disk since it was loaded. Nothing was written.</summary>
    Conflict,
}

public sealed record SaveResult(SaveStatus Status, string Version);

/// <summary>
/// Reads and writes day files in the data folder, laid out as <c>yyyy/MM/yyyy-MM-dd.md</c>.
/// </summary>
public sealed class DayStore(string root)
{
    private const string DateFormat = "yyyy-MM-dd";
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    public string Root { get; } = Path.GetFullPath(root);

    /// <summary>The standups finished in this data folder.</summary>
    public StandupLog Standups { get; } = new(root);

    public string PathFor(DateOnly date) => Path.Combine(
        Root,
        date.Year.ToString("0000", CultureInfo.InvariantCulture),
        date.Month.ToString("00", CultureInfo.InvariantCulture),
        date.ToString(DateFormat, CultureInfo.InvariantCulture) + ".md");

    /// <summary>Reads a day.</summary>
    /// <param name="carry">
    /// When the day has no file, show it as it would start: carried forward from the most
    /// recent day before it. Nothing is written until it is edited.
    /// </param>
    public DaySnapshot Load(DateOnly date, bool carry = false)
    {
        if (ReadBytes(PathFor(date)) is { } bytes) return new DaySnapshot(date, true, VersionOf(bytes), Parse(bytes));
        if (!carry) return new DaySnapshot(date, false, "", DayFile.Empty);

        var start = StartOf(date);
        return new DaySnapshot(date, false, start.Version, start.File, start.From);
    }

    /// <summary>The version <see cref="Load"/> would report, without parsing anything.</summary>
    public string VersionOf(DateOnly date, bool carry = false)
    {
        if (ReadBytes(PathFor(date)) is { } bytes) return VersionOf(bytes);
        return carry && LatestBefore(date) is { } from && ReadBytes(PathFor(from)) is { } source ? CarriedVersion(source, ReportedBefore(date)) : "";
    }

    /// <summary>
    /// Writes <paramref name="content"/> to the day's file. A day that has no file yet starts
    /// from the most recent day before it, and gets its file only if the content differs from
    /// that starting point: looking at a new day never creates it.
    /// </summary>
    /// <param name="baseVersion">The version the edits were made on top of.</param>
    /// <param name="overwrite">Write even when the day has changed since <paramref name="baseVersion"/>.</param>
    public SaveResult Save(DateOnly date, DayContent content, string baseVersion, bool overwrite = false)
    {
        var path = PathFor(date);
        var bytes = ReadBytes(path);
        var start = bytes is null ? StartOf(date) : default;
        var version = bytes is null ? start.Version : VersionOf(bytes);

        if (version != baseVersion && !overwrite) return new SaveResult(SaveStatus.Conflict, version);

        // Writing on top of the day's own file, or of the day it is carried from, keeps
        // everything that was not edited exactly as it was typed.
        var file = bytes is null ? start.File : Parse(bytes);
        var text = file.Write(content);
        if (ReferenceEquals(text, file.Text)) return new SaveResult(SaveStatus.Unchanged, version);

        var newBytes = Utf8.GetBytes(text);
        WriteAtomically(path, newBytes);
        return new SaveResult(SaveStatus.Saved, VersionOf(newBytes));
    }

    /// <summary>
    /// Applies a change to a day as it is on disk right now, starting it from the previous day
    /// if it has no file yet. Used for edits that do not come from the editor.
    /// </summary>
    /// <param name="edit">Returns the new content, or null to leave the day alone.</param>
    /// <returns>Whether the day was changed.</returns>
    public bool Update(DateOnly date, Func<DayContent, DayContent?> edit)
    {
        // If something else writes the file in between, read it again and reapply.
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var snapshot = Load(date, carry: true);
            if (edit(snapshot.File.Content) is not { } content) return false;

            var result = Save(date, content, snapshot.Version);
            if (result.Status != SaveStatus.Conflict) return result.Status == SaveStatus.Saved;
        }

        throw new IOException("The day kept changing on disk while it was being updated.");
    }

    /// <summary>The most recent day with a file before <paramref name="date"/>.</summary>
    public DateOnly? LatestBefore(DateOnly date)
    {
        // Newest folders first, so this stays quick however many years of days there are.
        foreach (var year in NumberedFolders(Root, 4).Where(y => y.Number <= date.Year).OrderByDescending(y => y.Number))
        {
            foreach (var month in NumberedFolders(year.Path, 2).OrderByDescending(m => m.Number))
            {
                var days = DaysIn(month.Path).Where(day => day < date).ToList();
                if (days.Count > 0) return days.Max();
            }
        }

        return null;
    }

    /// <summary>How a day with no file starts: the previous day's file, minus what does not carry.</summary>
    private (DayFile File, string Version, DateOnly? From) StartOf(DateOnly date)
    {
        if (LatestBefore(date) is not { } from || ReadBytes(PathFor(from)) is not { } bytes) return (DayFile.Empty, "", null);

        var source = Parse(bytes);
        var standup = ReportedBefore(date);
        var carried = DayFile.Parse(source.Write(DayCarry.Forward(source.Content, standup)));
        return (carried, CarriedVersion(bytes, standup), from);
    }

    /// <summary>
    /// The standup that decides which done tasks a day starts without: the last one finished
    /// before the day began. A standup finished during the day takes nothing away from it, so
    /// what was reported this morning stays in sight, struck through, until tomorrow.
    /// </summary>
    private DateTime? ReportedBefore(DateOnly date) => Standups.LatestBefore(date.ToDateTime(TimeOnly.MinValue));

    private static DayFile Parse(byte[] bytes) => DayFile.Parse(Utf8.GetString(bytes));

    // Marked, so "based on Friday's file" can never be mistaken for "is Friday's file". What
    // is carried also depends on the last standup, so that is part of it.
    private static string CarriedVersion(byte[] source, DateTime? standup) =>
        "~" + VersionOf(source) + (standup is { } at ? "@" + at.ToString("yyyyMMddHHmm", CultureInfo.InvariantCulture) : "");

    /// <summary>Every day that has a file, oldest first.</summary>
    public IReadOnlyList<DateOnly> ListDays()
    {
        var days = NumberedFolders(Root, 4)
            .SelectMany(year => NumberedFolders(year.Path, 2))
            .SelectMany(month => DaysIn(month.Path))
            .ToList();
        days.Sort();
        return days;
    }

    private static IEnumerable<(string Path, int Number)> NumberedFolders(string parent, int digits)
    {
        if (!Directory.Exists(parent)) yield break;
        foreach (var folder in Directory.EnumerateDirectories(parent))
        {
            var name = Path.GetFileName(folder);
            if (name.Length == digits && name.All(char.IsAsciiDigit)) yield return (folder, int.Parse(name, CultureInfo.InvariantCulture));
        }
    }

    private IEnumerable<DateOnly> DaysIn(string month)
    {
        foreach (var file in Directory.EnumerateFiles(month, "*.md"))
        {
            // Exact names in the right folder only, so conflict copies such as
            // "2026-11-13-LAPTOP.md" are not days.
            if (DateOnly.TryParseExact(Path.GetFileNameWithoutExtension(file), DateFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
                && string.Equals(file, PathFor(date), StringComparison.OrdinalIgnoreCase))
            {
                yield return date;
            }
        }
    }

    private static string VersionOf(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes), 0, 8);

    private static byte[]? ReadBytes(string path)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return File.ReadAllBytes(path);
            }
            catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
            {
                return null;
            }
            catch (IOException) when (attempt < 4)
            {
                // A sync client can hold the file for a moment.
                Thread.Sleep(40 * (attempt + 1));
            }
        }
    }

    /// <summary>
    /// Writes beside the target and renames over it, so neither a crash nor a sync client can
    /// ever see a half-written day.
    /// </summary>
    private static void WriteAtomically(string path, byte[] bytes)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";

        for (var attempt = 0; ; attempt++)
        {
            try
            {
                using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    stream.Write(bytes);
                    stream.Flush(flushToDisk: true);
                }

                File.Move(temp, path, overwrite: true);
                return;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException && attempt < 4)
            {
                Thread.Sleep(40 * (attempt + 1));
            }
        }
    }
}

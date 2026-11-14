using System.Text.Json;

namespace Taskii.App;

public sealed class AppSettings
{
    /// <summary>Where the day files live. Null until the user has chosen.</summary>
    public string? DataFolder { get; set; }

    public WindowPlacement? Window { get; set; }
}

/// <summary>Window position and size in physical pixels.</summary>
public sealed record WindowPlacement(int X, int Y, int Width, int Height, bool Maximized);

/// <summary>
/// Settings that belong to this machine, kept under the user's local application data and
/// never in the synced data folder.
/// </summary>
public sealed class SettingsStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public SettingsStore()
    {
        Current = Load();
    }

    /// <summary>
    /// The folder for settings, the log and the browser profile. TASKII_HOME moves it, which
    /// lets a development copy run beside the real one without sharing anything.
    /// </summary>
    public static string Home { get; } = Path.GetFullPath(
        Environment.GetEnvironmentVariable("TASKII_HOME") is { Length: > 0 } home
            ? home
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Taskii"));

    private static string FilePath => Path.Combine(Home, "settings.json");

    public AppSettings Current { get; }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Home);
            var temp = FilePath + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(Current, Json));
            File.Move(temp, FilePath, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Log.Write("Could not save settings", e);
        }
    }

    private static AppSettings Load()
    {
        try
        {
            return File.Exists(FilePath) ? JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath), Json) ?? new() : new();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            Log.Write("Could not read settings", e);
            return new();
        }
    }
}

using System.Text.Json;
using Taskii.Core;

namespace Taskii.App;

public sealed class AppSettings
{
    /// <summary>Where the day files live. Null until the user has chosen.</summary>
    public string? DataFolder { get; set; }

    public WindowPlacement? Window { get; set; }

    public HotkeySettings Hotkeys { get; set; } = new();

    /// <summary>Whether the note that Taskii keeps running in the notification area has been shown.</summary>
    public bool TrayHintShown { get; set; }
}

/// <summary>Global keyboard shortcuts, written like "Win+Shift+N". An empty one is switched off.</summary>
public sealed class HotkeySettings
{
    /// <summary>Opens the quick capture bar over whatever is on screen.</summary>
    public string Capture { get; set; } = "Win+Shift+N";

    /// <summary>Opens the main window.</summary>
    public string Open { get; set; } = "Win+Shift+J";
}

/// <summary>Window position and size in physical pixels.</summary>
public sealed record WindowPlacement(int X, int Y, int Width, int Height, bool Maximized);

/// <summary>
/// Settings that belong to this machine, kept under the user's local application data and
/// never in the synced data folder.
/// </summary>
public sealed class SettingsStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        // The file is meant to be edited by hand: "Win+Shift+N", not "Win+Shift+N".
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public SettingsStore()
    {
        Current = Load();
    }

    /// <summary>The folder for settings, the log and the browser profile.</summary>
    public static string Home => TaskiiHome.Folder;

    private static string FilePath => TaskiiHome.SettingsFile;

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

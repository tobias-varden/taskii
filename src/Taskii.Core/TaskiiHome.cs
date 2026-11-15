namespace Taskii.Core;

/// <summary>
/// The folder for what belongs to this machine: settings, the log, caches. Never the synced
/// data folder. TASKII_HOME moves it, which lets a development copy run beside the real one
/// without sharing anything.
/// </summary>
public static class TaskiiHome
{
    public static string Folder { get; } = Path.GetFullPath(
        Environment.GetEnvironmentVariable("TASKII_HOME") is { Length: > 0 } home
            ? home
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Taskii"));

    public static string SettingsFile => Path.Combine(Folder, "settings.json");
}

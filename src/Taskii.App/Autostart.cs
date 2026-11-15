using Microsoft.Win32;

namespace Taskii.App;

/// <summary>
/// Starting Taskii with Windows, in the background, so quick capture is there from sign-in.
/// This is the per-user Run entry, the same thing the Startup apps list in Settings shows.
/// </summary>
internal static class Autostart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Name = "Taskii";

    /// <summary>The argument that starts Taskii without opening its window.</summary>
    public const string BackgroundArgument = "--background";

    /// <summary>The argument that opens the quick capture bar instead of the main window.</summary>
    public const string CaptureArgument = "--capture";

    /// <summary>The argument that asks a running Taskii to save and exit.</summary>
    public const string ExitArgument = "--exit";

    public static bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(Name) is string command
                && Environment.ProcessPath is { } path
                && command.Contains(path, StringComparison.OrdinalIgnoreCase);
        }
    }

    public static void Set(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (enabled && Environment.ProcessPath is { } path) key.SetValue(Name, $"\"{path}\" {BackgroundArgument}");
            else key.DeleteValue(Name, throwOnMissingValue: false);
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException or System.Security.SecurityException)
        {
            Log.Write("Could not change start with Windows", e);
        }
    }
}

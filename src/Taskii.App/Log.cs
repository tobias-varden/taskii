namespace Taskii.App;

/// <summary>A small log beside the settings, for the day something goes wrong.</summary>
public static class Log
{
    private static readonly Lock Gate = new();

    public static string FilePath => Path.Combine(SettingsStore.Home, "taskii.log");

    public static void Write(string message, Exception? exception = null)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(SettingsStore.Home);
                var file = new FileInfo(FilePath);
                if (file.Exists && file.Length > 1_000_000) file.Delete();
                File.AppendAllText(FilePath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{(exception is null ? "" : Environment.NewLine + exception)}{Environment.NewLine}");
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Logging must never be the thing that fails.
        }
    }
}

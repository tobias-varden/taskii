namespace Taskii.Host;

/// <summary>What the bridge needs from the windows and the desktop around them.</summary>
public interface IShell
{
    /// <summary>Asks the user for a folder. Null if they cancelled.</summary>
    Task<string?> PickFolderAsync();

    /// <summary>Opens a web link in the browser. The bridge has already checked it is one.</summary>
    void OpenLink(Uri url);

    /// <summary>Shows a folder in Explorer.</summary>
    void OpenFolder(string path);
}

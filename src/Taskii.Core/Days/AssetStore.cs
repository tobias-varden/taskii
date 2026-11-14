using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Taskii.Core.Days;

/// <summary>
/// Pasted images, kept in the <c>assets</c> folder beside the days. A file is named by a hash
/// of its content, so the same image is stored once however many days and notes refer to it,
/// and carrying a note forward copies only the reference.
/// </summary>
public sealed partial class AssetStore(string root)
{
    public const string FolderName = "assets";

    /// <summary>Hex characters of the hash used in a file name: enough to be unique, short enough to read.</summary>
    private const int NameLength = 10;

    private static readonly Dictionary<string, string> ExtensionOf = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = "png",
        ["image/jpeg"] = "jpg",
        ["image/gif"] = "gif",
        ["image/webp"] = "webp",
        ["image/bmp"] = "bmp",
    };

    public string Folder { get; } = Path.Combine(Path.GetFullPath(root), FolderName);

    public static bool IsSupported(string mediaType) => ExtensionOf.ContainsKey(mediaType);

    /// <summary>The media type for a stored file's name, for serving it back.</summary>
    public static string MediaTypeOf(string name)
    {
        var extension = Path.GetExtension(name).TrimStart('.');
        return ExtensionOf.FirstOrDefault(pair => pair.Value.Equals(extension, StringComparison.OrdinalIgnoreCase)).Key ?? "application/octet-stream";
    }

    /// <summary>
    /// Stores an image and returns its path relative to the data folder, with forward slashes
    /// as it is written in markdown: <c>assets/3fa9c1d2e7.png</c>.
    /// </summary>
    public string Save(byte[] bytes, string mediaType)
    {
        if (!ExtensionOf.TryGetValue(mediaType, out var extension)) throw new NotSupportedException($"Taskii cannot store {mediaType} images.");
        if (bytes.Length == 0) throw new ArgumentException("The image is empty.", nameof(bytes));

        var hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
        Directory.CreateDirectory(Folder);

        // In the unlikely event that a different image already has the short name, use a longer one.
        for (var length = NameLength; ; length = hash.Length)
        {
            var name = $"{hash[..length]}.{extension}";
            var path = Path.Combine(Folder, name);

            if (!File.Exists(path))
            {
                var temp = path + ".tmp";
                File.WriteAllBytes(temp, bytes);
                File.Move(temp, path, overwrite: true);
                return $"{FolderName}/{name}";
            }

            if (length == hash.Length || File.ReadAllBytes(path).AsSpan().SequenceEqual(bytes)) return $"{FolderName}/{name}";
        }
    }

    /// <summary>Reads a stored image by file name. Null if there is none, or the name is not one this store writes.</summary>
    public byte[]? Read(string name)
    {
        if (!AssetName().IsMatch(name)) return null;

        try
        {
            return File.ReadAllBytes(Path.Combine(Folder, name));
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
    }

    // Exactly the names Save produces. Nothing with a path in it can get through.
    [GeneratedRegex(@"^[0-9a-f]{10,64}\.(png|jpg|gif|webp|bmp)$")]
    private static partial Regex AssetName();
}

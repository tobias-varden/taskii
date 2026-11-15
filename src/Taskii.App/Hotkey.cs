namespace Taskii.App;

/// <summary>A global keyboard shortcut such as "Win+Shift+N", as written in settings.json.</summary>
public readonly record struct Hotkey(uint Modifiers, uint Key, string Text)
{
    private const uint Alt = 0x1;
    private const uint Control = 0x2;
    private const uint Shift = 0x4;
    private const uint Win = 0x8;

    /// <summary>Reads a shortcut. Null if it is not one: it needs at least one modifier and exactly one key.</summary>
    public static Hotkey? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;

        uint modifiers = 0;
        uint key = 0;
        var keyName = "";

        foreach (var part in text.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            switch (part.ToLowerInvariant())
            {
                case "alt": modifiers |= Alt; break;
                case "ctrl" or "control": modifiers |= Control; break;
                case "shift": modifiers |= Shift; break;
                case "win" or "windows": modifiers |= Win; break;
                default:
                    if (key != 0 || KeyCode(part) is not { } code) return null;
                    key = code;
                    keyName = part.Length == 1 ? part.ToUpperInvariant() : char.ToUpperInvariant(part[0]) + part[1..].ToLowerInvariant();
                    break;
            }
        }

        if (modifiers == 0 || key == 0) return null;

        // Written back the way shortcuts usually are, whatever order they were typed in.
        var names = new List<string>();
        if ((modifiers & Control) != 0) names.Add("Ctrl");
        if ((modifiers & Win) != 0) names.Add("Win");
        if ((modifiers & Alt) != 0) names.Add("Alt");
        if ((modifiers & Shift) != 0) names.Add("Shift");
        names.Add(keyName);
        return new Hotkey(modifiers, key, string.Join('+', names));
    }

    private static uint? KeyCode(string name)
    {
        if (name.Length == 1 && char.IsAsciiLetterOrDigit(name[0])) return char.ToUpperInvariant(name[0]);
        if (name.Equals("space", StringComparison.OrdinalIgnoreCase)) return 0x20;
        if (name.Length is 2 or 3 && name[0] is 'f' or 'F' && int.TryParse(name[1..], out var number) && number is >= 1 and <= 12) return (uint)(0x70 + number - 1);
        return null;
    }
}

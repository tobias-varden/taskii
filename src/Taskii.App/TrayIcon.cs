using System.Runtime.InteropServices;

namespace Taskii.App;

/// <summary>An entry in the tray menu. A null <see cref="Text"/> is a separator.</summary>
public sealed record TrayItem(string? Text, Action? Click = null, Func<bool>? IsChecked = null, bool IsDefault = false)
{
    public static TrayItem Separator { get; } = new((string?)null);
}

/// <summary>
/// The icon in the notification area, and the global hotkeys. Both need a plain Win32 window
/// to receive their messages, which WinUI does not provide, so this owns a hidden one.
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private const int CallbackMessage = 0x8000 + 1;
    private const int WmHotkey = 0x0312;
    private const int WmLeftButtonUp = 0x0202;
    private const int WmLeftButtonDoubleClick = 0x0203;
    private const int WmRightButtonUp = 0x0205;
    private const int WmNull = 0x0000;

    private const int NimAdd = 0, NimModify = 1, NimDelete = 2;
    private const int NifMessage = 0x1, NifIcon = 0x2, NifTip = 0x4, NifInfo = 0x10;
    private const uint ModNoRepeat = 0x4000;

    // Kept in a field: the window procedure must not be collected while the window exists.
    private readonly WindowProcedure _procedure;
    private readonly IntPtr _window;
    private readonly IntPtr _icon;
    private readonly uint _taskbarCreated;
    private readonly string _tip;
    private readonly Func<IReadOnlyList<TrayItem>> _menu;
    private readonly Dictionary<int, Action> _hotkeys = [];
    private bool _added;

    public TrayIcon(string iconPath, string tip, Func<IReadOnlyList<TrayItem>> menu)
    {
        _tip = tip;
        _menu = menu;
        _procedure = Procedure;

        var instance = GetModuleHandleW(null);
        var windowClass = new WindowClass
        {
            Size = Marshal.SizeOf<WindowClass>(),
            Procedure = Marshal.GetFunctionPointerForDelegate(_procedure),
            Instance = instance,
            ClassName = "TaskiiTray" + Environment.ProcessId,
        };
        RegisterClassExW(ref windowClass);
        _window = CreateWindowExW(0, windowClass.ClassName, "Taskii", 0, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);

        var size = GetSystemMetrics(49 /* small icon width */);
        _icon = LoadImageW(IntPtr.Zero, iconPath, 1 /* icon */, size, size, 0x10 /* from file */);

        // Explorer announces itself with this when it restarts; the icon has to be put back.
        _taskbarCreated = RegisterWindowMessageW("TaskbarCreated");
        Add();
    }

    /// <summary>What a click on the icon does.</summary>
    public Action? Activated { get; set; }

    /// <summary>Registers a global hotkey. False if something else already has it.</summary>
    public bool Register(Hotkey hotkey, Action action)
    {
        var id = _hotkeys.Count + 1;
        if (!RegisterHotKey(_window, id, hotkey.Modifiers | ModNoRepeat, hotkey.Key)) return false;
        _hotkeys[id] = action;
        return true;
    }

    /// <summary>Shows a notification from the icon.</summary>
    public void Notify(string title, string text)
    {
        var data = Data(NifInfo);
        data.Info = text;
        data.InfoTitle = title;
        Shell_NotifyIconW(NimModify, ref data);
    }

    public void Dispose()
    {
        foreach (var id in _hotkeys.Keys) UnregisterHotKey(_window, id);
        _hotkeys.Clear();

        if (_added)
        {
            var data = Data(0);
            Shell_NotifyIconW(NimDelete, ref data);
            _added = false;
        }

        DestroyWindow(_window);
        if (_icon != IntPtr.Zero) DestroyIcon(_icon);
    }

    private void Add()
    {
        var data = Data(NifMessage | NifIcon | NifTip);
        _added = Shell_NotifyIconW(NimAdd, ref data);
    }

    private NotifyIconData Data(int flags) => new()
    {
        Size = Marshal.SizeOf<NotifyIconData>(),
        Window = _window,
        Id = 1,
        Flags = flags,
        CallbackMessage = CallbackMessage,
        Icon = _icon,
        Tip = _tip,
        Info = "",
        InfoTitle = "",
    };

    private IntPtr Procedure(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (message == WmHotkey)
            {
                if (_hotkeys.TryGetValue((int)wParam, out var action)) action();
                return IntPtr.Zero;
            }

            if (message == CallbackMessage)
            {
                switch ((int)lParam & 0xFFFF)
                {
                    case WmLeftButtonUp or WmLeftButtonDoubleClick: Activated?.Invoke(); break;
                    case WmRightButtonUp: ShowMenu(); break;
                }

                return IntPtr.Zero;
            }

            if (message == _taskbarCreated && _taskbarCreated != 0) Add();
        }
        catch (Exception e)
        {
            Log.Write("Tray", e);
        }

        return DefWindowProcW(window, message, wParam, lParam);
    }

    private void ShowMenu()
    {
        var items = _menu();
        var menu = CreatePopupMenu();
        try
        {
            for (var i = 0; i < items.Count; i++)
            {
                var item = items[i];
                if (item.Text is null)
                {
                    AppendMenuW(menu, 0x800 /* separator */, 0, null);
                    continue;
                }

                AppendMenuW(menu, item.IsChecked?.Invoke() == true ? 0x8u /* checked */ : 0, (uint)(i + 1), item.Text);
                if (item.IsDefault) SetMenuDefaultItem(menu, (uint)(i + 1), 0);
            }

            Native.GetCursorPos(out var point);
            // Without this the menu does not close when the user clicks elsewhere.
            Native.SetForegroundWindow(_window);
            var chosen = TrackPopupMenuEx(menu, 0x100 /* return the command */ | 0x2 /* right button too */, point.X, point.Y, _window, IntPtr.Zero);
            PostMessageW(_window, WmNull, IntPtr.Zero, IntPtr.Zero);

            if (chosen > 0 && chosen <= items.Count) items[chosen - 1].Click?.Invoke();
        }
        finally
        {
            DestroyMenu(menu);
        }
    }

    private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WindowClass
    {
        public int Size;
        public uint Style;
        public IntPtr Procedure;
        public int ClassExtra;
        public int WindowExtra;
        public IntPtr Instance;
        public IntPtr Icon;
        public IntPtr Cursor;
        public IntPtr Background;
        public string? MenuName;
        public string ClassName;
        public IntPtr SmallIcon;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public int Size;
        public IntPtr Window;
        public int Id;
        public int Flags;
        public int CallbackMessage;
        public IntPtr Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip;
        public int State;
        public int StateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Info;
        public int Version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string InfoTitle;
        public int InfoFlags;
        public Guid Item;
        public IntPtr BalloonIcon;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandleW(string? name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassExW(ref WindowClass windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowExW(uint exStyle, string className, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProcW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyWindow(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessageW(string name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImageW(IntPtr instance, string name, uint type, int width, int height, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr icon);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Shell_NotifyIconW(int message, ref NotifyIconData data);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnregisterHotKey(IntPtr window, int id);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AppendMenuW(IntPtr menu, uint flags, uint id, string? text);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetMenuDefaultItem(IntPtr menu, uint item, uint byPosition);

    [DllImport("user32.dll")]
    private static extern int TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr window, IntPtr parameters);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyMenu(IntPtr menu);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}

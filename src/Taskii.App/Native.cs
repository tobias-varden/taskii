using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;

namespace Taskii.App;

/// <summary>The handful of Win32 calls the windows need.</summary>
internal static class Native
{
    public static IntPtr HandleOf(Window window) => WinRT.Interop.WindowNative.GetWindowHandle(window);

    /// <summary>Physical pixels per device-independent pixel on the screen the window is on.</summary>
    public static double ScaleOf(Window window) => GetDpiForWindow(HandleOf(window)) / 96.0;

    /// <summary>How much larger the window is than its content area, in pixels: its border and any caption.</summary>
    public static (int Width, int Height) FrameOf(Window window)
    {
        var handle = HandleOf(window);
        if (!GetWindowRect(handle, out var outer) || !GetClientRect(handle, out var inner)) return (0, 0);
        return (outer.Right - outer.Left - (inner.Right - inner.Left), outer.Bottom - outer.Top - (inner.Bottom - inner.Top));
    }

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetClientRect(IntPtr window, out Rect rect);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetCursorPos(out Point point);

    [StructLayout(LayoutKind.Sequential)]
    public struct Point
    {
        public int X;
        public int Y;
    }
}

using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;

namespace Taskii.App;

/// <summary>The handful of Win32 calls the windows need.</summary>
internal static class Native
{
    public static IntPtr HandleOf(Window window) => WinRT.Interop.WindowNative.GetWindowHandle(window);

    /// <summary>Physical pixels per device-independent pixel on the screen the window is on.</summary>
    public static double ScaleOf(Window window) => GetDpiForWindow(HandleOf(window)) / 96.0;

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr window);

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

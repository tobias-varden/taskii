using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics;
using Windows.UI;

namespace Taskii.App;

/// <summary>
/// The quick capture bar: a small window with no title bar that appears over whatever is on
/// screen, takes a task or a note, and gets out of the way again.
/// <para>
/// It is created when Taskii starts and kept loaded, so the hotkey shows it at once.
/// </para>
/// </summary>
public sealed partial class CaptureWindow : Window
{
    private const int BarWidth = 620;
    private const int MinBarHeight = 60;
    private const int MaxBarHeight = 640;
    /// <summary>Somewhere no screen is, for loading the page without it being seen.</summary>
    private const int OffScreen = -32000;

    private readonly WebPage _page;
    private readonly HostBridge _bridge;
    private readonly Action _openMain;
    private int _height = 100;
    private bool _shown;
    private IntPtr _previous;

    public CaptureWindow(HostBridge bridge, Action openMain)
    {
        _openMain = openMain;
        _bridge = bridge;
        InitializeComponent();

        var presenter = OverlappedPresenter.Create();
        presenter.SetBorderAndTitleBar(true, false);
        presenter.IsResizable = false;
        presenter.IsMaximizable = false;
        presenter.IsMinimizable = false;
        presenter.IsAlwaysOnTop = true;
        AppWindow.SetPresenter(presenter);
        AppWindow.IsShownInSwitchers = false;
        AppWindow.Title = "Taskii quick capture";

        ApplyTheme();
        Root.ActualThemeChanged += (_, _) => ApplyTheme();

        _page = new WebPage(Web, bridge, "capture.html") { WindowRequests = HandleAsync };

        // Clicking away puts the bar aside. What was typed stays for next time.
        Activated += (_, e) =>
        {
            if (e.WindowActivationState == WindowActivationState.Deactivated && _shown) HideBar(restoreFocus: false);
        };

        _ = WarmUpAsync();
    }

    /// <summary>Shows the bar on the screen the pointer is on, or puts it away if it is already showing.</summary>
    public void Toggle()
    {
        if (_shown)
        {
            HideBar(restoreFocus: true);
            return;
        }

        var own = Native.HandleOf(this);
        _previous = Native.GetForegroundWindow();
        if (_previous == own) _previous = IntPtr.Zero;

        Native.GetCursorPos(out var pointer);
        var area = DisplayArea.GetFromPoint(new PointInt32(pointer.X, pointer.Y), DisplayAreaFallback.Nearest).WorkArea;

        // Onto the target screen first, so the scale read back is that screen's.
        AppWindow.Move(new PointInt32(area.X, area.Y));
        var size = SizeFor(_height);
        AppWindow.Resize(size);
        AppWindow.Move(new PointInt32(area.X + (area.Width - AppWindow.Size.Width) / 2, area.Y + area.Height / 5));

        _shown = true;
        AppWindow.Show();
        Native.SetForegroundWindow(own);
        Web.Focus(FocusState.Programmatic);
        _page.PostEvent("shown");
    }

    /// <summary>The window size that gives the page exactly the bar's width and this height.</summary>
    private SizeInt32 SizeFor(int height)
    {
        var scale = Native.ScaleOf(this);
        // Measured rather than assumed: a window with no title bar still has a border, and
        // what the system reports for it is not what it draws.
        var frame = Native.FrameOf(this);
        return new SizeInt32((int)Math.Ceiling(BarWidth * scale) + frame.Width, (int)Math.Ceiling(height * scale) + frame.Height);
    }

    private void HideBar(bool restoreFocus)
    {
        if (!_shown) return;
        _shown = false;
        AppWindow.Hide();

        // Back to whatever the user was doing, as if the bar had never been there.
        if (restoreFocus && _previous != IntPtr.Zero && Native.IsWindow(_previous)) Native.SetForegroundWindow(_previous);
        _previous = IntPtr.Zero;
    }

    private async Task<(bool Handled, object? Result)> HandleAsync(string type, JsonElement payload)
    {
        switch (type)
        {
            case "captureResize":
                // The page says how tall its content is; the window follows.
                _height = Math.Clamp((int)Math.Ceiling(payload.GetProperty("height").GetDouble()), MinBarHeight, MaxBarHeight);
                if (_shown) AppWindow.Resize(SizeFor(_height));
                return (true, null);

            case "captureClose":
                HideBar(restoreFocus: true);
                return (true, null);

            case "captureOpenMain":
                HideBar(restoreFocus: false);
                _openMain();
                return (true, null);

            case "capture":
            {
                // The bridge writes the day; the bar leaves as soon as that is done.
                var changed = await _bridge.HandleAsync(type, payload);
                HideBar(restoreFocus: true);
                return (true, changed);
            }

            default:
                return (false, null);
        }
    }

    /// <summary>Loads the page out of sight, so the first press of the hotkey does not wait for it.</summary>
    private async Task WarmUpAsync()
    {
        try
        {
            AppWindow.Move(new PointInt32(OffScreen, OffScreen));
            AppWindow.Resize(SizeFor(_height));
            AppWindow.Show(false);

            await _page.StartAsync();
            await Task.WhenAny(_page.Ready, Task.Delay(TimeSpan.FromSeconds(10)));
        }
        catch (Exception e)
        {
            Log.Write("Could not start quick capture", e);
        }

        if (!_shown) AppWindow.Hide();
    }

    private void ApplyTheme()
    {
        var surface = Root.ActualTheme == ElementTheme.Dark ? Color.FromArgb(255, 0x22, 0x22, 0x21) : Colors.White;
        Root.Background = new SolidColorBrush(surface);
        Web.DefaultBackgroundColor = surface;
    }
}

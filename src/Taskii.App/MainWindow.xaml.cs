using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics;
using Windows.UI;

namespace Taskii.App;

/// <summary>
/// The main window. Everything visible in it is the web page from src/web, hosted in WebView2;
/// the window's own job is to host it and look after window state.
/// <para>
/// Closing it does not end Taskii. It hides, and the app stays in the notification area so
/// quick capture is instant. Exit is on the tray menu.
/// </para>
/// </summary>
public sealed partial class MainWindow : Window, IShell
{
    private static readonly TimeSpan FlushTimeout = TimeSpan.FromSeconds(2);

    private readonly SettingsStore _settings;
    private readonly WebPage _page;
    private bool _pageStarted;
    private bool _hiding;
    private bool _shuttingDown;

    public MainWindow(SettingsStore settings, HostBridge bridge)
    {
        _settings = settings;
        _page = new WebPage(Web0(), bridge, "index.html");

        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "taskii.ico"));
        RestorePlacement();

        ApplyTheme();
        Root.ActualThemeChanged += (_, _) => ApplyTheme();

        AppWindow.Closing += OnClosing;
        Activated += OnActivated;
    }

    /// <summary>Raised after the window has been hidden to the notification area.</summary>
    public event Action? Hidden;

    // InitializeComponent has to run before the page can be given its WebView2.
    private Microsoft.UI.Xaml.Controls.WebView2 Web0()
    {
        InitializeComponent();
        return Web;
    }

    /// <summary>Shows the window and brings it to the front, loading the page the first time.</summary>
    public void Surface()
    {
        if (AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Minimized } presenter) presenter.Restore();
        AppWindow.Show();
        Activate();
        Native.SetForegroundWindow(Native.HandleOf(this));
        StartPage();
    }

    /// <summary>Writes anything the page has pending. Used before the day is changed from outside the page.</summary>
    public Task FlushPageAsync() => _page.FlushAsync(FlushTimeout);

    /// <summary>Tells the page the day may have changed on disk, so it catches up.</summary>
    public void NotifyDayChanged() => _page.PostEvent("activated");

    /// <summary>Saves everything and closes for real, when Taskii is exiting.</summary>
    public async Task ShutDownAsync()
    {
        _shuttingDown = true;
        try
        {
            if (AppWindow.IsVisible) SavePlacement();
            await FlushPageAsync();
        }
        catch (Exception exception)
        {
            Log.Write("Shutting down", exception);
        }

        Close();
    }

    public async Task<string?> PickFolderAsync()
    {
        var picker = new Microsoft.Windows.Storage.Pickers.FolderPicker(AppWindow.Id)
        {
            CommitButtonText = "Use this folder",
        };
        var picked = await picker.PickSingleFolderAsync();
        return picked?.Path;
    }

    private async void StartPage()
    {
        if (_pageStarted) return;
        _pageStarted = true;

        try
        {
            await _page.StartAsync();
        }
        catch (Exception e)
        {
            Log.Write("Could not start the page", e);
            Web.Visibility = Visibility.Collapsed;
            Problem.Text = $"Taskii could not start its page.\n\n{e.Message}\n\nDetails are in {Log.FilePath}";
            Problem.Visibility = Visibility.Visible;
        }
    }

    private void OnActivated(object sender, WindowActivatedEventArgs e)
    {
        // Coming back to the window is when a new day or a synced change gets noticed.
        if (e.WindowActivationState != WindowActivationState.Deactivated) _page.PostEvent("activated");
    }

    private async void OnClosing(AppWindow sender, AppWindowClosingEventArgs e)
    {
        if (_shuttingDown) return;
        e.Cancel = true;
        if (_hiding) return;
        _hiding = true;

        try
        {
            SavePlacement();
            // Whatever was typed last is on disk before the window goes away.
            await FlushPageAsync();
        }
        catch (Exception exception)
        {
            Log.Write("Hiding", exception);
        }

        _hiding = false;
        AppWindow.Hide();
        Hidden?.Invoke();
    }

    private void RestorePlacement()
    {
        var saved = _settings.Current.Window;
        if (saved is { Width: >= 400, Height: >= 300 }
            && DisplayArea.GetFromRect(new RectInt32(saved.X, saved.Y, saved.Width, saved.Height), DisplayAreaFallback.None) is not null)
        {
            AppWindow.MoveAndResize(new RectInt32(saved.X, saved.Y, saved.Width, saved.Height));
            if (saved.Maximized && AppWindow.Presenter is OverlappedPresenter presenter) presenter.Maximize();
            return;
        }

        // First run: a comfortable size, centred on the screen the window opened on.
        var scale = Native.ScaleOf(this);
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        var width = Math.Min((int)(1280 * scale), area.Width);
        var height = Math.Min((int)(820 * scale), area.Height);
        AppWindow.MoveAndResize(new RectInt32(area.X + (area.Width - width) / 2, area.Y + (area.Height - height) / 2, width, height));
    }

    private void SavePlacement()
    {
        if (AppWindow.Presenter is not OverlappedPresenter presenter || presenter.State == OverlappedPresenterState.Minimized) return;

        var previous = _settings.Current.Window;
        var maximized = presenter.State == OverlappedPresenterState.Maximized;
        _settings.Current.Window = maximized && previous is not null
            ? previous with { Maximized = true }
            : new WindowPlacement(AppWindow.Position.X, AppWindow.Position.Y, AppWindow.Size.Width, AppWindow.Size.Height, maximized);
        _settings.Save();
    }

    /// <summary>Colours the title bar to match the page's top bar, in light and dark.</summary>
    private void ApplyTheme()
    {
        var dark = Root.ActualTheme == ElementTheme.Dark;
        var surface = dark ? Color.FromArgb(255, 0x22, 0x22, 0x21) : Colors.White;
        var page = dark ? Color.FromArgb(255, 0x19, 0x19, 0x18) : Color.FromArgb(255, 0xF4, 0xF3, 0xEE);
        var hover = dark ? Color.FromArgb(255, 0x35, 0x35, 0x32) : Color.FromArgb(255, 0xEC, 0xEA, 0xE3);
        var text = dark ? Color.FromArgb(255, 0xEC, 0xEA, 0xE4) : Color.FromArgb(255, 0x1F, 0x1E, 0x1D);
        var faded = dark ? Color.FromArgb(255, 0x86, 0x84, 0x7C) : Color.FromArgb(255, 0x8F, 0x8E, 0x87);

        var bar = AppWindow.TitleBar;
        bar.BackgroundColor = bar.InactiveBackgroundColor = surface;
        bar.ButtonBackgroundColor = bar.ButtonInactiveBackgroundColor = surface;
        bar.ButtonHoverBackgroundColor = bar.ButtonPressedBackgroundColor = hover;
        bar.ForegroundColor = bar.ButtonForegroundColor = bar.ButtonHoverForegroundColor = bar.ButtonPressedForegroundColor = text;
        bar.InactiveForegroundColor = bar.ButtonInactiveForegroundColor = faded;

        // Shown for the instant before the page paints, so there is no white flash.
        Root.Background = new SolidColorBrush(page);
        Web.DefaultBackgroundColor = page;
    }
}

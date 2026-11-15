using Microsoft.UI.Xaml;

namespace Taskii.App;

/// <summary>
/// Taskii keeps running in the notification area after its window is closed, so the quick
/// capture hotkey always answers. This owns the pieces that live as long as the app does.
/// </summary>
public partial class App : Application
{
    private SettingsStore? _settings;
    private MainWindow? _main;
    private CaptureWindow? _capture;
    private TrayIcon? _tray;
    private bool _quitting;

    public App()
    {
        InitializeComponent();
        UnhandledException += (_, e) => Log.Write("Unhandled exception", e.Exception);
    }

    public static new App? Current => Application.Current as App;

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var arguments = Environment.GetCommandLineArgs().Skip(1).ToList();
        var forCapture = arguments.Contains(Autostart.CaptureArgument, StringComparer.OrdinalIgnoreCase);
        var inBackground = forCapture || arguments.Contains(Autostart.BackgroundArgument, StringComparer.OrdinalIgnoreCase);

        _settings = new SettingsStore();
        var bridge = new HostBridge(_settings);

        _main = new MainWindow(_settings, bridge);
        _main.Hidden += OnMainHidden;
        bridge.Shell = _main;
        // Quick capture writes the day itself. The main page saves first and catches up after,
        // so the two never overwrite each other.
        bridge.BeforeOutsideEdit = _main.FlushPageAsync;
        bridge.AfterOutsideEdit = _main.NotifyDayChanged;

        _capture = new CaptureWindow(bridge, openMain: () => _main.Surface());

        var capture = Hotkey.Parse(_settings.Current.Hotkeys.Capture);
        var open = Hotkey.Parse(_settings.Current.Hotkeys.Open);

        _tray = new TrayIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "taskii.ico"), "Taskii", () =>
        [
            new TrayItem("Open Taskii" + Shortcut(open), () => _main.Surface(), IsDefault: true),
            new TrayItem("Quick capture" + Shortcut(capture), () => _capture.Toggle()),
            TrayItem.Separator,
            new TrayItem("Start with Windows", () => Autostart.Set(!Autostart.IsEnabled), () => Autostart.IsEnabled),
            TrayItem.Separator,
            new TrayItem("Exit", Quit),
        ])
        {
            Activated = () => _main.Surface(),
        };

        var taken = new List<string>();
        if (capture is { } c && !_tray.Register(c, () => _capture.Toggle())) taken.Add(c.Text);
        if (open is { } o && !_tray.Register(o, () => _main.Surface())) taken.Add(o.Text);
        if (taken.Count > 0)
        {
            Log.Write($"Hotkeys already in use by another program: {string.Join(", ", taken)}");
            _tray.Notify("Taskii hotkey not available", $"{string.Join(" and ", taken)} is used by another program. Choose another in settings.json.");
        }

        if (forCapture) _capture.Toggle();
        else if (!inBackground) _main.Surface();
    }

    /// <summary>Called when Taskii is started while it is already running, with the arguments it was started with.</summary>
    public void Activate(string arguments) => _main?.DispatcherQueue.TryEnqueue(() =>
    {
        if (arguments.Contains(Autostart.ExitArgument, StringComparison.OrdinalIgnoreCase)) Quit();
        else if (arguments.Contains(Autostart.CaptureArgument, StringComparison.OrdinalIgnoreCase)) _capture?.Toggle();
        else _main.Surface();
    });

    private static string Shortcut(Hotkey? hotkey) => hotkey is { } key ? $"\t{key.Text}" : "";

    private void OnMainHidden()
    {
        // The first time the window is closed, say that Taskii has not gone anywhere.
        if (_settings is null || _settings.Current.TrayHintShown) return;
        _settings.Current.TrayHintShown = true;
        _settings.Save();

        var capture = Hotkey.Parse(_settings.Current.Hotkeys.Capture);
        _tray?.Notify(
            "Taskii is still running",
            capture is { } key ? $"Press {key.Text} anywhere to capture a task. Right-click the icon here to exit." : "Right-click the icon here to exit.");
    }

    private async void Quit()
    {
        if (_quitting) return;
        _quitting = true;

        try
        {
            if (_main is not null) await _main.ShutDownAsync();
            _capture?.Close();
        }
        catch (Exception e)
        {
            Log.Write("Quitting", e);
        }

        _tray?.Dispose();
        Exit();
    }
}

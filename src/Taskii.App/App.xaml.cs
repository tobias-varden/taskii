using Microsoft.UI.Xaml;

namespace Taskii.App;

public partial class App : Application
{
    private MainWindow? _window;

    public App()
    {
        InitializeComponent();
        UnhandledException += (_, e) => Log.Write("Unhandled exception", e.Exception);
    }

    public static new App? Current => Application.Current as App;

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow(new SettingsStore());
        _window.Activate();
    }

    /// <summary>Brings the window forward. Called when Taskii is started while it is already running.</summary>
    public void Surface() => _window?.DispatcherQueue.TryEnqueue(() => _window.Surface());
}

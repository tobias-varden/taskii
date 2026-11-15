using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;

namespace Taskii.App;

public static class Program
{
    [STAThread]
    private static int Main()
    {
        WinRT.ComWrappersSupport.InitializeComWrappers();

        // One Taskii per settings folder. Two instances writing the same day would overwrite
        // each other, so a second start just brings the first one forward.
        var instance = AppInstance.FindOrRegisterForKey("Taskii:" + SettingsStore.Home.ToUpperInvariant());
        if (!instance.IsCurrent)
        {
            var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
            Task.Run(() => instance.RedirectActivationToAsync(activation).AsTask()).GetAwaiter().GetResult();
            return 0;
        }

        // Started again while running: "Taskii.exe --capture" opens the capture bar, "--exit"
        // saves and exits, and anything else brings the main window forward.
        instance.Activated += (_, e) =>
        {
            var arguments = (e.Data as Windows.ApplicationModel.Activation.ILaunchActivatedEventArgs)?.Arguments ?? "";
            App.Current?.Activate(arguments);
        };

        // Asked to exit when nothing is running: there is nothing to do.
        if (Environment.GetCommandLineArgs().Skip(1).Contains(Autostart.ExitArgument, StringComparer.OrdinalIgnoreCase)) return 0;

        Application.Start(parameters =>
        {
            SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
            var app = new App();
        });
        return 0;
    }
}

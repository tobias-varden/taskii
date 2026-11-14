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

        instance.Activated += (_, _) => App.Current?.Surface();

        Application.Start(parameters =>
        {
            SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
            var app = new App();
        });
        return 0;
    }
}

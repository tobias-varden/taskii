using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Taskii.App;

/// <summary>
/// One of the app's pages running in a WebView2: loads it, answers its requests through the
/// bridge, serves pasted images to it, and keeps it from wandering off to other sites.
/// </summary>
public sealed class WebPage(WebView2 view, HostBridge bridge, string page)
{
    /// <summary>A reserved name that never resolves on the network; WebView2 maps it to wwwroot.</summary>
    private const string PageHost = "taskii.example";

    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private string _origin = $"https://{PageHost}";
    private TaskCompletionSource? _flushed;

    /// <summary>
    /// Requests that belong to the window rather than to the bridge. Returns whether it handled
    /// the request, and the result if so.
    /// </summary>
    public Func<string, JsonElement, Task<(bool Handled, object? Result)>>? WindowRequests { get; init; }

    /// <summary>Whether the page has loaded far enough to talk.</summary>
    public bool IsReady => _ready.Task.IsCompleted;

    /// <summary>Completes when the page sends its first request.</summary>
    public Task Ready => _ready.Task;

    public async Task StartAsync()
    {
        // The browser profile (cache, local storage) lives with the settings, not beside the exe.
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", Path.Combine(SettingsStore.Home, "WebView2"));
        await view.EnsureCoreWebView2Async();
        var core = view.CoreWebView2;

        var options = core.Settings;
        options.IsStatusBarEnabled = false;
        options.IsSwipeNavigationEnabled = false;
        options.IsPasswordAutosaveEnabled = false;
        options.IsGeneralAutofillEnabled = false;
        options.AreHostObjectsAllowed = false;
#if !DEBUG
        options.AreDevToolsEnabled = false;
        // Reload, find, print and the like make no sense here. Editing keys are unaffected.
        options.AreBrowserAcceleratorKeysEnabled = false;
#endif

        core.WebMessageReceived += OnWebMessage;
        core.AddWebResourceRequestedFilter($"https://{HostBridge.AssetHost}/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnAssetRequested;
        core.ContextMenuRequested += OnContextMenu;
        core.NavigationStarting += (_, e) =>
        {
            // The page never navigates. Anything else is a link, and links open in the browser.
            if (IsOurs(e.Uri)) return;
            e.Cancel = true;
            bridge.OpenLink(e.Uri);
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            bridge.OpenLink(e.Uri);
        };

        // TASKII_DEV_URL points the windows at the Vite dev server for live reload.
        if (Environment.GetEnvironmentVariable("TASKII_DEV_URL") is { Length: > 0 } dev)
        {
            _origin = new Uri(dev).GetLeftPart(UriPartial.Authority);
        }
        else
        {
            var root = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            if (!File.Exists(Path.Combine(root, page))) throw new FileNotFoundException($"The page {page} is missing from {root}.");
            core.SetVirtualHostNameToFolderMapping(PageHost, root, CoreWebView2HostResourceAccessKind.Deny);
        }

        core.Navigate($"{_origin}/{page}");
    }

    /// <summary>Tells the page something happened. Does nothing until the page is ready to hear it.</summary>
    public void PostEvent(string name)
    {
        if (IsReady) Post(new { @event = name });
    }

    /// <summary>Asks the page to write anything it has pending, and waits for it, but not forever.</summary>
    public async Task FlushAsync(TimeSpan timeout)
    {
        if (!IsReady) return;

        var flushed = _flushed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        PostEvent("flush");
        await Task.WhenAny(flushed.Task, Task.Delay(timeout));
    }

    private bool IsOurs(string? uri) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var parsed)
        && string.Equals(parsed.GetLeftPart(UriPartial.Authority), _origin, StringComparison.OrdinalIgnoreCase);

    private async void OnWebMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsOurs(e.Source)) return;

        var id = 0;
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
            id = root.GetProperty("id").GetInt32();
            var type = root.GetProperty("type").GetString() ?? "";
            var payload = root.GetProperty("payload");
            _ready.TrySetResult();

            object? result = null;
            if (type == Taskii.Host.WindowRequests.Flushed)
            {
                _flushed?.TrySetResult();
            }
            else if (WindowRequests is not null && await WindowRequests(type, payload) is { Handled: true } handled)
            {
                result = handled.Result;
            }
            else
            {
                result = await bridge.HandleAsync(type, payload);
            }

            Post(new { id, ok = true, result });
        }
        catch (Exception exception)
        {
            Log.Write("Request failed", exception);
            Post(new { id, ok = false, error = exception.Message });
        }
    }

    /// <summary>Serves pasted images from the data folder's assets to the page.</summary>
    private void OnAssetRequested(CoreWebView2 sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            var name = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath.TrimStart('/'));
            e.Response = bridge.ReadAsset(name) is { } asset
                // Named by content, so a given URL never changes what it shows.
                ? sender.Environment.CreateWebResourceResponse(
                    new MemoryStream(asset.Bytes).AsRandomAccessStream(),
                    200,
                    "OK",
                    $"Content-Type: {asset.MediaType}\nCache-Control: max-age=31536000, immutable")
                : sender.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
        }
        catch (Exception exception)
        {
            Log.Write("Could not serve an image", exception);
        }
    }

    private void Post(object message)
    {
        try
        {
            if (view.CoreWebView2 is { } core) core.PostWebMessageAsJson(JsonSerializer.Serialize(message, HostBridge.Json));
        }
        catch (Exception e) when (e is COMException or ObjectDisposedException or InvalidOperationException)
        {
            // The page is gone, which happens when a reply is still on its way as the window closes.
        }
    }

    /// <summary>Keeps the editing entries of the browser's context menu and drops the browser ones.</summary>
    private static void OnContextMenu(CoreWebView2 sender, CoreWebView2ContextMenuRequestedEventArgs e)
    {
        string[] unwanted = ["back", "forward", "reload", "saveAs", "print", "share", "webCapture", "inspectElement", "other", "saveImageAs", "saveLinkAs", "openLinkInNewWindow", "createQrCode"];
        var items = e.MenuItems;

        for (var i = items.Count - 1; i >= 0; i--)
        {
            if (unwanted.Contains(items[i].Name, StringComparer.OrdinalIgnoreCase)) items.RemoveAt(i);
        }

        // Tidy the separators left behind.
        for (var i = items.Count - 1; i >= 0; i--)
        {
            var separator = items[i].Kind == CoreWebView2ContextMenuItemKind.Separator;
            var edge = i == items.Count - 1 || i == 0 || items[i - 1].Kind == CoreWebView2ContextMenuItemKind.Separator;
            if (separator && edge) items.RemoveAt(i);
        }

        if (items.Count == 0) e.Handled = true;
    }
}

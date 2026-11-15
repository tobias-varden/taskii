using System.Text.Json;
using Taskii.Core.Days;

namespace Taskii.Host.Tests;

/// <summary>A bridge over a temp data folder and a temp settings folder, on a fake clock.</summary>
public sealed class BridgeFixture : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "taskii-host-tests-" + Guid.NewGuid().ToString("N"));

    public BridgeFixture(DateTime now)
    {
        Clock = new FakeClock(now);
        Settings = new SettingsStore(Path.Combine(_root, "local"));
        Settings.Current.DataFolder = DataFolder;
        Store = new DayStore(DataFolder);
        Bridge = new HostBridge(Settings, Clock);
    }

    public FakeClock Clock { get; }

    public SettingsStore Settings { get; }

    public HostBridge Bridge { get; }

    /// <summary>The same data folder the bridge uses, for writing day files behind its back.</summary>
    public DayStore Store { get; }

    public string DataFolder => Path.Combine(_root, "data");

    /// <summary>Sends a request the way the page does: a type and a JSON payload.</summary>
    public async Task<T> Request<T>(string type, object? payload = null) => (T)(await Raw(type, payload))!;

    /// <summary>The payload goes through JSON, as it does from the page; the result does not.</summary>
    public Task<object?> Raw(string type, object? payload = null) =>
        Bridge.HandleAsync(type, JsonSerializer.SerializeToElement(payload, HostBridge.Json));

    /// <summary>Starts the bridge as the page does, and waits for the index to be read the first time.</summary>
    public async Task<InitResult> Init()
    {
        var init = await Request<InitResult>("init");
        await Bridge.IndexWarmed;
        return init;
    }

    /// <summary>Writes a day file directly, as a sync from another machine would.</summary>
    public void Put(DateOnly date, DayContent content)
    {
        var path = Store.PathFor(date);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, DayFile.Empty.Write(content));
    }

    public static DayContent Day(params string[] todo) =>
        new() { Todo = [.. todo.Select((title, i) => new TaskItem { Id = $"task{i:00}", Title = title })] };

    public void Dispose()
    {
        Bridge.Dispose();
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}

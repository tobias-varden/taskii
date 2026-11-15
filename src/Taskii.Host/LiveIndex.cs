using Taskii.Core.Days;
using Taskii.Core.Search;

namespace Taskii.Host;

/// <summary>
/// The search index of one data folder, kept caught up with its day files. They are only
/// looked at again after a change made from here, or once <see cref="FreshFor"/> has passed,
/// so typing a query does not keep doing it.
/// </summary>
public sealed class LiveIndex(DayStore store, string databasePath, TimeProvider time) : IDisposable
{
    /// <summary>How long the index is trusted before the day files are looked at again.</summary>
    public static readonly TimeSpan FreshFor = TimeSpan.FromSeconds(3);

    private readonly Lock _gate = new();
    private readonly SearchIndex _index = new(store, databasePath);
    private long _checked;
    private volatile bool _stale = true;
    private bool _disposed;

    /// <summary>The index, caught up with the day files.</summary>
    public SearchIndex Fresh()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_stale || time.GetElapsedTime(_checked) > FreshFor)
            {
                _stale = false;
                _index.Refresh();
                _checked = time.GetTimestamp();
            }

            return _index;
        }
    }

    /// <summary>Says a day file was changed from here, so the next search reads it.</summary>
    public void MarkStale() => _stale = true;

    /// <summary>Reads the day files ahead of the first search, which can take a moment the very first time.</summary>
    public Task WarmAsync() => Task.Run(() =>
    {
        try
        {
            Fresh();
        }
        catch (ObjectDisposedException)
        {
            // Another data folder was chosen before this one finished warming up.
        }
        catch (Exception e)
        {
            Log.Write("Could not build the search index", e);
        }
    });

    public void Dispose()
    {
        lock (_gate)
        {
            _disposed = true;
            _index.Dispose();
        }
    }
}

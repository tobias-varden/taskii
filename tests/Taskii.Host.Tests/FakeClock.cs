namespace Taskii.Host.Tests;

/// <summary>A clock that only moves when told to. Local time is UTC, so what is "today" is plain to read.</summary>
public sealed class FakeClock(DateTime start) : TimeProvider
{
    private DateTimeOffset _now = new(DateTime.SpecifyKind(start, DateTimeKind.Utc));

    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;

    public override long TimestampFrequency => TimeSpan.TicksPerSecond;

    public override DateTimeOffset GetUtcNow() => _now;

    public override long GetTimestamp() => _now.UtcTicks;

    public void Advance(TimeSpan by) => _now += by;
}

using Taskii.Core.Days;

namespace Taskii.Core.Tests;

public sealed class AssetStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "taskii-tests-" + Guid.NewGuid().ToString("N"));
    private readonly AssetStore _assets;

    public AssetStoreTests() => _assets = new AssetStore(_root);

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    [Fact]
    public void An_image_is_stored_under_a_name_made_from_its_content()
    {
        var path = _assets.Save([1, 2, 3], "image/png");

        Assert.Matches(@"^assets/[0-9a-f]{10}\.png$", path);
        Assert.Equal([1, 2, 3], File.ReadAllBytes(Path.Combine(_root, path)));
        Assert.Equal([1, 2, 3], _assets.Read(Path.GetFileName(path)));
    }

    [Fact]
    public void The_same_image_pasted_twice_is_stored_once()
    {
        var first = _assets.Save([1, 2, 3], "image/png");
        var second = _assets.Save([1, 2, 3], "image/png");

        Assert.Equal(first, second);
        Assert.Single(Directory.GetFiles(_assets.Folder));
    }

    [Fact]
    public void Different_images_get_different_names()
    {
        Assert.NotEqual(_assets.Save([1, 2, 3], "image/png"), _assets.Save([1, 2, 4], "image/png"));
        Assert.EndsWith(".jpg", _assets.Save([9], "image/jpeg"));
    }

    [Fact]
    public void A_name_already_taken_by_another_image_is_not_overwritten()
    {
        var path = _assets.Save([1, 2, 3], "image/png");
        File.WriteAllBytes(Path.Combine(_root, path), [7, 7, 7]);

        var again = _assets.Save([1, 2, 3], "image/png");

        Assert.NotEqual(path, again);
        Assert.Equal([7, 7, 7], File.ReadAllBytes(Path.Combine(_root, path)));
        Assert.Equal([1, 2, 3], File.ReadAllBytes(Path.Combine(_root, again)));
    }

    [Fact]
    public void Only_images_are_stored()
    {
        Assert.Throws<NotSupportedException>(() => _assets.Save([1], "text/html"));
        Assert.Throws<NotSupportedException>(() => _assets.Save([1], "image/svg+xml"));
        Assert.False(Directory.Exists(_assets.Folder));
    }

    [Theory]
    [InlineData("../2026/11/2026-11-13.md")]
    [InlineData("..\\secret.png")]
    [InlineData("notes.md")]
    [InlineData("C:/Windows/win.ini")]
    [InlineData("0123456789.png/../../x")]
    [InlineData("")]
    public void Reading_never_reaches_outside_the_asset_folder(string name)
    {
        Directory.CreateDirectory(_assets.Folder);
        File.WriteAllText(Path.Combine(_root, "secret.png"), "outside");

        Assert.Null(_assets.Read(name));
    }

    [Fact]
    public void Reading_a_missing_image_gives_nothing()
    {
        Assert.Null(_assets.Read("0123456789.png"));
        Assert.Equal("image/png", AssetStore.MediaTypeOf("0123456789.png"));
        Assert.Equal("image/jpeg", AssetStore.MediaTypeOf("0123456789.jpg"));
    }
}

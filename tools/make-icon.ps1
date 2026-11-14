# Draws the app icon and writes it as a multi-size .ico.
# Run from the repository root:  powershell -File tools/make-icon.ps1

Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\src\Taskii.App\Assets\taskii.ico'
$sizes = 16, 20, 24, 32, 40, 48, 64, 256

function New-IconPng([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded tile.
    $s = [single]$size
    $r = $s * 0.22
    $d = $r * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($s - $d, 0, $d, $d, 270, 90)
    $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
    $path.AddArc(0, $s - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $tile = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 31, 30, 29))
    $g.FillPath($tile, $path)

    # A done checkbox: green disc, dark tick.
    $m = $s * 0.2
    $disc = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 151, 196, 89))
    $g.FillEllipse($disc, $m, $m, $s - 2 * $m, $s - 2 * $m)

    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 31, 30, 29)), ($s * 0.085)
    $pen.StartCap = 'Round'
    $pen.EndCap = 'Round'
    $pen.LineJoin = 'Round'
    $tick = @(
        (New-Object System.Drawing.PointF ($s * 0.355), ($s * 0.515)),
        (New-Object System.Drawing.PointF ($s * 0.455), ($s * 0.615)),
        (New-Object System.Drawing.PointF ($s * 0.650), ($s * 0.400))
    )
    $g.DrawLines($pen, [System.Drawing.PointF[]]$tick)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return , $ms.ToArray()
}

$images = $sizes | ForEach-Object { , (New-IconPng $_) }

New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
$stream = [System.IO.File]::Create($out)
$w = New-Object System.IO.BinaryWriter $stream
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)

$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$images[$i].Length); $w.Write([uint32]$offset)
    $offset += $images[$i].Length
}
foreach ($image in $images) { $w.Write([byte[]]$image) }
$w.Dispose()

Write-Host "Wrote $out"

# Generates the tray icon and installer icon from a single drawn source.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$resourcesDir = Join-Path $root "resources"
$assetDir = Join-Path $root "apps\desktop\electron\assets"
New-Item -ItemType Directory -Force -Path $resourcesDir, $assetDir | Out-Null

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded obsidian tile.
$tilePath = New-RoundedRect 6 6 244 244 56
$tileBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  [System.Drawing.Rectangle]::new(0, 0, 256, 256),
  [System.Drawing.Color]::FromArgb(255, 19, 29, 38),
  [System.Drawing.Color]::FromArgb(255, 8, 12, 17),
  45
)
$g.FillPath($tileBrush, $tilePath)
$edgePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(46, 255, 255, 255), 2)
$g.DrawPath($edgePen, $tilePath)

# Folder body + tab in a soft mint gradient.
$folderRect = [System.Drawing.Rectangle]::new(46, 84, 164, 116)
$folderBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $folderRect,
  [System.Drawing.Color]::FromArgb(255, 151, 251, 214),
  [System.Drawing.Color]::FromArgb(255, 48, 214, 160),
  55
)
$tabPath = New-RoundedRect 46 66 82 44 16
$g.FillPath($folderBrush, $tabPath)
$bodyPath = New-RoundedRect 46 90 164 108 22
$g.FillPath($folderBrush, $bodyPath)

# Small spark inside the folder.
$spark = New-Object System.Drawing.Drawing2D.GraphicsPath
$points = @(
  [System.Drawing.PointF]::new(128, 112),
  [System.Drawing.PointF]::new(136, 133),
  [System.Drawing.PointF]::new(157, 141),
  [System.Drawing.PointF]::new(136, 149),
  [System.Drawing.PointF]::new(128, 170),
  [System.Drawing.PointF]::new(120, 149),
  [System.Drawing.PointF]::new(99, 141),
  [System.Drawing.PointF]::new(120, 133)
)
$spark.AddPolygon($points)
$sparkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(242, 8, 18, 20))
$g.FillPath($sparkBrush, $spark)

$iconPng = Join-Path $resourcesDir "icon.png"
$bmp.Save($iconPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save((Join-Path $assetDir "app-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)

# 32px tray bitmap (downscaled with high-quality interpolation).
$tray = New-Object System.Drawing.Bitmap(32, 32)
$tg = [System.Drawing.Graphics]::FromImage($tray)
$tg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$tg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$tg.DrawImage($bmp, 0, 0, 32, 32)
$tray.Save((Join-Path $assetDir "tray-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)

# Single-image PNG-compressed ICO (Windows Vista+). electron-builder accepts it.
$pngBytes = [System.IO.File]::ReadAllBytes($iconPng)
$icoPath = Join-Path $resourcesDir "icon.ico"
$stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Close()

$g.Dispose()
$tg.Dispose()
$bmp.Dispose()
$tray.Dispose()
Write-Host "Wrote resources/icon.png, resources/icon.ico, apps/desktop/electron/assets/tray-icon.png"

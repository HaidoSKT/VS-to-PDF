Add-Type -AssemblyName System.Drawing

function New-Icon([int]$Size, [string]$OutputPath) {
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Background
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($Size, $Size)),
        [System.Drawing.Color]::FromArgb(255, 26, 58, 95),
        [System.Drawing.Color]::FromArgb(255, 15, 25, 35)
    )

    # Rounded rect background
    $r = [int]($Size * 0.15)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r*2, $r*2, 180, 90)
    $path.AddArc($Size - $r*2, 0, $r*2, $r*2, 270, 90)
    $path.AddArc($Size - $r*2, $Size - $r*2, $r*2, $r*2, 0, 90)
    $path.AddArc(0, $Size - $r*2, $r*2, $r*2, 90, 90)
    $path.CloseFigure()
    $g.FillPath($bgBrush, $path)

    # Book rectangle
    $bookBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 42, 90, 138))
    $bookPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 74, 154, 202), [Math]::Max(1, $Size * 0.02))
    $bx = [int]($Size * 0.2)
    $by = [int]($Size * 0.15)
    $bw = [int]($Size * 0.6)
    $bh = [int]($Size * 0.7)
    $g.FillRectangle($bookBrush, $bx, $by, $bw, $bh)
    $g.DrawRectangle($bookPen, $bx, $by, $bw, $bh)

    # Page lines
    $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 126, 203, 245), [Math]::Max(1, $Size * 0.02))
    $linePen2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 90, 154, 186), [Math]::Max(1, $Size * 0.015))

    $g.DrawLine($linePen, [int]($Size*0.3), [int]($Size*0.3), [int]($Size*0.7), [int]($Size*0.3))
    $g.DrawLine($linePen2, [int]($Size*0.3), [int]($Size*0.42), [int]($Size*0.7), [int]($Size*0.42))
    $g.DrawLine($linePen2, [int]($Size*0.3), [int]($Size*0.52), [int]($Size*0.6), [int]($Size*0.52))

    # Camera circle
    $camBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 26, 107, 74))
    $camPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 42, 139, 106), [Math]::Max(1, $Size * 0.02))
    $cx = [int]($Size * 0.7)
    $cy = [int]($Size * 0.7)
    $cr = [int]($Size * 0.15)
    $g.FillEllipse($camBrush, $cx - $cr, $cy - $cr, $cr * 2, $cr * 2)
    $g.DrawEllipse($camPen, $cx - $cr, $cy - $cr, $cr * 2, $cr * 2)

    # Camera lens
    $lensBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 126, 203, 245))
    $lr = [int]($Size * 0.07)
    $g.FillEllipse($lensBrush, $cx - $lr, $cy - $lr, $lr * 2, $lr * 2)

    # Save
    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Created $OutputPath"
}

New-Icon -Size 16 -OutputPath "icons\icon16.png"
New-Icon -Size 48 -OutputPath "icons\icon48.png"
New-Icon -Size 128 -OutputPath "icons\icon128.png"

Write-Host "All icons created!"

# Exports slide 1 of every .pptx in a folder as a PNG with PowerPoint (Windows), for the redraw QA
# (P-3): open the PNGs beside the report. Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/render-pptx.ps1 pilot/run-<date>-redraw
param([Parameter(Mandatory = $true)][string]$Folder)
$dir = (Resolve-Path $Folder).Path
$ppt = New-Object -ComObject PowerPoint.Application
try {
  foreach ($f in Get-ChildItem $dir -Filter *.pptx) {
    try {
      $p = $ppt.Presentations.Open($f.FullName, $true, $false, $false)
      $png = [IO.Path]::ChangeExtension($f.FullName, '.png')
      $p.Slides(1).Export($png, 'PNG', 1300, 900)
      $p.Close()
      "OK    $($f.Name)"
    } catch {
      "FAIL  $($f.Name): $($_.Exception.Message)"
    }
  }
} finally {
  $ppt.Quit()
}

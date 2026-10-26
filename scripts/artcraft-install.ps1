# Installs only the ArtCraft apps you name (https://getartcraft.com/apps) from
# each app's latest official release on github.com/storytold.
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/faheemdehalvi/fd-code/t3-beta/scripts/artcraft-install.ps1))) soundcraft photocraft
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Apps)

$ErrorActionPreference = 'Stop'
$known = @('photocraft', 'vectorcraft', 'filmcraft', 'lightcraft', 'pdfcraft', 'effectcraft', 'designcraft',
  'figcraft', 'wordcraft', 'soundcraft', 'deckcraft', 'cadcraft', 'gridcraft', 'craft-launcher')

if (-not $Apps) {
  Write-Error "Name the apps to install, for example: soundcraft photocraft effectcraft`nApps: $($known -join ' ')"
}
foreach ($app in $Apps) {
  if ($known -notcontains $app) { Write-Error "Unknown app: $app. Choose from: $($known -join ' ')" }
}

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'ARM64' { 'arm64' }
  'AMD64' { 'x64' }
  default { 'x86' }
}

foreach ($app in $Apps) {
  $release = Invoke-RestMethod "https://api.github.com/repos/storytold/$app/releases/latest" -Headers @{ 'User-Agent' = 'fd-code-artcraft-install' }
  $asset = $release.assets | Where-Object { $_.name -like "*-windows-$arch.msi" } | Select-Object -First 1
  if (-not $asset) { Write-Error "${app}: the latest release has no Windows $arch installer." }
  $digest = "$($asset.digest)" -replace '^sha256:', ''
  if (-not $digest) { Write-Error "${app}: the release publishes no checksum for $($asset.name), so it was not installed." }

  $file = Join-Path ([IO.Path]::GetTempPath()) $asset.name
  Write-Host "Downloading $($asset.name)"
  Invoke-WebRequest $asset.browser_download_url -OutFile $file -UseBasicParsing
  if ((Get-FileHash $file -Algorithm SHA256).Hash -ne $digest) {
    Remove-Item $file
    Write-Error "${app}: checksum mismatch for $($asset.name), so it was not installed."
  }

  $install = Start-Process msiexec.exe -ArgumentList @('/i', "`"$file`"", '/passive', '/norestart') -Wait -PassThru
  Remove-Item $file
  if ($install.ExitCode -ne 0) { Write-Error "${app}: the installer exited with code $($install.ExitCode)." }
  Write-Host "Installed $app"
}

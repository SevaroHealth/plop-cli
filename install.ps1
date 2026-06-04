#!/usr/bin/env pwsh
# plop-deploy installer (Windows).
#
#   irm https://raw.githubusercontent.com/SevaroHealth/plop-cli/main/install.ps1 | iex
#
# Downloads the self-contained plop-deploy.exe and puts it on your PATH.
# No Node/Bun required to run it.
#
# Env overrides:
#   PLOP_BIN_DIR        install dir (default: %LOCALAPPDATA%\plop\bin)
#   PLOP_CLI_TAG        release tag (default: latest)
#   PLOP_CLI_BASE_URL   alternate mirror base (e.g. a CloudFront URL)
#   PLOP_CLI_REPO       owner/repo (default: SevaroHealth/plop-cli)

$ErrorActionPreference = 'Stop'

$Repo    = if ($env:PLOP_CLI_REPO) { $env:PLOP_CLI_REPO } else { 'SevaroHealth/plop-cli' }
$BinName = 'plop-deploy.exe'
$BinDir  = if ($env:PLOP_BIN_DIR) { $env:PLOP_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'plop\bin' }
$Tag     = if ($env:PLOP_CLI_TAG) { $env:PLOP_CLI_TAG } else { 'latest' }
$BaseUrl = $env:PLOP_CLI_BASE_URL

# Bun has no windows-arm64 target; the x64 build runs under emulation on ARM.
$Asset = 'plop-deploy-windows-x64.exe'

if ($BaseUrl) {
  $Url = "$($BaseUrl.TrimEnd('/'))/$Asset"
} elseif ($Tag -eq 'latest') {
  $Url = "https://github.com/$Repo/releases/latest/download/$Asset"
} else {
  $Url = "https://github.com/$Repo/releases/download/$Tag/$Asset"
}

Write-Host "Downloading $Url"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$Out = Join-Path $BinDir $BinName
Invoke-WebRequest -Uri $Url -OutFile $Out -UseBasicParsing

# Strip the Mark-of-the-Web so SmartScreen doesn't gate a binary the user
# explicitly chose to install (the Windows analog of macOS quarantine).
Unblock-File -Path $Out -ErrorAction SilentlyContinue

Write-Host "Installed $BinName -> $Out"

# Add the install dir to the user PATH if it isn't already there.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$BinDir", 'User')
  Write-Host ''
  Write-Host "Added $BinDir to your user PATH. Open a new terminal for it to take effect."
}

Write-Host ''
Write-Host 'Done. Try: plop-deploy --help'

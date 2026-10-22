# tiko installer for Windows: checks the machine, installs WSL 2 and Docker Desktop when they are missing,
# writes .env with generated secrets and starts the released images. Run it again to upgrade.
#
#   irm https://tiko.run/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://tiko.run/install.ps1))) -Yes -Port 8080
#
# Env: TIKO_DIR, TIKO_PORT (3000), TIKO_VERSION (latest release), TIKO_YES=1,
#      TIKO_UPDATER (yes or no: one-click updates, asked otherwise),
#      TIKO_USAGE_STATS=false (send no usage stats, see https://docs.tiko.run/privacy/),
#      TIKO_COMPOSE_URL (another compose file, for testing a branch).
# ASCII only: irm decodes a response without a charset as Latin-1.
param(
  [switch]$Yes,
  [string]$Dir,
  [int]$Port,
  [string]$Version,
  [switch]$NoUpdater,
  [switch]$NoStats
)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest in PowerShell 5.1 is many times slower with the progress bar on.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'tiko-run/tiko'
$InstallLine = 'irm https://tiko.run/install.ps1 | iex'
$MinMemGB = 4
$MinDiskMB = 2048
$DockerBin = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin'
$DockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
$DockerDocs = 'https://docs.docker.com/desktop/setup/install/windows-install/'
$StatsUrl = if ($env:TIKO_STATS_URL) { $env:TIKO_STATS_URL } else { 'https://t.tiko.run/v1/events' }

if ($env:TIKO_YES -eq '1') { $Yes = $true }
$Updater = if ($NoUpdater) { 'no' } else { "$env:TIKO_UPDATER" }
$Stats = -not ($NoStats -or $env:TIKO_USAGE_STATS -eq 'false')
$StepName = 'docker-check'
if (-not $Dir) { $Dir = if ($env:TIKO_DIR) { $env:TIKO_DIR } else { Join-Path $env:USERPROFILE 'tiko' } }
if (-not $Port -and $env:TIKO_PORT) { $Port = [int]$env:TIKO_PORT }
if (-not $Version) { $Version = if ($env:TIKO_VERSION) { $env:TIKO_VERSION } else { 'latest' } }
$Version = $Version -replace '^v', ''
$Dir = [IO.Path]::GetFullPath($Dir).TrimEnd('\')
# Turned off once, the install stays quiet on every upgrade; read before the notice.
$OldEnv = Join-Path $Dir '.env'
if ((Test-Path $OldEnv) -and (Select-String -Path $OldEnv -Pattern '^TIKO_USAGE_STATS=false' -Quiet)) { $Stats = $false }
# Tells a new install from a retry or a reinstall in the usage stats.
$Fresh = -not (Test-Path $OldEnv)
$Upgrade = $false
$NeedsRestart = $false
$FreshDocker = $false
$Password = ''

function Say([string]$Text) { Write-Host $Text }
function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
# Throws instead of exit: under irm | iex, exit would close the user's PowerShell window.
function Fail([string]$Text) { throw $Text }
function Test-Command([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Native stderr turns into a terminating error under Stop in PowerShell 5.1.
function Test-Native {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Command)
  $ErrorActionPreference = 'Continue'
  $rest = @($Command | Select-Object -Skip 1)
  & $Command[0] @rest *> $null
  $LASTEXITCODE -eq 0
}

function Read-Consent([string]$Question) {
  if ($Yes) { return $true }
  (Read-Host "$Question [y/N]") -match '^(y|yes)$'
}

# A question where yes is the usual answer.
function Read-Approval([string]$Question) {
  if ($Yes) { return $true }
  (Read-Host "$Question [Y/n]") -notmatch '^(n|no)$'
}

# Asked once and kept in .env, so an upgrade does not ask again; TIKO_UPDATER or -NoUpdater
# change the kept answer.
function Initialize-Updater([string]$EnvFile) {
  if (Select-String -Path $EnvFile -Pattern '^COMPOSE_PROFILES=' -Quiet) {
    if (-not $Updater) { return }
    Write-EnvFile $EnvFile @(Get-Content $EnvFile | Where-Object { $_ -notmatch '^COMPOSE_PROFILES=' })
  }
  if (-not $Updater) {
    Say 'One-click updates add a small service with access to Docker, so an admin can update'
    Say 'tiko from the About button. Without it you update by running this installer again.'
    $script:Updater = if (Read-Approval 'Turn on one-click updates?') { 'yes' } else { 'no' }
  }
  $line = if ($Updater -eq 'yes') { 'COMPOSE_PROFILES=updater' } else { 'COMPOSE_PROFILES=' }
  Write-EnvFile $EnvFile (@(Get-Content $EnvFile) + $line)
  if ($Updater -eq 'yes') { Say 'One-click updates are on' }
}

function Get-RandomByte([int]$Count) {
  $bytes = New-Object byte[] $Count
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  , $bytes
}

function Write-EnvFile([string]$Path, [string[]]$Lines) {
  # No BOM: Compose would read it as part of the first variable name.
  [IO.File]::WriteAllText($Path, ($Lines -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
}

function Test-Machine {
  Step 'Checking this machine'
  $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  if ($arch -notin 'AMD64', 'ARM64') { Fail "$arch is not supported: tiko images are built for 64-bit x86 and ARM" }
  $build = [Environment]::OSVersion.Version.Build
  if ($build -lt 19041) { Fail "Windows build $build is too old for WSL 2; update to Windows 10 version 2004 or later" }

  # Firmware and the kernel keep a few hundred MB of a 4 GB machine.
  $memGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
  if ($memGB -lt $MinMemGB - 0.5) { Fail "Docker Desktop needs at least 4 GB of memory, this machine has $memGB GB" }

  $probe = $Dir
  while (-not (Test-Path $probe)) { $probe = Split-Path $probe -Parent }
  $diskMB = [math]::Floor((New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($probe))).AvailableFreeSpace / 1MB)
  if ($diskMB -lt $MinDiskMB) { Fail "tiko needs 2 GB of free disk at $probe, there is $diskMB MB" }

  $envFile = Join-Path $Dir '.env'
  $script:Upgrade = Test-Path $envFile
  if ($Upgrade -and -not $Port) {
    $match = Select-String -Path $envFile -Pattern '^TIKO_PORT=(\d+)' | Select-Object -First 1
    if ($match) { $script:Port = [int]$match.Matches[0].Groups[1].Value }
  }
  if (-not $Port) { $script:Port = 3000 }
  if (-not $Upgrade -and (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) {
    Fail "port $Port is taken by another program; pick another one with -Port"
  }
  Say "OK: Windows build $build $arch, $memGB GB memory, $diskMB MB free disk, port $Port"
}

function Test-Virtualization {
  # With Hyper-V already running, the processor reports virtualization as off to the guest OS.
  if ((Get-CimInstance Win32_ComputerSystem).HypervisorPresent) { return }
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  if (-not $cpu.VirtualizationFirmwareEnabled) {
    Fail 'virtualization is off in the firmware: turn on Intel VT-x or AMD-V in the BIOS or UEFI settings, then run the installer again'
  }
}

function Install-Wsl {
  if (-not (Read-Consent 'WSL 2 is not installed, and Docker Desktop needs it. Install it now (Windows asks for administrator rights)?')) {
    Fail "tiko runs in Docker Desktop, which needs WSL 2; install it with 'wsl --install' and run the installer again"
  }
  $process = Start-Process wsl.exe -ArgumentList '--install', '--no-distribution' -Verb RunAs -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    Fail "wsl --install failed with code $($process.ExitCode); see https://learn.microsoft.com/windows/wsl/troubleshooting"
  }
  $script:NeedsRestart = $true
}

# On a new user profile winget is on the machine, but App Installer is not registered for that user yet.
function Register-Winget {
  if (Test-Command winget) { return }
  try { Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe -ErrorAction Stop }
  catch { Say "Could not register winget for this user: $($_.Exception.Message)" }
}

function Install-DockerDesktop {
  Register-Winget
  if (-not (Test-Command winget)) {
    Say "Docker Desktop is not installed and winget is missing. Install Docker Desktop from $DockerDocs"
    Fail 'Docker Desktop is required; run the installer again once it is installed'
  }
  Say 'Docker Desktop is free to install and use; only large companies need a Docker license.'
  if (-not (Read-Consent 'Docker Desktop is not installed. Install it with winget (Windows asks for administrator rights)?')) {
    Fail "tiko runs in Docker; install Docker Desktop and run the installer again: $DockerDocs"
  }
  Say 'Downloading and installing Docker Desktop (about 600 MB, usually 3 to 10 minutes)...'
  $ErrorActionPreference = 'Continue'
  # winget draws its progress bar in characters the console garbles; its log matters only on failure.
  $log = & winget install -e --id Docker.DockerDesktop --source winget --accept-package-agreements --accept-source-agreements `
    --disable-interactivity --override 'install --quiet --accept-license --backend=wsl-2' 2>&1
  $code = $LASTEXITCODE
  if ((Test-Path $DockerBin) -and -not (Test-Command docker)) { $env:Path = "$env:Path;$DockerBin" }
  if (-not (Test-Command docker)) {
    $log | Where-Object { "$_" -match '[A-Za-z]{3}' } | Select-Object -Last 15 | ForEach-Object { Say "  $_" }
    Fail "winget could not install Docker Desktop (code $code); install it by hand: $DockerDocs"
  }
  Say 'OK: Docker Desktop is installed'
  $script:FreshDocker = $true
}

function Wait-Docker {
  if (Test-Path $DockerDesktop) { Start-Process $DockerDesktop }
  if ($FreshDocker) {
    Say ''
    Say 'Docker Desktop starts for the first time and opens a few windows:'
    Say '  - "Welcome to Docker" asks you to sign in: press Skip, tiko needs no Docker account;'
    Say '  - "Welcome to Windows Subsystem for Linux": close it;'
    Say '  - Windows Firewall asks about "Docker Desktop Backend": Allow lets other devices on your'
    Say '    network open tiko, Cancel keeps it on this computer only.'
    Say 'The installer goes on by itself once Docker is ready.'
    Say ''
  }
  Say 'Waiting for Docker Desktop to start (up to 3 minutes)...'
  for ($i = 0; $i -lt 90; $i++) {
    if (Test-Native docker info) { return }
    Start-Sleep -Seconds 2
  }
}

function Confirm-Docker {
  Step 'Checking Docker'
  # A Docker Desktop installed in this session is not on the PATH yet.
  if ((Test-Path $DockerBin) -and -not (Test-Command docker)) { $env:Path = "$env:Path;$DockerBin" }
  if (-not (Test-Command docker)) {
    Test-Virtualization
    if (-not (Test-Native wsl.exe '--status')) {
      Install-Wsl
      return
    }
    Install-DockerDesktop
  }
  if (-not (Test-Native docker info)) { Wait-Docker }
  if (-not (Test-Native docker info)) {
    Fail 'Docker Desktop does not answer; open it from the Start menu, wait for "Engine running" and run the installer again'
  }
  if (-not (Test-Native docker compose version)) { Fail "Docker Compose v2 is missing; update Docker Desktop: $DockerDocs" }
  Say "OK: $(docker --version)"
}

# The compose project is named tiko, so a stack started from another folder would be replaced.
function Assert-OneStack {
  $ErrorActionPreference = 'Continue'
  $project = if ($env:COMPOSE_PROJECT_NAME) { $env:COMPOSE_PROJECT_NAME } else { 'tiko' }
  # {{.Labels}} has no quotes inside: PowerShell 5.1 drops inner quotes from native arguments.
  $all = & docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Labels}}' 2> $null
  foreach ($pair in ($all -split ',')) {
    if ($pair -like 'com.docker.compose.project.working_dir=*') {
      $other = $pair.Substring($pair.IndexOf('=') + 1).TrimEnd('\')
      if ($other -and $other -ne $Dir) {
        Fail "tiko already runs from $other; stop it there with 'docker compose down', or upgrade it with -Dir $other"
      }
    }
  }
}

function Initialize-Folder {
  Assert-OneStack
  Step "Preparing $Dir"
  New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'data\backups') | Out-Null
  $envFile = Join-Path $Dir '.env'
  if (-not $Upgrade) {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $script:Password = -join ((Get-RandomByte 20) | ForEach-Object { $chars[$_ % $chars.Length] })
    Write-EnvFile $envFile @(
      '# Written by the tiko installer. The password is for the first admin only.',
      "TIKO_PASSWORD=$Password",
      "TIKO_SECRET_KEY=$([Convert]::ToBase64String((Get-RandomByte 32)))",
      "TIKO_PORT=$Port",
      'TIKO_DEPLOY=installer'
    )
    Say 'Created .env with a generated password and secret key'
  } else {
    Write-EnvLine $envFile 'TIKO_PORT' "$Port"
  }
  Write-EnvLine $envFile 'TIKO_DEPLOY' 'installer'
  # Postgres reads it once, when its volume is made: a value already there must stay. Hex, as it
  # goes into a URL.
  if (-not (Select-String -Path $envFile -Pattern '^POSTGRES_PASSWORD=.' -Quiet)) {
    Write-EnvLine $envFile 'POSTGRES_PASSWORD' (-join ((Get-RandomByte 24) | ForEach-Object { $_.ToString('x2') }))
  }
  # Inside its container tiko sees Linux; the usage stats need the system it was installed on.
  Write-EnvLine $envFile 'TIKO_HOST_OS' 'windows'
  if (-not $Stats) { Write-EnvLine $envFile 'TIKO_USAGE_STATS' 'false' }
  Initialize-Updater $envFile

  $script:StepName = 'download'
  $url = if ($env:TIKO_COMPOSE_URL) { $env:TIKO_COMPOSE_URL }
  elseif ($Version -eq 'latest') { "https://github.com/$Repo/releases/latest/download/compose.release.yml" }
  else { "https://github.com/$Repo/releases/download/v$Version/compose.release.yml" }
  $target = Join-Path $Dir 'compose.yaml'
  try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile "$target.new" } catch { Fail "could not download ${url}: $_" }
  Move-Item -Force "$target.new" $target
}

function Invoke-Tiko {
  Step 'Starting tiko'
  $ErrorActionPreference = 'Continue'
  Push-Location $Dir
  try {
    $script:StepName = 'pull'
    & docker compose pull --quiet
    if ($LASTEXITCODE -ne 0) { Fail 'could not download the tiko images; check the internet connection and run the installer again' }
    $script:StepName = 'start'
    & docker compose up -d --remove-orphans
    if ($LASTEXITCODE -ne 0) { Fail "tiko did not start; see the logs: cd $Dir; docker compose logs" }
  } finally { Pop-Location }
  $script:StepName = 'health'
  Say "Waiting for tiko to answer on port $Port..."
  for ($i = 0; $i -lt 90; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "http://127.0.0.1:$Port/" | Out-Null
      return
    } catch { Start-Sleep -Seconds 2 }
  }
  Fail "tiko did not start; see the logs: cd $Dir; docker compose logs"
}

function Show-Result {
  $match = Select-String -Path (Join-Path $Dir 'compose.yaml') -Pattern 'tiko-api:\$\{TAG:-([^}]+)\}' | Select-Object -First 1
  $tag = if ($match) { $match.Matches[0].Groups[1].Value } else { '' }
  $address = "http://localhost:$Port"
  Step "tiko $tag is running"
  Write-Host ''
  Write-Host "  Open:      $address" -ForegroundColor Green
  if (-not $Upgrade) {
    Write-Host '  Username:  admin' -ForegroundColor Green
    Write-Host "  Password:  $Password" -ForegroundColor Green
    Write-Host ''
    Say "Change the password in Settings > Security; until then it is also in $Dir\.env"
  } else {
    Write-Host '  Sign in as before: boards, accounts and settings are kept.' -ForegroundColor Green
    Write-Host ''
  }
  Say "Folder:    $Dir (settings in .env, backups in data)"
  Say "Logs:      cd $Dir; docker compose logs -f"
  Say 'Upgrade:   run this installer again'
  Say 'Guide:     https://docs.tiko.run/'
  Say ''
  Show-StatsNotice
  Start-Process $address
}

# Sets KEY=VALUE in .env, keeping the other lines.
function Write-EnvLine([string]$EnvFile, [string]$Key, [string]$Value) {
  if (Select-String -Path $EnvFile -Pattern "^$Key=$Value`$" -Quiet) { return }
  Write-EnvFile $EnvFile (@(Get-Content $EnvFile | Where-Object { $_ -notmatch "^$Key=" }) + "$Key=$Value")
}

function Show-StatsNotice {
  if ($Stats) {
    Say 'Usage stats:   on  (version, OS, install count; no personal data)'
    Say '               off with -NoStats or in Settings > Privacy: https://docs.tiko.run/privacy/'
  } else {
    Say 'Usage stats:   off'
  }
  Say 'Error reports: off until an admin turns them on in Settings > Privacy'
}

# One event about this install, listed at https://docs.tiko.run/privacy/; a failure to send is ignored.
function Send-InstallEvent([string]$FailedStep) {
  if (-not $Stats) { return }
  $installed = $null
  $compose = Join-Path $Dir 'compose.yaml'
  if (Test-Path $compose) {
    $match = Select-String -Path $compose -Pattern 'tiko-api:\$\{TAG:-([^}]+)\}' | Select-Object -First 1
    if ($match) { $installed = $match.Matches[0].Groups[1].Value }
  }
  $cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $body = [ordered]@{
    kind = 'install'; schema = 2; version = $installed; os = 'windows'
    arch = $(if ($cpu -eq 'ARM64') { 'arm64' } elseif ($cpu -eq 'AMD64') { 'amd64' } else { 'other' })
    installer = 'ps1'
    updater = ($Updater -eq 'yes') -or ((Test-Path $OldEnv) -and (Select-String -Path $OldEnv -Pattern '^COMPOSE_PROFILES=.*updater' -Quiet))
    fresh = $Fresh
    failed_step = $(if ($FailedStep) { $FailedStep } else { $null })
  } | ConvertTo-Json -Compress
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Method Post -ContentType 'application/json' -Body $body -Uri $StatsUrl | Out-Null
  } catch { Write-Verbose "usage stats not sent: $_" }
}

function Install-Tiko {
  Say 'tiko installer: checks this machine, installs WSL 2 and Docker Desktop if needed (after asking) and starts tiko.'
  Show-StatsNotice
  Test-Machine
  Confirm-Docker
  if ($NeedsRestart) {
    Step 'Restart Windows'
    Say 'WSL 2 is installed, but Windows turns on its virtual machine platform only while it starts,'
    Say 'so Docker Desktop cannot run until you restart. After the restart, run the same line again'
    Say 'to install Docker Desktop and start tiko:'
    Say "  $InstallLine"
    if (-not $Yes -and (Read-Consent 'Restart now? Save your work in other programs first.')) { Restart-Computer }
    return
  }
  Initialize-Folder
  Invoke-Tiko
  Send-InstallEvent ''
  Show-Result
}

# Called on the last line, so a download cut in the middle runs nothing.
try {
  Install-Tiko
} catch {
  Write-Host ''
  Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
  Send-InstallEvent $StepName
}

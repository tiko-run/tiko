---
title: Install
description: Install tiko on Linux, macOS or Windows with one command or step by step.
---

tiko runs in Docker on your own machine or server. The installer does everything for you; the manual steps below are for when you want to see each step or the installer cannot help.

## One command

On Linux or macOS, open a terminal and run:

```bash
curl -fsSL https://tiko.run/install.sh | sh
```

The installer:

1. Checks the machine: 64-bit Linux or macOS, at least 1 GB of memory (2 GB is better), 2 GB of free disk, a free port.
2. Installs Docker if it is missing, after asking: Docker Engine from [get.docker.com](https://get.docker.com) on Linux, [Colima](https://github.com/abiosoft/colima) with Homebrew on macOS.
3. Creates the folder `~/tiko` (`/opt/tiko` when run as root on Linux) with a generated password and secret key in `.env`.
4. Starts the latest release and prints the address, the username `admin` and the password.

Options go after `sh -s --`, for example `curl -fsSL https://tiko.run/install.sh | sh -s -- --yes --port 8080`:

| Option | Environment variable | What it does |
|---|---|---|
| `--yes` | `TIKO_YES=1` | Agree to everything, ask nothing |
| `--dir DIR` | `TIKO_DIR` | Install into another folder |
| `--port PORT` | `TIKO_PORT` | Serve on another port instead of 3000 |
| `--version 2026.10.12` | `TIKO_VERSION` | Install a specific release |

Run the same command again to upgrade: it keeps your boards, accounts and `.env`.

On Windows 10 or 11, open PowerShell and run:

```powershell
irm https://tiko.run/install.ps1 | iex
```

The Windows installer does the same, with Docker Desktop instead of Docker Engine:

1. Checks the machine: 64-bit Windows 10 version 2004 or later, at least 4 GB of memory, virtualization turned on in the firmware, 2 GB of free disk, a free port.
2. Installs WSL 2 if it is missing, after asking. Windows turns WSL on only while it starts, so the installer asks you to restart, then run the same line again.
3. Installs [Docker Desktop](https://docs.docker.com/desktop/) with `winget`, after asking, and starts it. On its first start Docker Desktop opens a few windows: press **Skip** on "Welcome to Docker" (tiko needs no Docker account), close "Welcome to Windows Subsystem for Linux", and answer the Windows Firewall question about "Docker Desktop Backend": **Allow** lets other devices on your network open tiko, **Cancel** keeps it on this computer.
4. Creates the folder `%USERPROFILE%\tiko`, starts the latest release, prints the address, the username and the password, and opens the browser.

Options: `& ([scriptblock]::Create((irm https://tiko.run/install.ps1))) -Yes -Port 8080`, with `-Dir` and `-Version` as well, or the same environment variables as above.

## Step by step

### 1. Install Docker

Docker runs tiko in containers, so nothing else gets installed on your system.

**Windows 10 or 11**

1. Check that virtualization is on: open Task Manager → Performance → CPU and look for "Virtualization: Enabled". If it says Disabled, turn on Intel VT-x or AMD-V in your computer's BIOS or UEFI settings.
2. Download [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) and run the installer. Keep "Use WSL 2 instead of Hyper-V" checked.
3. Restart the computer when the installer asks.
4. Open Docker Desktop from the Start menu, accept the terms and wait until the bottom left corner says "Engine running".

**macOS**

Pick one:

- [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/): download the version for your chip (Apple menu → About This Mac shows "Apple" or "Intel"), drag it to Applications, open it and wait until it says "Engine running".
- Colima, free and without a window, if you have [Homebrew](https://brew.sh):

  ```bash
  brew install colima docker docker-compose
  mkdir -p ~/.docker/cli-plugins
  ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose
  colima start
  ```

Docker Desktop is free for personal use, education and companies under 250 people and $10 million in revenue; larger companies need a paid plan. Colima has no such limit.

**Ubuntu or Debian**

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Sign out and back in, so you can run `docker` without `sudo`. Other distributions: [Docker Engine install guide](https://docs.docker.com/engine/install/).

**Check it**

In a terminal (PowerShell on Windows):

```bash
docker run hello-world
docker compose version
```

The first command prints "Hello from Docker!", the second a version like `v2.x`.

### 2. Start tiko

Linux and macOS:

```bash
mkdir ~/tiko && cd ~/tiko
curl -fsSL https://github.com/tiko-run/tiko/releases/latest/download/compose.release.yml -o compose.yaml
docker compose up -d
```

Windows, in PowerShell:

```powershell
mkdir $HOME\tiko; cd $HOME\tiko
Invoke-WebRequest https://github.com/tiko-run/tiko/releases/latest/download/compose.release.yml -OutFile compose.yaml
docker compose up -d
```

The first start downloads about 130 MB.

### 3. Sign in

Open http://localhost:3000 and sign in as `admin`. The password is generated on the first start and printed once to the log. Read it in the tiko folder.

Linux and macOS:

```bash
docker compose logs api | grep 'tiko password'
```

Windows, in PowerShell, which has no `grep`:

```powershell
docker compose logs api | Select-String 'tiko password'
```

Change it in Settings → Security. To pick your own from the start, put `TIKO_PASSWORD=...` into a file named `.env` next to `compose.yaml` before the first start; see [Configuration](../configuration/).

## Lost the password

Where the first password is kept depends on how you installed tiko. The examples use the default folder: `~/tiko`, `%USERPROFILE%\tiko` on Windows, or `/opt/tiko` when the installer ran as root on Linux.

**Installed with one command.** The password is the `TIKO_PASSWORD` line of the file `.env` in the tiko folder. The log does not have it.

- Windows: press `Win+R`, type `notepad %USERPROFILE%\tiko\.env` and press Enter. Or in PowerShell, from any folder: `Select-String TIKO_PASSWORD $HOME\tiko\.env`.
- Linux and macOS: `grep TIKO_PASSWORD ~/tiko/.env`, or `sudo grep TIKO_PASSWORD /opt/tiko/.env` when installed as root.

**Installed step by step.** If you put `TIKO_PASSWORD` into `.env` before the first start, it is that line of `.env`; read it with the commands above. Otherwise tiko generated the password and saved it to the file `data/password` in the tiko folder.

- Windows: press `Win+R`, type `notepad %USERPROFILE%\tiko\data\password` and press Enter. Or in PowerShell: `Get-Content $HOME\tiko\data\password`.
- Linux and macOS: `cat ~/tiko/data/password`, with `sudo` if it says "Permission denied".

**Changed it and forgot the new one.** Both files keep only the first password. Make a link that sets a new one. If you changed the username, put it in place of `admin`.

Windows, in PowerShell:

```powershell
cd $HOME\tiko
docker compose exec api python -m app.reset_password admin
```

Linux and macOS:

```bash
cd ~/tiko    # /opt/tiko when installed as root
docker compose exec api python -m app.reset_password admin
```

The command prints a line like `/?reset=...`. Add it to your tiko address, for example `http://localhost:3000/?reset=...`, and open it within 24 hours.

## Everyday commands

Run these in the tiko folder. A new terminal opens somewhere else, and PowerShell started as administrator opens in `C:\Windows\system32`, so go to the folder first: `cd ~/tiko` on Linux and macOS (`cd /opt/tiko` when installed as root), `cd $HOME\tiko` in PowerShell. Installed into another folder and forgot which? `docker compose ls` shows the path of a running tiko under "CONFIG FILES".

| Task | Command |
|---|---|
| Stop | `docker compose down` |
| Start again | `docker compose up -d` |
| See logs | `docker compose logs -f` |
| Upgrade | the one-line installer again, or `docker compose pull && docker compose up -d` |
| Uninstall | `docker compose down`, then delete the folder |

The folder's `data/` holds your boards, so back it up before deleting anything. More in [Data and upgrades](../data-and-upgrades/).

## When something goes wrong

- **"permission denied" on `/var/run/docker.sock` (Linux).** Your user is not in the `docker` group yet: run `sudo usermod -aG docker $USER`, sign out and back in, or prefix commands with `sudo`.
- **"port is already allocated" or the installer says the port is taken.** Another program uses port 3000. Use `--port 8080` with the installer, or set `TIKO_PORT=8080` in `.env`, then open http://localhost:8080.
- **"Cannot connect to the Docker daemon".** Docker is not running: open Docker Desktop, run `colima start` on macOS, or `sudo systemctl start docker` on Linux.
- **"no configuration file provided: not found".** The terminal is not in the tiko folder, so `docker compose` does not know which install you mean. Go there first: `cd ~/tiko`, `cd /opt/tiko` when installed as root, or `cd $HOME\tiko` in PowerShell.
- **PowerShell does not recognize `grep`.** Windows has no `grep`. Use `Select-String` in its place: `docker compose logs api | Select-String 'tiko password'`.
- **The password does not show up in the log.** After the one-line installer it is in `.env`, not in the log; see [Lost the password](#lost-the-password).
- **WSL errors on Windows.** Run `wsl --update` in PowerShell as administrator and restart. Docker's [troubleshooting page](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/) covers the rest.
- **The installer says tiko already runs from another folder.** One machine runs one tiko: stop the other with `docker compose down` in its folder, or upgrade it with `--dir` pointing there.
- **Behind a corporate proxy.** The installer follows `HTTPS_PROXY`; Docker needs its own [proxy settings](https://docs.docker.com/engine/daemon/proxy/).

Still stuck? Open an [issue](https://github.com/tiko-run/tiko/issues) with the installer's output.

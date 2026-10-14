<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/tiko-logo-dark.svg">
    <img src="brand/logo/tiko-logo.svg" alt="tiko" width="420">
  </picture>
</p>

<p align="center"><b>Open-source infinite canvas for your tasks</b></p>

<p align="center">
  <a href="https://tiko.run"><b>Website</b></a> •
  <a href="https://docs.tiko.run/"><b>Docs</b></a> •
  <a href="https://docs.tiko.run/quick-start/"><b>Quick start</b></a> •
  <a href="https://docs.tiko.run/roadmap/"><b>Roadmap</b></a> •
  <a href="https://github.com/tiko-run/tiko/discussions"><b>Discussions</b></a>
</p>

<p align="center">
  <a href="https://github.com/tiko-run/tiko/actions/workflows/ci.yml"><img src="https://github.com/tiko-run/tiko/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/tiko-run/tiko/releases"><img src="https://img.shields.io/github/v/release/tiko-run/tiko" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/tiko-run/tiko/stargazers"><img src="https://img.shields.io/github/stars/tiko-run/tiko" alt="GitHub stars"></a>
  <a href="https://github.com/tiko-run/tiko/discussions"><img src="https://img.shields.io/github/discussions/tiko-run/tiko" alt="Discussions"></a>
  <a href="https://docs.tiko.run/"><img src="https://img.shields.io/badge/docs-docs.tiko.run-8A2BE2" alt="Docs"></a>
</p>

![A tiko board: frames of live task cards with timers, sticky notes, arrows, a Gantt release plan and the focus timer](docs/assets/board.png)

## Contents

- [What is tiko](#what-is-tiko)
- [Why tiko](#why-tiko)
- [What you can do](#what-you-can-do)
- [Install](#install)
- [Documentation](#documentation)
- [Community](#community)
- [Security](#security)
- [Contributing](#contributing)
- [Activity](#activity)
- [License](#license)

## What is tiko

tiko is an open-source, self-hosted whiteboard where the tasks from your tracker live as cards. You lay them out the way you think about them, and their statuses update on their own.

It is for people who keep a lot of work in their head: leads, managers, anyone juggling tasks across projects.

## Why tiko

Trackers show work as lists and columns. A plan that spans several projects ends up in your head, or on a whiteboard that is out of date the day after you draw it.

tiko puts the same tasks on an infinite canvas and keeps them current. What makes it different:

- **Cards are live.** Each one shows the task's real status, refreshed while the board is open.
- **Your tracker stays in charge.** tiko reads tasks and never edits them. Each person connects their own token and sees only what their tracker access allows.
- **It is yours.** Self-hosted, one SQLite file, no telemetry.

Works with Jira Data Center and Server and with public GitHub issues today. Jira Cloud, Linear, Plane and others are planned: [all trackers](https://docs.tiko.run/trackers/).

## What you can do

### Put live tasks on a board

Add cards by key, link or query, or paste links straight from your tracker tabs. [Adding tasks →](https://docs.tiko.run/adding-tasks/)

<!-- demo: GIF or screencast of adding cards -->

### Arrange them the way you think

Frames, sticky notes, text and arrows around the cards, with smart guides that snap things into place. [The board →](https://docs.tiko.run/adding-tasks/#around-the-cards)

<!-- demo: GIF or screencast of frames, notes and arrows -->

### Plan on a timeline

Drop cards onto a Gantt to get bars with live status, stages, milestones and dependency lines. [Gantt →](https://docs.tiko.run/gantt/)

<!-- demo: GIF or screencast of the Gantt module -->

### Wait without watching

Put a timer next to a card. It goes off after a set time or when the task leaves its status. A focus timer with music sits at the top of the screen. [Timers and focus →](https://docs.tiko.run/focus-and-timers/)

<!-- demo: GIF or screencast of timers -->

### Find anything from the keyboard

`⌘K` searches the board and runs commands, and every tool has a shortcut. [Search →](https://docs.tiko.run/search/) · [Shortcuts →](https://docs.tiko.run/keyboard-shortcuts/)

<!-- demo: GIF or screencast of the palette -->

### Work on a board together

Invite people with a link and give each board viewers and editors. Everyone on a board sees each other's changes as they happen. [Working together →](https://docs.tiko.run/working-together/) · [Sharing →](https://docs.tiko.run/security/#sharing-boards)

<!-- demo: GIF or screencast of two people on one board -->

## Install

### One command

| System | Run |
|---|---|
| Linux, macOS | `curl -fsSL https://tiko.run/install.sh \| sh` |
| Windows 10, 11 (PowerShell) | `irm https://tiko.run/install.ps1 \| iex` |

The installer sets up Docker if it is missing, starts the latest release and prints the address, the username and the password. Options and step-by-step instructions: [install guide](https://docs.tiko.run/install/).

### Docker

```bash
mkdir tiko && cd tiko
curl -fsSL https://github.com/tiko-run/tiko/releases/latest/download/compose.release.yml -o compose.yaml
docker compose up -d
```

### From source

```bash
git clone https://github.com/tiko-run/tiko.git
cd tiko
docker compose up --build
```

With Docker or from source, open http://localhost:3000 and sign in as `admin`. The password is in the log: `docker compose logs api | grep 'tiko password'`. In PowerShell use `Select-String` in place of `grep`. Lost the password? See [the guide](https://docs.tiko.run/install/#lost-the-password).

### Cloud

<a href="https://tiko.run"><img src="brand/button/tiko-cloud-button.svg" alt="Start on tiko Cloud, free" height="40"></a>

**tiko Cloud** is tiko hosted by us, with nothing to install and a free plan. Coming soon.

Or deploy your own copy:

| Platform | Deploy |
|---|---|
| Railway | [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/tiko?referralCode=wFuy8y&utm_medium=integration&utm_source=button&utm_campaign=tiko) |
| Render | [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tiko-run/tiko) |
| DigitalOcean | Coming soon |

After the deploy sign in as `admin`. The password is generated for you: it is the `TIKO_PASSWORD` variable of the `api` service on Railway, or of `tiko-api` on Render. Costs and limits of each platform are in the [quick start](https://docs.tiko.run/quick-start/#on-railway).

A fresh install opens on a sample board with demo tasks, so you can try everything before you [connect your tracker](https://docs.tiko.run/jira-data-center/).

## Documentation

Everything else lives at [docs.tiko.run](https://docs.tiko.run/).

| | |
|---|---|
| Get started | [Install](https://docs.tiko.run/install/) · [Quick start](https://docs.tiko.run/quick-start/) |
| Use tiko | [Adding tasks](https://docs.tiko.run/adding-tasks/) · [Working together](https://docs.tiko.run/working-together/) · [Search](https://docs.tiko.run/search/) · [Gantt](https://docs.tiko.run/gantt/) · [Timers and focus](https://docs.tiko.run/focus-and-timers/) · [Shortcuts](https://docs.tiko.run/keyboard-shortcuts/) |
| Trackers | [Supported trackers](https://docs.tiko.run/trackers/) · [Connect Jira Data Center](https://docs.tiko.run/jira-data-center/) |
| Self-host | [Configuration](https://docs.tiko.run/configuration/) · [Data, backups and upgrades](https://docs.tiko.run/data-and-upgrades/) · [Updates](https://docs.tiko.run/updates/) · [Security and privacy](https://docs.tiko.run/security/) |
| Project | [Roadmap](https://docs.tiko.run/roadmap/) · [Architecture](https://docs.tiko.run/architecture/) · [Changelog](CHANGELOG.md) |

## Community

- Ideas, questions and feature requests go to [Discussions](https://github.com/tiko-run/tiko/discussions).
- Found a bug? Open an [issue](https://github.com/tiko-run/tiko/issues/new/choose).
- What we build next is in the [roadmap](https://docs.tiko.run/roadmap/).

## Security

- Every page and API route asks you to sign in.
- Tracker tokens are encrypted on the server and never sent back to the browser or written to logs.
- tiko sends no telemetry. It talks to your tracker and, unless you turn it off, to GitHub to check for a new release.

Details: [Security and privacy](https://docs.tiko.run/security/). Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## Contributing

Bug reports, ideas and pull requests are welcome, and a new tracker provider is a good first contribution. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [architecture overview](https://docs.tiko.run/architecture/). On your first pull request a bot asks you to sign the [CLA](CLA.md), once. Everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md).

<a href="https://github.com/tiko-run/tiko/graphs/contributors"><img src="https://contrib.rocks/image?repo=tiko-run/tiko" alt="Contributors"></a>

## Activity

<p>
  <a href="https://github.com/tiko-run/tiko/commits/main"><img src="https://img.shields.io/github/commit-activity/m/tiko-run/tiko" alt="Commit activity"></a>
  <a href="https://github.com/tiko-run/tiko/commits/main"><img src="https://img.shields.io/github/last-commit/tiko-run/tiko" alt="Last commit"></a>
  <a href="https://github.com/tiko-run/tiko/graphs/contributors"><img src="https://img.shields.io/github/contributors/tiko-run/tiko" alt="Contributors"></a>
  <a href="https://github.com/tiko-run/tiko/issues"><img src="https://img.shields.io/github/issues/tiko-run/tiko" alt="Open issues"></a>
</p>

<a href="https://star-history.com/#tiko-run/tiko&Date"><img src="https://api.star-history.com/svg?repos=tiko-run/tiko&type=Date" alt="Star history" width="600"></a>

## License

[GNU AGPL v3](LICENSE) (`AGPL-3.0-only`) © The tiko Authors. Use, self-host and modify tiko for free, privately or inside a company. If you let people use a changed version over a network, offer them its source under the same license.

The name and logo are covered by [TRADEMARKS.md](TRADEMARKS.md), third-party components are listed in [THIRD_PARTY.md](THIRD_PARTY.md). For other terms, such as embedding tiko in a closed product, email smacktur@gmail.com. Releases up to and including `v2026.10.6` were published under the MIT License and stay available under it.

# Implementation Plan: One-command installer

**Branch**: `010-installer` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/010-installer/spec.md`

## Summary

Two scripts in the repository, `install/install.sh` for Linux and macOS and `install/install.ps1` for Windows, published with the user guide on GitHub Pages and later under `tiko.run` through Cloudflare. They check the machine, install Docker when it is missing, write `.env` with generated secrets, download the release compose file and start tiko. A new "Install" page in the guide covers the manual path. Delivered in 3 slices.

## Technical Context

**Language**: POSIX `sh`, PowerShell 5.1 (built into Windows 10 and 11).

**Primary Dependencies**: none new in tiko. The scripts call `get.docker.com` on Linux, Homebrew with `colima`, `docker` and `docker-compose` on macOS, `winget` and `wsl` on Windows.

**Testing**: `shellcheck` and `PSScriptAnalyzer` in CI; a CI job on `ubuntu-latest` (Docker present) runs `install.sh --yes` into a temporary folder and curls the sign-in page; the Docker-install path on a clean Ubuntu VM and a clean Windows 11 VM by hand; macOS on the owner's Mac (with Docker, and with Colima on a user without Docker).

**Constraints**: works when piped from `curl`; never overwrites `.env` or `data/`; asks before installing anything; the published script equals the one on `main`.

## Constitution Check

| Principle | Status |
|---|---|
| I. Main always runs | Pass: one branch per slice |
| II. Works without keys | Pass: secrets are generated |
| III. Hypothesis-driven scope | Pass: G1 2026-10-09, launch plan |
| IV. Vertical slices | Pass: each slice ends with a working command and a guide page |
| V. Contract-first | Pass: no API change; `compose.release.yml` gets one variable |
| VI. Production feel, minimal | Pass: two scripts, no installer framework |
| VII. Clean code | Pass: `shellcheck` clean |
| VIII. Verifiable tasks | Pass: CI install job, VM runs |

## Design

```text
install/install.sh            main(): parse flags → detect OS, arch → check resources, port
                              → ensure Docker (install if agreed) → folder, .env (once)
                              → download compose.release.yml → pull, up -d → wait → print
install/install.ps1           same steps; WSL 2 and Docker Desktop via winget; restart handoff
compose.release.yml           ports: "${TIKO_PORT:-3000}:3000"
.github/workflows/release.yml attach compose.release.yml with TAG pinned to the release
.github/workflows/docs.yml    copy install/* into the guide's public folder before the build
.github/workflows/ci.yml      shellcheck, PSScriptAnalyzer, install.sh --yes end to end
docs/guide/.../install.md     one line per system, manual Docker steps, update, uninstall, fixes
README.md                     Quick start: the one line first, the manual way after
```

**Folders**: `/opt/tiko` as root on Linux, `~/tiko` otherwise, `%USERPROFILE%\tiko` on Windows, `TIKO_DIR` wins.

**Questions on a pipe**: read from `/dev/tty`; without a terminal and without `--yes` the script stops.

**Reuse**: `scripts/ensure-docker.sh` keeps working for `make up`; the installer has its own copy of the start-and-wait logic, because it is downloaded alone.

## Domain (owner, outside the repository)

1. Add `tiko.run` to Cloudflare (free plan), switch the domain's nameservers to Cloudflare's.
2. `docs.tiko.run`: CNAME to `tiko-run.github.io`, set as the Pages custom domain of `tiko-run/tiko`; the guide's `site` and `base` change to `https://docs.tiko.run` and `/` in slice 3.
3. Redirect rules: `tiko.run/install.sh` and `tiko.run/install.ps1` → `https://docs.tiko.run/install.sh` and `.ps1` (302, keeps working when the apex later points elsewhere).
4. `tiko.run` apex: a redirect to `docs.tiko.run` until the landing page exists.

## Slices

1. `feat/install-sh` (US1, part of US3): `install.sh`, compose port, release asset, docs publishing, CI, guide page with the Linux and macOS parts, README.
2. `feat/install-ps1` (US2, rest of US3): `install.ps1`, guide page Windows part.
3. `feat/tiko-run-domain`: after the owner's Cloudflare setup, switch the guide to `docs.tiko.run` and all install lines to `tiko.run`.

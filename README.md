# Glade

Glade is a fantasy-themed Electron shell for Codex-style development workflows. The long-term goal is to build Glade from within Glade as early as possible, so the first milestone focuses on a practical self-hosting loop rather than heavy game systems.

## Step 0 POC

This iteration includes:

- an Electron desktop shell
- a React renderer with a multi-camp layout
- persisted camp storage between launches
- importing existing git repositories into the glade
- an IPC bridge for shell sessions
- an `xterm` campfire terminal backed by `node-pty`
- branch and worktree discovery for the selected camp
- placeholder panels for token telemetry and MCP "merchant" slots
- groundwork for native and WSL camp execution modes

## Stack

- Electron
- React
- TypeScript
- Vite
- xterm.js
- node-pty

## Getting started

Install Node.js 20+ first, then:

```bash
npm install
npm run dev
```

On Ubuntu 24.04, Electron needed these runtime libraries on this machine:

- `libnss3`
- `libnspr4`
- `libasound2t64`

Install them with:

```bash
sudo apt install libnss3 libnspr4 libasound2t64
```

By default, Glade seeds itself with the repo you launched it from. After that you can import any existing git repo into the camp roster from the UI.

You can still override the seed repo on boot:

```bash
GLADE_PROJECT_ROOT=/path/to/project npm run dev
```

## Native Windows Run From WSL

The long-term target is a native Windows Glade app that can still open WSL and Windows repos. This repo now includes a helper script for that flow:

```bash
./scripts/windows-native.sh start
```

What it does:

- bootstraps a portable Windows Node toolchain under `C:\Users\<you>\tools` if needed
- syncs the repo into `C:\Users\<you>\dev\glade-native`
- installs Windows-side dependencies when they are missing
- launches the Windows-native Electron app from that mirrored checkout

Other useful commands:

```bash
./scripts/windows-native.sh build
./scripts/windows-native.sh dev
./scripts/windows-native.sh sync
```

This is the preferred path for performance while the source of truth still lives in WSL.

## Current direction

- The short-term self-hosting goal is to run Glade natively and use it to manage the Glade repo itself.
- The desired long-term setup is a native Windows Glade app that can open both Windows repos and WSL repos.
- The current codebase already models camp environments so we can add the Windows-to-WSL bridge without reshaping the app again.

## Near-term roadmap

1. Add richer Windows and WSL execution adapters.
2. Add better session lifecycle controls and recovery.
3. Surface real Codex usage telemetry in the ledger.
4. Add merchant workflows for MCP attachment and inspection.
5. Build the next Glade features from inside Glade.

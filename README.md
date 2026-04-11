# Glade

Glade is a fantasy-themed Electron shell for Codex-style development workflows. The long-term goal is to build Glade from within Glade as early as possible, so the first milestone focuses on a practical self-hosting loop rather than heavy game systems.

## Step 0 POC

This initial scaffold includes:

- an Electron desktop shell
- a React renderer with the first "camp" layout
- an IPC bridge for shell sessions
- an `xterm` campfire terminal backed by `node-pty`
- branch and worktree discovery for the current project
- placeholder panels for token telemetry and MCP "merchant" slots

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

On Linux, Electron also needs common desktop runtime libraries. On this machine the missing set was:

- `libnss3`
- `libnssutil3`
- `libsmime3`
- `libnspr4`
- `libasound2`

For Debian or Ubuntu systems, that usually looks like:

```bash
sudo apt install libnss3 libnssutil3 libsmime3 libnspr4 libasound2
```

The app uses the current working directory as the active camp root. You can also point it elsewhere:

```bash
GLADE_PROJECT_ROOT=/path/to/project npm run dev
```

## Near-term roadmap

1. Preserve and restore multiple camps.
2. Add richer session lifecycle controls.
3. Surface real Codex usage telemetry in the ledger.
4. Add merchant workflows for MCP attachment and inspection.
5. Shift Glade development into Glade as soon as the editing loop is solid.

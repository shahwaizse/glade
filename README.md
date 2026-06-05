# Glade

Glade is a local-first web app for personal software-factory workflows. It imports existing Git repositories, validates project identity boundaries, keeps project-specific notes and work items, and launches shell, Codex, or Claude Code sessions in the selected project.

The app is intentionally a normal web app now: run the Node server wherever the projects live. For WSL projects, run Glade inside WSL. For Windows projects, run Glade in Windows.

## Required Local Setup

Each project should already have:

- a Git repository
- `git config --local user.name`
- `git config --local user.email`
- an `origin` remote
- preferably `git config --local core.sshCommand "ssh -i /absolute/key -o IdentitiesOnly=yes -F /dev/null"`
- a known browser profile path or label

Slack and Notion are represented as scoped connector config in this first version. MCP-backed intake comes next.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

The API server listens on `http://127.0.0.1:8787` by default. Override with:

```bash
GLADE_PORT=8790 npm run dev
```

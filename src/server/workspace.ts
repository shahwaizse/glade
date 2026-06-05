import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  PreflightCheck,
  ProjectOverview,
  ProjectRecord,
  ProjectStatus,
  WorktreeSummary,
} from "../shared/types";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string) {
  const result = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
    },
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function readGit(args: string[], cwd: string) {
  try {
    return await runGit(args, cwd);
  } catch {
    return "";
  }
}

export async function resolveRepoRoot(candidatePath: string) {
  const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    cwd: candidatePath,
    windowsHide: true,
  });
  const rootPath = result.stdout.trim();
  if (!rootPath) {
    throw new Error("That folder is not inside a Git repository.");
  }

  return process.platform === "win32" ? path.win32.normalize(rootPath) : path.resolve(rootPath);
}

export async function getProjectOverview(project: ProjectRecord): Promise<ProjectOverview> {
  const [branch, status, worktrees, gitName, gitEmail, originRemote, preflight] = await Promise.all([
    detectBranch(project.rootPath),
    detectStatus(project.rootPath),
    detectWorktrees(project.rootPath),
    readGit(["config", "--local", "user.name"], project.rootPath),
    readGit(["config", "--local", "user.email"], project.rootPath),
    readGit(["remote", "get-url", "origin"], project.rootPath),
    runPreflight(project),
  ]);

  return {
    ...project,
    branch,
    gitEmail,
    gitName,
    originRemote,
    preflight,
    status,
    worktrees,
  };
}

async function detectBranch(rootPath: string) {
  return (await readGit(["branch", "--show-current"], rootPath)) || "detached";
}

async function detectStatus(rootPath: string): Promise<ProjectStatus> {
  const output = await readGit(["status", "--short"], rootPath);
  if (!output) {
    return "clean";
  }

  return output.includes("??") ? "untracked" : "dirty";
}

async function detectWorktrees(rootPath: string): Promise<WorktreeSummary[]> {
  const output = await readGit(["worktree", "list", "--porcelain"], rootPath);
  if (!output) {
    return [];
  }

  const currentPath = normalizePath(rootPath);
  return output
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n").filter(Boolean);
      const entry: Partial<WorktreeSummary> = {};

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          entry.path = line.replace("worktree ", "");
        }
        if (line.startsWith("branch refs/heads/")) {
          entry.branch = line.replace("branch refs/heads/", "");
        }
      }

      if (!entry.path) {
        return null;
      }

      return {
        branch: entry.branch ?? "detached",
        isCurrent: normalizePath(entry.path) === currentPath,
        path: entry.path,
      };
    })
    .filter((entry): entry is WorktreeSummary => entry !== null);
}

async function runPreflight(project: ProjectRecord): Promise<PreflightCheck[]> {
  const [repoRoot, gitName, gitEmail, originRemote, sshCommand, ignoredLocal, gitModules] = await Promise.all([
    readGit(["rev-parse", "--show-toplevel"], project.rootPath),
    readGit(["config", "--local", "user.name"], project.rootPath),
    readGit(["config", "--local", "user.email"], project.rootPath),
    readGit(["remote", "get-url", "origin"], project.rootPath),
    readGit(["config", "--local", "core.sshCommand"], project.rootPath),
    readGit(["check-ignore", ".glade", ".glade.local"], project.rootPath),
    readGit(["config", "--file", ".gitmodules", "--get-regexp", "url"], project.rootPath),
  ]);

  const checks: PreflightCheck[] = [
    makeCheck("repo", "Git repo", repoRoot, "Git could not resolve a repository root.", true),
    makeCheck("git-name", "Local Git name", gitName, "Set git config --local user.name.", true),
    makeCheck("git-email", "Local Git email", gitEmail, "Set git config --local user.email.", true),
    makeCheck("origin", "Origin remote", originRemote, "Set a project-specific origin remote.", true),
    {
      detail: sshCommand || project.profile.sshKeyPath || "Set core.sshCommand or a project SSH key path.",
      id: "ssh",
      label: "SSH boundary",
      severity: sshCommand || project.profile.sshKeyPath ? "pass" : "warn",
    },
    {
      detail: project.profile.browserProfile || "Record the Chrome profile/user-data path for this project.",
      id: "browser",
      label: "Browser profile",
      severity: project.profile.browserProfile ? "pass" : "warn",
    },
    {
      detail: ignoredLocal || "Add .glade and .glade.local to .gitignore.",
      id: "local-ignore",
      label: "Local metadata ignored",
      severity: ignoredLocal ? "pass" : "warn",
    },
    {
      detail: project.profile.slack.enabled
        ? project.profile.slack.scope || "Slack enabled without a channel/workspace allowlist."
        : "Disabled for now.",
      id: "slack",
      label: "Slack scope",
      severity: project.profile.slack.enabled && !project.profile.slack.scope ? "warn" : "pass",
    },
    {
      detail: project.profile.notion.enabled
        ? project.profile.notion.scope || "Notion enabled without a page/database allowlist."
        : "Disabled for now.",
      id: "notion",
      label: "Notion scope",
      severity: project.profile.notion.enabled && !project.profile.notion.scope ? "warn" : "pass",
    },
  ];

  if (project.profile.expectedRemote) {
    checks.push({
      detail: originRemote === project.profile.expectedRemote
        ? originRemote
        : `Expected ${project.profile.expectedRemote}, found ${originRemote || "nothing"}.`,
      id: "expected-remote",
      label: "Expected remote",
      severity: originRemote === project.profile.expectedRemote ? "pass" : "fail",
    });
  }

  if (project.profile.expectedIdentity) {
    const marker = project.profile.expectedIdentity.toLowerCase();
    const matched = [gitName, gitEmail, originRemote].some((value) => value.toLowerCase().includes(marker));
    checks.push({
      detail: matched ? project.profile.expectedIdentity : `Marker not found: ${project.profile.expectedIdentity}`,
      id: "expected-identity",
      label: "Expected identity",
      severity: matched ? "pass" : "warn",
    });
  }

  if (gitModules) {
    checks.push({
      detail: gitModules,
      id: "submodules",
      label: "Submodule remotes",
      severity: "warn",
    });
  }

  return checks;
}

function makeCheck(id: string, label: string, value: string, emptyDetail: string, required: boolean): PreflightCheck {
  return {
    detail: value || emptyDetail,
    id,
    label,
    severity: value ? "pass" : required ? "fail" : "warn",
  };
}

function normalizePath(value: string) {
  return process.platform === "win32" ? path.win32.resolve(value).toLowerCase() : path.resolve(value);
}

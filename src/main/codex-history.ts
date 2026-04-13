import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type {
  CodexMessage,
  CodexThreadDetail,
  CodexThreadSummary,
  LiveCodexReply,
  SendCodexMessageInput,
} from "../shared/types";

interface SessionMetaRecord {
  cwd: string;
  id: string;
  source: string | null;
  timestamp: string;
}

function createMessageId(seed: string) {
  return createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

function toWslPath(windowsPath: string) {
  const normalized = windowsPath.replace(/\\/g, "/");
  const drive = normalized.slice(0, 1).toLowerCase();
  const tail = normalized.slice(2);
  return `/mnt/${drive}${tail}`;
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCodexHome() {
  const candidates = [
    process.env.CODEX_HOME,
    path.join(os.homedir(), ".codex"),
  ].filter((value): value is string => Boolean(value));

  if (process.platform === "linux" && process.env.WSL_DISTRO_NAME && process.env.USERPROFILE) {
    candidates.push(path.join(toWslPath(process.env.USERPROFILE), ".codex"));
  }

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? path.join(os.homedir(), ".codex");
}

async function resolveCodexCommand(
  input: SendCodexMessageInput,
): Promise<{ args: string[]; command: string; cwd?: string; env?: NodeJS.ProcessEnv }> {
  const commandArgs = input.threadId
    ? ["exec", "resume", "--json", "--skip-git-repo-check", input.threadId, "-"]
    : ["exec", "--json", "--skip-git-repo-check", "-"];

  const looksLikeWslPath = input.cwd.startsWith("/");
  const shouldUseWsl = process.platform === "win32" && (input.environment === "wsl" || looksLikeWslPath);
  if (shouldUseWsl) {
    const codexHome = await resolveCodexHome();
    const nativeWslCodexPath = path.join(codexHome, "bin", "wsl", "codex");
    const wslCodexPath = toWslPath(nativeWslCodexPath);
    const executable = (await pathExists(nativeWslCodexPath)) || (await pathExists(wslCodexPath))
      ? wslCodexPath
      : "codex";
    const args = [];

    if (input.wslDistro) {
      args.push("-d", input.wslDistro);
    }

    args.push("--cd", toWslCwd(input.cwd), "--", executable, ...commandArgs);

    return {
      args,
      command: "wsl.exe",
      env: process.env,
    };
  }

  return {
    args: commandArgs,
    command: "codex",
    cwd: input.cwd,
    env: process.env,
  };
}

function toWslCwd(targetPath: string) {
  if (/^[A-Za-z]:\\/.test(targetPath)) {
    return toWslPath(targetPath);
  }

  return targetPath;
}

async function collectSessionFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return collectSessionFiles(nextPath);
      }

      return entry.name.endsWith(".jsonl") ? [nextPath] : [];
    }),
  );

  return nested.flat().sort((left, right) => right.localeCompare(left));
}

function parseThreadTitle(messages: CodexMessage[], fallbackCwd: string) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (firstUserMessage?.text) {
    const singleLine = firstUserMessage.text.replace(/\s+/g, " ").trim();
    return singleLine.slice(0, 88) || path.basename(fallbackCwd);
  }

  return path.basename(fallbackCwd);
}

function isRelevantCwd(threadCwd: string, activeCwd?: string) {
  if (!activeCwd) {
    return true;
  }

  const normalizedThread = threadCwd.replace(/\\/g, "/");
  const normalizedActive = activeCwd.replace(/\\/g, "/");
  return normalizedThread.startsWith(normalizedActive) || normalizedActive.startsWith(normalizedThread);
}

function mapSessionDetail(filePath: string, raw: string): CodexThreadDetail | null {
  const lines = raw.split("\n").filter(Boolean);
  let sessionMeta: SessionMetaRecord | null = null;
  const messages: CodexMessage[] = [];

  for (const line of lines) {
    const record = JSON.parse(line) as Record<string, unknown>;
    const type = record.type;
    const payload = (record.payload ?? {}) as Record<string, unknown>;
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : new Date().toISOString();

    if (type === "session_meta") {
      sessionMeta = {
        cwd: String(payload.cwd ?? ""),
        id: String(payload.id ?? path.basename(filePath)),
        source: typeof payload.source === "string" ? payload.source : null,
        timestamp: String(payload.timestamp ?? timestamp),
      };
    }

    if (type === "event_msg" && payload.type === "user_message" && typeof payload.message === "string") {
      messages.push({
        id: createMessageId(`${filePath}:${timestamp}:user:${messages.length}`),
        phase: null,
        role: "user",
        text: payload.message.trim(),
        timestamp,
      });
    }

    if (type === "event_msg" && payload.type === "agent_message" && typeof payload.message === "string") {
      messages.push({
        id: createMessageId(`${filePath}:${timestamp}:assistant:${messages.length}`),
        phase: typeof payload.phase === "string" ? payload.phase : null,
        role: "assistant",
        text: payload.message.trim(),
        timestamp,
      });
    }
  }

  if (!sessionMeta) {
    return null;
  }

  const updatedAt = messages.at(-1)?.timestamp ?? sessionMeta.timestamp;

  return {
    cwd: sessionMeta.cwd,
    id: sessionMeta.id,
    messageCount: messages.length,
    messages,
    source: sessionMeta.source,
    title: parseThreadTitle(messages, sessionMeta.cwd),
    updatedAt,
  };
}

export class CodexHistoryStore {
  async getThreads(activeCwd?: string): Promise<CodexThreadSummary[]> {
    const codexHome = await resolveCodexHome();
    const sessionsPath = path.join(codexHome, "sessions");
    const files = await collectSessionFiles(sessionsPath);
    const details = await Promise.all(
      files.slice(0, 200).map(async (filePath) => {
        const raw = await readFile(filePath, "utf8");
        return mapSessionDetail(filePath, raw);
      }),
    );

    return details
      .filter((detail): detail is CodexThreadDetail => detail !== null)
      .filter((detail) => isRelevantCwd(detail.cwd, activeCwd))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(({ messages, ...summary }) => summary);
  }

  async getThread(threadId: string): Promise<CodexThreadDetail | null> {
    const codexHome = await resolveCodexHome();
    const sessionsPath = path.join(codexHome, "sessions");
    const files = await collectSessionFiles(sessionsPath);

    for (const filePath of files) {
      const raw = await readFile(filePath, "utf8");
      const detail = mapSessionDetail(filePath, raw);
      if (detail?.id === threadId) {
        return detail;
      }
    }

    return null;
  }

  async sendMessage(input: SendCodexMessageInput): Promise<LiveCodexReply> {
    return new Promise((resolve, reject) => {
      let threadId = input.threadId ?? "";
      let stderr = "";
      let resolved = false;
      const startedAt = new Date().toISOString();
      void resolveCodexCommand(input)
        .then(({ args, command, cwd, env }) => {
          const processHandle = spawn(command, args, {
            cwd,
            env,
            windowsHide: true,
          });

          processHandle.stdin.end(input.prompt);

          const timeoutHandle = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              processHandle.kill();
              reject(new Error("Codex took too long to respond."));
            }
          }, 180000);

          const stdoutReader = readline.createInterface({ input: processHandle.stdout });
          stdoutReader.on("line", (line) => {
            try {
              const record = JSON.parse(line) as Record<string, unknown>;
              if (record.type === "thread.started" && typeof record.thread_id === "string") {
                threadId = record.thread_id;
              }
            } catch {
              return;
            }
          });

          processHandle.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
          });

          const poll = async () => {
            if (resolved) {
              return;
            }

            try {
              const matchingThread = threadId
                ? await this.getThread(threadId)
                : (await this.getThreads(input.cwd)).find((candidate) => candidate.updatedAt >= startedAt)
                  ? await this.getThread(
                      (await this.getThreads(input.cwd)).find((candidate) => candidate.updatedAt >= startedAt)!.id,
                    )
                  : null;

              if (matchingThread) {
                const lastAssistant = [...matchingThread.messages]
                  .reverse()
                  .find((message) => message.role === "assistant");

                if (lastAssistant && lastAssistant.timestamp >= startedAt) {
                  resolved = true;
                  clearTimeout(timeoutHandle);
                  stdoutReader.close();
                  processHandle.kill();
                  resolve({
                    response: lastAssistant.text.trim() || "Codex finished without a readable response.",
                    threadId: matchingThread.id,
                  });
                  return;
                }
              }
            } catch {
              // Keep polling while Codex is still writing the session file.
            }

            setTimeout(() => {
              void poll();
            }, 1000);
          };

          void poll();

          processHandle.on("error", (error) => {
            if (!resolved) {
              clearTimeout(timeoutHandle);
              reject(error);
            }
          });

          processHandle.on("close", (code) => {
            if (resolved) {
              return;
            }
            clearTimeout(timeoutHandle);
            reject(
              new Error(
                stderr.trim() || `Codex exited before returning a message (code ${code ?? "unknown"}).`,
              ),
            );
          });
        })
        .catch((error) => {
          reject(error instanceof Error ? error : new Error("Failed to launch Codex."));
        });
    });
  }
}

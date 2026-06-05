import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { createTerminalSocket } from "./api";
import type { AgentProvider, ProjectOverview, TerminalDataEvent } from "../shared/types";

export function TerminalPane({ agent, project }: { agent: AgentProvider | "shell"; project: ProjectOverview }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState("Starting session");

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: "#0b0d0c",
        black: "#0b0d0c",
        blue: "#557f8a",
        brightBlack: "#4e5651",
        brightBlue: "#77a0ab",
        brightGreen: "#78927b",
        brightRed: "#d25442",
        brightWhite: "#fff8ea",
        cursor: "#dcc9a9",
        foreground: "#ebe3d4",
        green: "#4e6851",
        red: "#b83a2d",
        selectionBackground: "rgba(220, 201, 169, 0.24)",
        white: "#ebe3d4",
        yellow: "#dcc9a9",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();

    terminalRef.current = terminal;
    fitRef.current = fit;

    const socket = createTerminalSocket(project.id, agent);
    socketRef.current = socket;
    socket.addEventListener("open", () => setStatus(`Connected to ${agent}`));
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data as string) as Partial<TerminalDataEvent> & { exitCode?: number };
      if (typeof payload.data === "string") {
        terminal.write(payload.data);
      }
      if (typeof payload.exitCode === "number") {
        setStatus(`Exited with code ${payload.exitCode}`);
      }
    });
    socket.addEventListener("close", () => setStatus("Session closed"));
    socket.addEventListener("error", () => setStatus("Terminal socket error"));

    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });

    const observer = new ResizeObserver(() => {
      if (!terminalRef.current || !fitRef.current) {
        return;
      }

      fitRef.current.fit();
    });
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      input.dispose();
      socket.close();
      socketRef.current = null;
      terminal.dispose();
    };
  }, [agent, project.id]);

  function send(command: string) {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(command);
    }
  }

  return (
    <>
      <div className="terminal-actions">
        <span>{status}</span>
        <button className="button secondary" onClick={() => send("git status\n")} type="button">git status</button>
        <button className="button secondary" onClick={() => send("git worktree list\n")} type="button">worktrees</button>
        <button className="button secondary" onClick={() => send("pwd\n")} type="button">pwd</button>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </>
  );
}

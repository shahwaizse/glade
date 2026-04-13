import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { CampOverview, TerminalSessionSummary } from "../../shared/types";

const QUICK_COMMANDS = [
  { label: "codex", command: "codex\n" },
  { label: "status", command: "git status\n" },
  { label: "trees", command: "git worktree list\n" },
  { label: "files", command: "ls\n" },
  { label: "where", command: "pwd\n" },
];

interface SessionConsoleProps {
  camp: CampOverview | null;
  compact?: boolean;
}

export function SessionConsole({ camp, compact = false }: SessionConsoleProps) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<TerminalSessionSummary | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [sessionStatus, setSessionStatus] = useState("Summoning shell...");

  useEffect(() => {
    if (!camp || !terminalHostRef.current) {
      return;
    }

    let disposed = false;
    const terminal = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      fontFamily: '"Iosevka Term", "Cascadia Code", monospace',
      fontSize: 14,
      theme: {
        background: "#0f160f",
        brightGreen: "#9fdb8a",
        brightYellow: "#f8d37a",
        cursor: "#f2e7c4",
        foreground: "#e7eddc",
        green: "#7cb06e",
        red: "#d96c54",
        selectionBackground: "rgba(187, 229, 165, 0.22)",
        yellow: "#ddb366",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const detachData = window.glade.onTerminalData((event) => {
      if (event.sessionId === sessionRef.current?.id) {
        terminal.write(event.data);
      }
    });

    const detachExit = window.glade.onTerminalExit((event) => {
      if (event.sessionId === sessionRef.current?.id) {
        setSessionStatus(`Shell closed with exit code ${event.exitCode}`);
        terminal.writeln("");
        terminal.writeln(`[glade] session ended (${event.exitCode})`);
      }
    });

    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionRef.current?.id;
      if (!sessionId) {
        return;
      }

      void window.glade.writeTerminal({ data, sessionId });
    });

    void window.glade
      .createTerminal({
        campId: camp.id,
        cols: terminal.cols,
        rows: terminal.rows,
      })
      .then((session) => {
        if (disposed) {
          void window.glade.killTerminal(session.id);
          return;
        }
        sessionRef.current = session;
        setSessionStatus(`Active at ${session.cwd}`);
      })
      .catch((error) => {
        if (!disposed) {
          setSessionStatus(error instanceof Error ? error.message : "Failed to start shell");
        }
      });

    resizeObserverRef.current = new ResizeObserver(() => {
      const fit = fitAddonRef.current;
      const sessionId = sessionRef.current?.id;
      const activeTerminal = terminalRef.current;
      if (!fit || !activeTerminal || !sessionId) {
        return;
      }

      fit.fit();
      void window.glade.resizeTerminal({
        cols: activeTerminal.cols,
        rows: activeTerminal.rows,
        sessionId,
      });
    });
    resizeObserverRef.current.observe(terminalHostRef.current);

    return () => {
      disposed = true;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      detachData();
      detachExit();
      inputDisposable.dispose();
      if (sessionRef.current) {
        void window.glade.killTerminal(sessionRef.current.id);
      }
      sessionRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [camp]);

  function runQuickCommand(command: string) {
    const sessionId = sessionRef.current?.id;
    if (!sessionId) {
      return;
    }

    void window.glade.writeTerminal({ data: command, sessionId });
  }

  return (
    <section className={`panel console-panel ${compact ? "console-panel--compact" : ""}`}>
      <div className="panel-header">
        <div>
          <span className="eyebrow">Shell</span>
          <h3>Campfire Session</h3>
        </div>
        <span className="console-status">{sessionStatus}</span>
      </div>

      <div className="quick-actions">
        {QUICK_COMMANDS.map((action) => (
          <button
            className="ghost-button"
            key={action.label}
            onClick={() => runQuickCommand(action.command)}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="terminal-host" ref={terminalHostRef} />
    </section>
  );
}

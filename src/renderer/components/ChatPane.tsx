import { useState } from "react";
import type { CampOverview, CodexThreadDetail } from "../../shared/types";

interface ChatPaneProps {
  camp: CampOverview | null;
  error?: string | null;
  isSending: boolean;
  onSendMessage: (prompt: string) => Promise<void>;
  thread: CodexThreadDetail | null;
}

export function ChatPane({ camp, error, isSending, onSendMessage, thread }: ChatPaneProps) {
  const [draft, setDraft] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextPrompt = draft.trim();
    if (!nextPrompt || !camp || isSending) {
      return;
    }

    setDraft("");
    await onSendMessage(nextPrompt);
  }

  return (
    <section className="panel chat-panel">
      <div className="panel-header chat-panel__header">
        <div>
          <span className="eyebrow">Codex Archive</span>
          <h3>{thread?.title ?? "Choose a thread or start a new one"}</h3>
        </div>
        <span className="console-status">
          {thread ? `${thread.messageCount} messages` : "Imported sessions appear here"}
        </span>
      </div>

      <div className="chat-timeline">
        {error ? <div className="chat-inline-error">{error}</div> : null}
        {thread?.messages.length ? (
          thread.messages.map((message, index) => (
            <article
              className={`chat-message chat-message--${message.role}`}
              key={`${message.id}-${index}`}
            >
              <div className="chat-message__meta">
                <strong>{message.role === "assistant" ? "Codex" : "You"}</strong>
                <span>{message.phase ?? "message"}</span>
              </div>
              <p>{message.text}</p>
            </article>
          ))
        ) : (
          <div className="chat-empty">
            <h4>Threads from Codex live here now</h4>
            <p>
              Glade imports your Codex history from disk, keeps it close to the active camp, and lets you continue with a proper composer instead of living in the shell.
            </p>
          </div>
        )}
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <textarea
          onChange={(event) => setDraft(event.target.value)}
          placeholder={camp ? `Ask Codex about ${camp.name}...` : "Choose a camp first"}
          rows={3}
          value={draft}
        />
        <div className="chat-composer__actions">
          <p>
            {isSending
              ? "Sending your note through the campfire..."
              : "Imported threads are available now. Live Codex replies use the local Codex CLI bridge."}
          </p>
          <button className="primary-button" disabled={!camp || !draft.trim() || isSending} type="submit">
            {isSending ? "Sending..." : "Send To Codex"}
          </button>
        </div>
      </form>
    </section>
  );
}

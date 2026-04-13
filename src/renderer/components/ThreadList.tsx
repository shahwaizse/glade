import type { CodexThreadSummary } from "../../shared/types";

interface ThreadListProps {
  activeThreadId: string | null;
  onRefresh: () => void;
  onSelectThread: (threadId: string) => void;
  threads: CodexThreadSummary[];
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ThreadList({
  activeThreadId,
  onRefresh,
  onSelectThread,
  threads,
}: ThreadListProps) {
  return (
    <section className="panel thread-list">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Threads</span>
          <h3>Imported Codex Chats</h3>
        </div>
        <button className="ghost-button" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      {threads.length ? (
        <div className="thread-list__items">
          {threads.map((thread) => (
            <button
              className={`thread-card ${thread.id === activeThreadId ? "thread-card--active" : ""}`}
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              type="button"
            >
              <strong>{thread.title}</strong>
              <span>{thread.messageCount} messages</span>
              <span>{formatTimestamp(thread.updatedAt)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No Codex threads were found for this camp yet.</p>
        </div>
      )}
    </section>
  );
}

export function TavernPanel() {
  return (
    <section className="panel tavern-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Tavern</span>
          <h3>Spotify</h3>
        </div>
        <span className="console-status">Persistent login</span>
      </div>

      <p className="tavern-panel__copy">
        Log into Spotify once and keep the coding mood close. The Tavern is meant to be ambient, tucked nearby, and always ready.
      </p>

      <div className="tavern-panel__frame">
        <webview
          allowpopups="true"
          partition="persist:glade-spotify"
          src="https://open.spotify.com/"
        />
      </div>
    </section>
  );
}

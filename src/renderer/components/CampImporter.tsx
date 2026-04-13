import { useState, type FormEvent } from "react";
import type { CreateCampInput, HostRuntimeInfo } from "../../shared/types";

interface CampImporterProps {
  error: string | null;
  host: HostRuntimeInfo | null;
  isImporting: boolean;
  onAddCamp: (input: CreateCampInput) => Promise<boolean>;
  onPickFolder: () => Promise<string | null>;
}

export function CampImporter({
  error,
  host,
  isImporting,
  onAddCamp,
  onPickFolder,
}: CampImporterProps) {
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<CreateCampInput["environment"]>("native");
  const [wslDistro, setWslDistro] = useState(host?.defaultWslDistro ?? "");

  async function handlePickFolder() {
    const pickedPath = await onPickFolder();
    if (pickedPath) {
      setRootPath(pickedPath);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!rootPath.trim()) {
      return;
    }

    const didSucceed = await onAddCamp({
      environment,
      name: name.trim() || undefined,
      rootPath: rootPath.trim(),
      wslDistro: environment === "wsl" ? wslDistro.trim() || null : null,
    });

    if (didSucceed) {
      setName("");
      setRootPath("");
    }
  }

  return (
    <section className="panel importer-panel">
      <span className="eyebrow">Bring In A Repo</span>
      <h3>New Camp</h3>
      <p>Import any existing git repository and pin it into Glade for fast switching.</p>

      <form className="camp-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Repo path</span>
          <input
            onChange={(event) => setRootPath(event.target.value)}
            placeholder={host?.hostPlatform === "windows" ? "C:\\dev\\glade or /home/shahwaiz/glade" : "/home/shahwaiz/glade"}
            type="text"
            value={rootPath}
          />
        </label>

        <div className="inline-actions">
          <button className="ghost-button" onClick={() => void handlePickFolder()} type="button">
            Pick Folder
          </button>
        </div>

        <label className="field">
          <span>Camp name</span>
          <input
            onChange={(event) => setName(event.target.value)}
            placeholder="Optional display name"
            type="text"
            value={name}
          />
        </label>

        <label className="field">
          <span>Environment</span>
          <select
            onChange={(event) => setEnvironment(event.target.value as CreateCampInput["environment"])}
            value={environment}
          >
            {host?.supportedCampEnvironments.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            )) ?? <option value="native">native</option>}
          </select>
        </label>

        {environment === "wsl" ? (
          <label className="field">
            <span>WSL distro</span>
            <input
              onChange={(event) => setWslDistro(event.target.value)}
              placeholder="Ubuntu"
              type="text"
              value={wslDistro}
            />
          </label>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        <button className="primary-button" disabled={isImporting || !rootPath.trim()} type="submit">
          {isImporting ? "Importing..." : "Add Camp"}
        </button>
      </form>
    </section>
  );
}

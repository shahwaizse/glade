import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AppState,
  CreateWorkItemInput,
  ImportProjectInput,
  ProjectProfile,
  ProjectRecord,
  UpdateProjectInput,
  UpdateWorkItemInput,
  WorkItem,
} from "../shared/types";
import { resolveRepoRoot } from "./workspace";

interface PersistedState extends AppState {
  version: 1;
}

const emptyState: PersistedState = {
  activeProjectId: null,
  projects: [],
  version: 1,
};

export class ProjectStore {
  private state: PersistedState = emptyState;

  constructor(private readonly storagePath: string) {}

  async initialize() {
    this.state = await this.load();
  }

  getState(): AppState {
    return {
      activeProjectId: this.state.activeProjectId,
      projects: [...this.state.projects],
    };
  }

  getProject(projectId?: string) {
    const id = projectId ?? this.state.activeProjectId;
    if (!id) {
      return null;
    }

    return this.state.projects.find((project) => project.id === id) ?? null;
  }

  async importProject(input: ImportProjectInput): Promise<AppState> {
    const rootPath = await resolveRepoRoot(input.rootPath);
    const existing = this.state.projects.find((project) => project.rootPath === rootPath);
    if (existing) {
      this.touch(existing.id);
      await this.save();
      return this.getState();
    }

    const timestamp = new Date().toISOString();
    const project: ProjectRecord = {
      addedAt: timestamp,
      id: randomUUID(),
      lastOpenedAt: timestamp,
      name: input.name?.trim() || path.basename(rootPath),
      notes: "",
      profile: createDefaultProfile(),
      rootPath,
      workItems: [],
    };

    this.state.projects = [project, ...this.state.projects];
    this.state.activeProjectId = project.id;
    await this.save();
    return this.getState();
  }

  async setActiveProject(projectId: string): Promise<AppState> {
    if (!this.getProject(projectId)) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    this.touch(projectId);
    await this.save();
    return this.getState();
  }

  async removeProject(projectId: string): Promise<AppState> {
    this.state.projects = this.state.projects.filter((project) => project.id !== projectId);
    if (this.state.activeProjectId === projectId) {
      this.state.activeProjectId = this.state.projects[0]?.id ?? null;
    }
    await this.save();
    return this.getState();
  }

  async updateProject(input: UpdateProjectInput): Promise<ProjectRecord> {
    const project = this.getProject(input.id);
    if (!project) {
      throw new Error(`Unknown project: ${input.id}`);
    }

    const next: ProjectRecord = {
      ...project,
      name: input.name ?? project.name,
      notes: input.notes ?? project.notes,
      profile: input.profile
        ? {
            ...project.profile,
            ...input.profile,
            notion: { ...project.profile.notion, ...input.profile.notion },
            slack: { ...project.profile.slack, ...input.profile.slack },
          }
        : project.profile,
    };

    this.state.projects = this.state.projects.map((entry) => (entry.id === input.id ? next : entry));
    await this.save();
    return next;
  }

  async addWorkItem(input: CreateWorkItemInput): Promise<ProjectRecord> {
    const project = this.getProject(input.projectId);
    if (!project) {
      throw new Error(`Unknown project: ${input.projectId}`);
    }

    const title = input.title.trim();
    if (!title) {
      throw new Error("Work item title is required.");
    }

    const timestamp = new Date().toISOString();
    const workItem: WorkItem = {
      acceptanceCriteria: input.acceptanceCriteria?.trim() ?? "",
      createdAt: timestamp,
      id: randomUUID(),
      source: input.source ?? "manual",
      sourceUrl: input.sourceUrl?.trim() ?? "",
      status: "inbox",
      title,
      updatedAt: timestamp,
    };

    return this.replaceProject({
      ...project,
      workItems: [workItem, ...project.workItems],
    });
  }

  async updateWorkItem(input: UpdateWorkItemInput): Promise<ProjectRecord> {
    const project = this.getProject(input.projectId);
    if (!project) {
      throw new Error(`Unknown project: ${input.projectId}`);
    }

    const workItems = project.workItems.map((item) =>
      item.id === input.id
        ? {
            ...item,
            acceptanceCriteria: input.acceptanceCriteria ?? item.acceptanceCriteria,
            sourceUrl: input.sourceUrl ?? item.sourceUrl,
            status: input.status ?? item.status,
            title: input.title ?? item.title,
            updatedAt: new Date().toISOString(),
          }
        : item,
    );

    return this.replaceProject({ ...project, workItems });
  }

  private async replaceProject(project: ProjectRecord) {
    this.state.projects = this.state.projects.map((entry) => (entry.id === project.id ? project : entry));
    await this.save();
    return project;
  }

  private touch(projectId: string) {
    const project = this.getProject(projectId);
    if (!project) {
      return;
    }

    project.lastOpenedAt = new Date().toISOString();
    this.state.activeProjectId = project.id;
    this.state.projects = [project, ...this.state.projects.filter((entry) => entry.id !== project.id)];
  }

  private async load(): Promise<PersistedState> {
    try {
      const content = await readFile(this.storagePath, "utf8");
      const parsed = JSON.parse(content) as Partial<PersistedState>;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
        return emptyState;
      }

      return {
        activeProjectId: parsed.activeProjectId ?? null,
        projects: parsed.projects.map(normalizeProject),
        version: 1,
      };
    } catch {
      return emptyState;
    }
  }

  private async save() {
    await mkdir(path.dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, JSON.stringify(this.state, null, 2));
  }
}

function createDefaultProfile(): ProjectProfile {
  return {
    browserProfile: "",
    claudeCommand: "claude",
    codexCommand: "codex",
    expectedIdentity: "",
    expectedRemote: "",
    notion: { enabled: false, scope: "" },
    slack: { enabled: false, scope: "" },
    sshKeyPath: "",
  };
}

function normalizeProject(input: ProjectRecord): ProjectRecord {
  const profile = createDefaultProfile();
  return {
    ...input,
    notes: input.notes ?? "",
    profile: {
      ...profile,
      ...input.profile,
      notion: { ...profile.notion, ...input.profile?.notion },
      slack: { ...profile.slack, ...input.profile?.slack },
    },
    workItems: Array.isArray(input.workItems) ? input.workItems : [],
  };
}

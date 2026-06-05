import type {
  AppState,
  CreateWorkItemInput,
  ImportProjectInput,
  ProjectOverview,
  UpdateProjectInput,
  UpdateWorkItemInput,
} from "../shared/types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  addWorkItem(input: CreateWorkItemInput) {
    return request<ProjectOverview>(`/api/projects/${input.projectId}/work-items`, {
      body: JSON.stringify(input),
      method: "POST",
    });
  },
  getAppState() {
    return request<AppState>("/api/state");
  },
  getProjectOverview(projectId?: string) {
    return request<ProjectOverview | null>(
      projectId ? `/api/projects/${projectId}/overview` : "/api/project/overview",
    );
  },
  importProject(input: ImportProjectInput) {
    return request<AppState>("/api/projects/import", {
      body: JSON.stringify(input),
      method: "POST",
    });
  },
  removeProject(projectId: string) {
    return request<AppState>(`/api/projects/${projectId}`, {
      method: "DELETE",
    });
  },
  setActiveProject(projectId: string) {
    return request<AppState>(`/api/projects/${projectId}/active`, {
      method: "POST",
    });
  },
  updateProject(input: UpdateProjectInput) {
    return request<ProjectOverview>(`/api/projects/${input.id}`, {
      body: JSON.stringify(input),
      method: "PATCH",
    });
  },
  updateWorkItem(input: UpdateWorkItemInput) {
    return request<ProjectOverview>(`/api/projects/${input.projectId}/work-items/${input.id}`, {
      body: JSON.stringify(input),
      method: "PATCH",
    });
  },
};

export function createTerminalSocket(projectId: string, agent: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/api/terminal`);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("agent", agent);
  return new WebSocket(url);
}

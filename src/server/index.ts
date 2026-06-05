import express from "express";
import http, { type IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { ProjectStore } from "./project-store";
import { TerminalManager } from "./terminal-manager";
import { getProjectOverview } from "./workspace";
import type {
  CreateTerminalInput,
  CreateWorkItemInput,
  TerminalDataEvent,
  TerminalExitEvent,
  UpdateProjectInput,
  UpdateWorkItemInput,
} from "../shared/types";

const port = Number(process.env.GLADE_PORT ?? 8787);
const host = process.env.GLADE_HOST ?? "127.0.0.1";
const storagePath = path.join(
  process.env.GLADE_HOME ?? path.join(os.homedir(), ".glade"),
  "projects.json",
);

const app = express();
const server = http.createServer(app);
const sessions = new Map<string, WebSocket>();
const terminalManager = new TerminalManager((_channel, payload) => {
  const event = payload as TerminalDataEvent | TerminalExitEvent;
  const socket = sessions.get(event.sessionId);
  if (!socket || socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
});
const store = new ProjectStore(storagePath);

app.use(express.json({ limit: "1mb" }));

app.get("/api/state", (_request, response) => {
  response.json(store.getState());
});

app.post("/api/projects/import", async (request, response, next) => {
  try {
    response.json(await store.importProject(request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/active", async (request, response, next) => {
  try {
    response.json(await store.setActiveProject(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:id", async (request, response, next) => {
  try {
    response.json(await store.removeProject(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:id/overview", async (request, response, next) => {
  try {
    const project = store.getProject(request.params.id);
    response.json(project ? await getProjectOverview(project) : null);
  } catch (error) {
    next(error);
  }
});

app.get("/api/project/overview", async (_request, response, next) => {
  try {
    const project = store.getProject();
    response.json(project ? await getProjectOverview(project) : null);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/projects/:id", async (request, response, next) => {
  try {
    const input: UpdateProjectInput = { ...request.body, id: request.params.id };
    response.json(await getProjectOverview(await store.updateProject(input)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:id/work-items", async (request, response, next) => {
  try {
    const input: CreateWorkItemInput = { ...request.body, projectId: request.params.id };
    response.json(await getProjectOverview(await store.addWorkItem(input)));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/projects/:projectId/work-items/:id", async (request, response, next) => {
  try {
    const input: UpdateWorkItemInput = {
      ...request.body,
      id: request.params.id,
      projectId: request.params.projectId,
    };
    response.json(await getProjectOverview(await store.updateWorkItem(input)));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown server error.";
  response.status(400).json({ error: message });
});

const terminalServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  if (url.pathname !== "/api/terminal") {
    socket.destroy();
    return;
  }

  terminalServer.handleUpgrade(request, socket, head, (webSocket) => {
    terminalServer.emit("connection", webSocket, request, url);
  });
});

terminalServer.on("connection", (socket: WebSocket, _request: IncomingMessage, url: URL) => {
  const projectId = url.searchParams.get("projectId") ?? "";
  const agent = (url.searchParams.get("agent") ?? "shell") as CreateTerminalInput["agent"];
  const project = store.getProject(projectId);

  if (!project) {
    socket.send(JSON.stringify({ data: `[glade] Unknown project: ${projectId}\r\n`, sessionId: "missing" }));
    socket.close();
    return;
  }

  const session = terminalManager.createTerminal(project, { agent, projectId });
  sessions.set(session.id, socket);
  socket.send(JSON.stringify({ data: `[glade] ${agent ?? "shell"} session at ${session.cwd}\r\n`, sessionId: session.id }));

  socket.on("message", (message) => {
    terminalManager.write(session.id, message.toString());
  });

  socket.on("close", () => {
    sessions.delete(session.id);
    terminalManager.kill(session.id);
  });
});

async function bootstrap() {
  await store.initialize();

  server.listen(port, host, () => {
    console.log(`Glade API listening on http://${host}:${port}`);
  });
}

void bootstrap();

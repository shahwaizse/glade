import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { CampStore } from "./camp-store";
import { CodexHistoryStore } from "./codex-history";
import { TerminalManager } from "./terminal-manager";
import { getCampOverview } from "./workspace";
import type {
  CreateTerminalInput,
  CreateCampInput,
  ResizeTerminalInput,
  WriteTerminalInput,
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let terminalManager: TerminalManager | null = null;
let campStore: CampStore | null = null;
let codexHistoryStore: CodexHistoryStore | null = null;

if (process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
  // WSLg GPU compositing is flaky here, so prefer a stable software path.
  app.disableHardwareAcceleration();
}

function getProjectRoot() {
  return process.env.GLADE_PROJECT_ROOT || process.cwd();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Glade",
    backgroundColor: "#0f160f",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      webviewTag: true,
      preload: path.join(__dirname, "../preload/preload.js"),
    },
  });

  terminalManager = new TerminalManager((channel, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const { webContents } = mainWindow;
    if (webContents.isDestroyed()) {
      return;
    }

    try {
      webContents.send(channel, payload);
    } catch {
      // The renderer can disappear while terminal output is still unwinding.
    }
  });

  mainWindow.on("close", () => {
    terminalManager?.disposeAll();
  });

  mainWindow.on("closed", () => {
    terminalManager = null;
    mainWindow = null;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] process gone", details);
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error("[renderer] did-fail-load", { errorCode, errorDescription, validatedUrl });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[renderer] did-finish-load");
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

app.whenReady().then(async () => {
  campStore = new CampStore(
    path.join(app.getPath("userData"), "camps.json"),
    getProjectRoot(),
  );
  codexHistoryStore = new CodexHistoryStore();

  await campStore.initialize();
  createWindow();

  ipcMain.handle("glade:get-camp-registry", () => {
    if (!campStore) {
      throw new Error("Camp store is unavailable");
    }

    return campStore.getRegistry();
  });

  ipcMain.handle("glade:pick-camp-directory", async () => {
    const options: OpenDialogOptions = {
      properties: ["openDirectory"],
      title: "Choose a Git repository folder",
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("glade:add-camp", async (_event, input: CreateCampInput) => {
    if (!campStore) {
      throw new Error("Camp store is unavailable");
    }

    return campStore.addCamp(input);
  });

  ipcMain.handle("glade:set-active-camp", async (_event, campId: string) => {
    if (!campStore) {
      throw new Error("Camp store is unavailable");
    }

    return campStore.setActiveCamp(campId);
  });

  ipcMain.handle("glade:remove-camp", async (_event, campId: string) => {
    if (!campStore) {
      throw new Error("Camp store is unavailable");
    }

    return campStore.removeCamp(campId);
  });

  ipcMain.handle("glade:get-camp-overview", async (_event, campId?: string) => {
    const camp = campStore?.getCamp(campId);
    return camp ? getCampOverview(camp) : null;
  });

  ipcMain.handle("glade:get-codex-threads", async (_event, cwd?: string) => {
    if (!codexHistoryStore) {
      throw new Error("Codex history is unavailable");
    }

    return codexHistoryStore.getThreads(cwd);
  });

  ipcMain.handle("glade:get-codex-thread", async (_event, threadId: string) => {
    if (!codexHistoryStore) {
      throw new Error("Codex history is unavailable");
    }

    return codexHistoryStore.getThread(threadId);
  });

  ipcMain.handle("glade:send-codex-message", async (_event, input) => {
    if (!codexHistoryStore) {
      throw new Error("Codex history is unavailable");
    }

    return codexHistoryStore.sendMessage(input);
  });

  ipcMain.handle("glade:terminal:create", (_event, input: CreateTerminalInput) => {
    if (!terminalManager || !campStore) {
      throw new Error("Glade services are unavailable");
    }

    const camp = campStore.getCamp(input.campId);
    if (!camp) {
      throw new Error(`Unknown camp: ${input.campId}`);
    }

    return terminalManager.createTerminal(camp, input);
  });

  ipcMain.handle("glade:terminal:write", (_event, input: WriteTerminalInput) => {
    terminalManager?.write(input.sessionId, input.data);
  });

  ipcMain.handle("glade:terminal:resize", (_event, input: ResizeTerminalInput) => {
    terminalManager?.resize(input.sessionId, input.cols, input.rows);
  });

  ipcMain.handle("glade:terminal:kill", (_event, sessionId: string) => {
    terminalManager?.kill(sessionId);
  });
});

app.on("window-all-closed", () => {
  terminalManager?.disposeAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

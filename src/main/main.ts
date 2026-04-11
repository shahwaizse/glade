import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { TerminalManager } from "./terminal-manager";
import { getCampOverview } from "./workspace";
import type {
  CreateTerminalInput,
  ResizeTerminalInput,
  WriteTerminalInput,
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let terminalManager: TerminalManager | null = null;

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
      preload: path.join(__dirname, "../preload/preload.js"),
    },
  });

  terminalManager = new TerminalManager((channel, payload) => {
    mainWindow?.webContents.send(channel, payload);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("glade:get-camp-overview", async (_event, cwd?: string) =>
    getCampOverview(cwd ?? getProjectRoot()),
  );

  ipcMain.handle("glade:terminal:create", (_event, input: CreateTerminalInput) => {
    if (!terminalManager) {
      throw new Error("Terminal manager is unavailable");
    }

    return terminalManager.createTerminal(input);
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

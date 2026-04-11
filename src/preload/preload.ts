import { contextBridge, ipcRenderer } from "electron";
import type { GladeApi } from "../shared/types";

const api: GladeApi = {
  createTerminal: (input) => ipcRenderer.invoke("glade:terminal:create", input),
  getCampOverview: (cwd) => ipcRenderer.invoke("glade:get-camp-overview", cwd),
  killTerminal: (sessionId) => ipcRenderer.invoke("glade:terminal:kill", sessionId),
  onTerminalData: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => {
      listener(payload);
    };
    ipcRenderer.on("glade:terminal:data", wrapped);
    return () => ipcRenderer.removeListener("glade:terminal:data", wrapped);
  },
  onTerminalExit: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => {
      listener(payload);
    };
    ipcRenderer.on("glade:terminal:exit", wrapped);
    return () => ipcRenderer.removeListener("glade:terminal:exit", wrapped);
  },
  resizeTerminal: (input) => ipcRenderer.invoke("glade:terminal:resize", input),
  writeTerminal: (input) => ipcRenderer.invoke("glade:terminal:write", input),
};

contextBridge.exposeInMainWorld("glade", api);


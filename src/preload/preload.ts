import { contextBridge, ipcRenderer } from "electron";
import type { GladeApi } from "../shared/types";

const api: GladeApi = {
  addCamp: (input) => ipcRenderer.invoke("glade:add-camp", input),
  createTerminal: (input) => ipcRenderer.invoke("glade:terminal:create", input),
  getCampOverview: (campId) => ipcRenderer.invoke("glade:get-camp-overview", campId),
  getCampRegistry: () => ipcRenderer.invoke("glade:get-camp-registry"),
  getCodexThread: (threadId) => ipcRenderer.invoke("glade:get-codex-thread", threadId),
  getCodexThreads: (cwd) => ipcRenderer.invoke("glade:get-codex-threads", cwd),
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
  pickCampDirectory: () => ipcRenderer.invoke("glade:pick-camp-directory"),
  removeCamp: (campId) => ipcRenderer.invoke("glade:remove-camp", campId),
  resizeTerminal: (input) => ipcRenderer.invoke("glade:terminal:resize", input),
  sendCodexMessage: (input) => ipcRenderer.invoke("glade:send-codex-message", input),
  setActiveCamp: (campId) => ipcRenderer.invoke("glade:set-active-camp", campId),
  writeTerminal: (input) => ipcRenderer.invoke("glade:terminal:write", input),
};

contextBridge.exposeInMainWorld("glade", api);

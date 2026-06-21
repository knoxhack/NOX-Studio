import electron from "electron";
const { app, BrowserWindow, ipcMain, protocol, shell } = electron;
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  grokStatus,
  grokVerify,
  grokSave,
  grokRemove,
  grokGenerateStructured,
  grokGenerateText,
  grokGenerateImage,
  grokGenerateVideo,
  grokPollVideoJob,
  pickAndImportFile,
  revealAssetInFolder,
  openMediaFolder,
  runRenderJob,
  createReleasePackage,
  getMediaRoots,
  defaultModels,
  ollamaCheckStatus,
  ollamaGenerateText,
  youtubeGetStatus,
  youtubeStartDeviceAuth,
  youtubePollDeviceToken,
  youtubeDisconnect,
  youtubeUploadVideo,
} from "./local-backend.mjs";
import { getMediaRoot, resolveNoxMediaUrl, isPathUnderMediaRoot } from "./media-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 760,
    webPreferences: {
      preload: resolve(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      allowRunningInsecureContent: false,
      webSecurity: true,
    },
    title: "NOX Studio",
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (app.isPackaged) {
    const indexPath = resolve(__dirname, "..", "dist", "index.html");
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle("secrets:grokStatus", () => invoke(grokStatus));
  ipcMain.handle("secrets:verifyGrokKey", (_, apiKey) => invoke(() => grokVerify(apiKey)));
  ipcMain.handle("secrets:saveGrokKey", (_, apiKey) => invoke(() => grokSave(apiKey)));
  ipcMain.handle("secrets:removeGrokKey", () => invoke(grokRemove));

  ipcMain.handle("files:importUserFile", (_, options) => invoke(() => pickAndImportFile(options)));
  ipcMain.handle("files:revealInFolder", (_, url) => invoke(() => revealAssetInFolder(url)));
  ipcMain.handle("files:openMediaFolder", () => invoke(openMediaFolder));
  ipcMain.handle("files:getMediaRoots", () => invoke(getMediaRoots));

  ipcMain.handle("grok:generateStructuredText", (_, options) => invoke(() => grokGenerateStructured(options)));
  ipcMain.handle("grok:generateText", (_, options) => invoke(() => grokGenerateText(options)));
  ipcMain.handle("grok:generateImage", (_, options) => invoke(() => grokGenerateImage(options)));
  ipcMain.handle("grok:generateVideo", (_, options) => invoke(() => grokGenerateVideo(options)));
  ipcMain.handle("grok:pollVideoJob", (_, options) => invoke(() => grokPollVideoJob(options)));
  ipcMain.handle("grok:getDefaultModels", () => defaultModels);

  ipcMain.handle("render:runRender", (_, options) => invoke(() => runRenderJob(options)));
  ipcMain.handle("publish:createReleasePackage", (_, options) => invoke(() => createReleasePackage(options)));

  ipcMain.handle("app:getMediaRoot", () => ({ path: getMediaRoot() }));
  ipcMain.handle("app:openMediaFolder", () => invoke(openMediaFolder));

  ipcMain.handle("ollama:status", (_, host) => invoke(() => ollamaCheckStatus(host)));
  ipcMain.handle("ollama:generate", (_, options) => invoke(() => ollamaGenerateText(options)));

  ipcMain.handle("youtube:getStatus", () => invoke(youtubeGetStatus));
  ipcMain.handle("youtube:startDeviceAuth", (_, options) => invoke(() => youtubeStartDeviceAuth(options)));
  ipcMain.handle("youtube:pollDeviceToken", (_, options) => invoke(() => youtubePollDeviceToken(options)));
  ipcMain.handle("youtube:disconnect", () => invoke(youtubeDisconnect));
  ipcMain.handle("youtube:uploadVideo", (_, options) => invoke(() => youtubeUploadVideo(options)));
}

async function invoke(fn) {
  try {
    const result = await fn();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function registerMediaProtocol() {
  protocol.handle("nox-media", async (request) => {
    try {
      const url = request.url;
      const filePath = await resolveNoxMediaUrl(url);
      if (!filePath || !isPathUnderMediaRoot(filePath) || !existsSync(filePath)) {
        return new Response("Not found", { status: 404 });
      }
      const data = await readFile(filePath);
      const mimeType = inferMimeType(filePath);
      return new Response(data, {
        status: 200,
        headers: { "Content-Type": mimeType },
      });
    } catch (err) {
      console.error("nox-media protocol error:", err.message);
      return new Response("Internal error", { status: 500 });
    }
  });
}

function inferMimeType(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    aac: "audio/aac",
    txt: "text/plain",
    json: "application/json",
    md: "text/markdown",
    srt: "text/srt",
  };
  return map[ext] || "application/octet-stream";
}

app.whenReady().then(() => {
  registerMediaProtocol();
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (_, contents) => {
  contents.on("new-window", (event) => {
    event.preventDefault();
  });
});

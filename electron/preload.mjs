import electron from "electron";
const { contextBridge, ipcRenderer } = electron;

const secretsApi = {
  grokStatus: () => ipcRenderer.invoke("secrets:grokStatus"),
  verifyGrokKey: (apiKey) => ipcRenderer.invoke("secrets:verifyGrokKey", apiKey),
  saveGrokKey: (apiKey) => ipcRenderer.invoke("secrets:saveGrokKey", apiKey),
  removeGrokKey: () => ipcRenderer.invoke("secrets:removeGrokKey"),
};

const filesApi = {
  importUserFile: (options) => ipcRenderer.invoke("files:importUserFile", options),
  revealInFolder: (url) => ipcRenderer.invoke("files:revealInFolder", url),
  openMediaFolder: () => ipcRenderer.invoke("files:openMediaFolder"),
  getMediaRoots: () => ipcRenderer.invoke("files:getMediaRoots"),
};

const grokApi = {
  generateStructuredText: (options) => ipcRenderer.invoke("grok:generateStructuredText", options),
  generateText: (options) => ipcRenderer.invoke("grok:generateText", options),
  generateImage: (options) => ipcRenderer.invoke("grok:generateImage", options),
  generateVideo: (options) => ipcRenderer.invoke("grok:generateVideo", options),
  pollVideoJob: (options) => ipcRenderer.invoke("grok:pollVideoJob", options),
  getDefaultModels: () => ipcRenderer.invoke("grok:getDefaultModels"),
};

const ollamaApi = {
  status: (host) => ipcRenderer.invoke("ollama:status", host),
  generate: (options) => ipcRenderer.invoke("ollama:generate", options),
};

const renderApi = {
  runRender: (options) => ipcRenderer.invoke("render:runRender", options),
};

const publishApi = {
  createReleasePackage: (options) => ipcRenderer.invoke("publish:createReleasePackage", options),
};

const youtubeApi = {
  getStatus: () => ipcRenderer.invoke("youtube:getStatus"),
  startDeviceAuth: (options) => ipcRenderer.invoke("youtube:startDeviceAuth", options),
  pollDeviceToken: (options) => ipcRenderer.invoke("youtube:pollDeviceToken", options),
  disconnect: () => ipcRenderer.invoke("youtube:disconnect"),
  uploadVideo: (options) => ipcRenderer.invoke("youtube:uploadVideo", options),
};

const appApi = {
  getMediaRoot: () => ipcRenderer.invoke("app:getMediaRoot"),
  openMediaFolder: () => ipcRenderer.invoke("app:openMediaFolder"),
};

contextBridge.exposeInMainWorld("noxDesktop", {
  isDesktop: true,
  secrets: secretsApi,
  files: filesApi,
  grok: grokApi,
  ollama: ollamaApi,
  render: renderApi,
  publish: publishApi,
  youtube: youtubeApi,
  app: appApi,
});

import { app, BrowserWindow, dialog, shell, utilityProcess } from "electron";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const isPackaged = app.isPackaged;
const serverEntry = path.join(appRoot, "src", "server.js");
const serverHost = "127.0.0.1";

let mainWindow;
let serverProcess;
let serverBaseUrl = "";
let isQuitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  try {
    const port = await findPreferredPort();
    const baseUrl = `http://${serverHost}:${port}`;
    serverBaseUrl = baseUrl;
    startServer(port);
    await waitForServer(baseUrl, 30000);
    createWindow(baseUrl);
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "启动失败",
      message: "Material Organizer 启动失败",
      detail: error?.stack || error?.message || String(error)
    });
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverBaseUrl) {
    createWindow(serverBaseUrl);
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  stopServer();
});

function startServer(port) {
  const userData = app.getPath("userData");
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: serverHost,
    ASSISTANT_CONFIG_DIR: path.join(userData, "config"),
    ASSISTANT_DOCUMENT_ROOT: path.join(userData, "knowledge-base")
  };

  if (isPackaged) {
    env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, "playwright-browsers");
  } else if (!env.PLAYWRIGHT_BROWSERS_PATH) {
    env.PLAYWRIGHT_BROWSERS_PATH = "0";
  }

  serverProcess = utilityProcess.fork(serverEntry, [], {
    env,
    serviceName: "material-organizer-server",
    stdio: "pipe"
  });

  serverProcess.stderr?.on("data", (chunk) => {
    console.error(`[server] ${chunk.toString().trimEnd()}`);
  });
  serverProcess.stdout?.on("data", (chunk) => {
    console.log(`[server] ${chunk.toString().trimEnd()}`);
  });
  serverProcess.on("exit", (code) => {
    if (code !== 0 && !isQuitting) {
      dialog.showErrorBox("服务已退出", `本地服务异常退出，退出码：${code}`);
    }
  });
}

function createWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Material Organizer",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => { mainWindow = undefined; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let destination;
    try { destination = new URL(url); } catch { return { action: "deny" }; }
    const isAppPage = destination.origin === baseUrl;
    if (!isAppPage && ["https:", "http:"].includes(destination.protocol)) shell.openExternal(destination.toString());
    return { action: "deny" };
  });
  mainWindow.loadURL(baseUrl);
}

function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  child.kill();
}

function findFreePort(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, serverHost, () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function findPreferredPort() {
  try {
    // We only test whether 8020 is bindable; we never attach to a service already
    // listening there, so a different local application cannot become this app's UI.
    return await findFreePort(8020);
  } catch (error) {
    if (error?.code !== "EADDRINUSE") throw error;
    return findFreePort(0);
  }
}

async function waitForServer(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`本地服务启动超时：${baseUrl}`);
}

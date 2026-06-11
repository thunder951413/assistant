#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const runtimeDir = path.join(rootDir, ".config", "runtime");
const pidPath = path.join(runtimeDir, "assistant.pid");
const logPath = path.join(runtimeDir, "assistant.log");
const port = Number(process.env.PORT || 5173);
const command = process.argv[2] || "--status";

function ensureRuntimeDir() {
  mkdirSync(runtimeDir, { recursive: true });
}

function readPid() {
  if (!existsSync(pidPath)) return null;
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removePidFile() {
  if (existsSync(pidPath)) unlinkSync(pidPath);
}

async function start() {
  ensureRuntimeDir();
  const existingPid = readPid();
  if (isRunning(existingPid)) {
    console.log(`服务已在后台运行：pid ${existingPid}`);
    console.log(`访问地址：http://localhost:${port}`);
    return;
  }
  removePidFile();
  if (await isPortOpen(port)) {
    console.error(`端口 ${port} 已被占用。请先停止现有服务，或设置 PORT 使用其他端口。`);
    process.exitCode = 1;
    return;
  }

  appendLogHeader();
  const outFd = openSync(logPath, "a");
  const errFd = openSync(logPath, "a");
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    detached: true,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", outFd, errFd]
  });
  closeSync(outFd);
  closeSync(errFd);

  child.unref();
  writeFileSync(pidPath, `${child.pid}\n`, "utf8");
  const ready = await waitUntilPortOpen(port, 5000);
  if (!ready) {
    if (isRunning(child.pid)) process.kill(child.pid, "SIGTERM");
    removePidFile();
    console.error(`服务启动超时：端口 ${port} 未开始监听。请查看日志：${logPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`服务已启动：pid ${child.pid}`);
  console.log(`访问地址：http://localhost:${port}`);
  console.log(`日志文件：${logPath}`);
}

function appendLogHeader() {
  writeFileSync(logPath, `\n--- ${new Date().toISOString()} start port=${port} ---\n`, { flag: "a" });
}

async function stop() {
  const pid = readPid();
  if (!pid) {
    console.log("服务未运行：没有 pid 文件。");
    return;
  }
  if (!isRunning(pid)) {
    removePidFile();
    console.log(`服务未运行：清理失效 pid ${pid}。`);
    return;
  }

  process.kill(pid, "SIGTERM");
  const stopped = await waitUntilStopped(pid, 5000);
  if (!stopped) {
    process.kill(pid, "SIGKILL");
    await waitUntilStopped(pid, 2000);
  }
  removePidFile();
  console.log(`服务已停止：pid ${pid}`);
}

async function restart() {
  await stop();
  await start();
}

function status() {
  const pid = readPid();
  if (isRunning(pid)) {
    console.log(`服务运行中：pid ${pid}`);
    console.log(`访问地址：http://localhost:${port}`);
    console.log(`日志文件：${logPath}`);
    return;
  }
  if (pid) removePidFile();
  console.log("服务未运行。");
}

async function waitUntilStopped(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return !isRunning(pid);
}

function isPortOpen(targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: targetPort });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitUntilPortOpen(targetPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(targetPort)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function usage(exitCode = 0) {
  console.log("用法：node scripts/service.js --start|--stop|--restart|--status");
  process.exit(exitCode);
}

switch (command) {
  case "--start":
  case "start":
    await start();
    break;
  case "--stop":
  case "stop":
    await stop();
    break;
  case "--restart":
  case "restart":
    await restart();
    break;
  case "--status":
  case "status":
    status();
    break;
  case "--help":
  case "-h":
    usage(0);
    break;
  default:
    usage(1);
}

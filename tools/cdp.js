/* =========================================================================
 * tools/cdp.js —— 极简 Chrome DevTools Protocol 客户端
 * 用 Node 内置 WebSocket 连接无头浏览器，可以真实执行 JS、读控制台报错、截图。
 * ========================================================================= */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, execFileSync } = require("child_process");

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
];

const IS_WIN = process.platform === "win32";
/* 所有被本进程启动的浏览器 PID，进程退出时统一兜底清理，
   避免测试被中断后留下无头浏览器空转烧 CPU */
const SPAWNED = new Set();
const SPAWNED_DIRS = new Set();
let cleanupRegistered = false;

function findBrowser() {
  for (const b of BROWSERS) if (fs.existsSync(b)) return b;
  throw new Error("找不到 Edge / Chrome");
}

/** 结束整棵进程树（Windows 上 Edge 会派生几十个子进程，只杀父进程会留下孤儿） */
function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"],
        { stdio: "ignore", timeout: 15000 });
      return;
    } catch (e) { /* 进程可能已经退出 */ }
  }
  try { process.kill(pid, "SIGKILL"); } catch (e) {}
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

/* ---------------------------------------------------------------------------
 * 清理浏览器进程
 * 关键经验：Edge/Chrome 会派生十几个子进程，而且部分子进程（GPU、crashpad 等）
 * 会脱离启动进程的进程树，所以 `taskkill /T` 杀不干净。可靠做法是：
 * 每个子进程的命令行都带着我们唯一的 `--user-data-dir=<目录>`，
 * 按这个特征精确找出所有相关进程再逐个杀掉，并多轮重试。
 * ------------------------------------------------------------------------- */
function psQueryPids(userDir) {
  // 注意：目录名由 mkdtemp 生成，不含引号等特殊字符，可安全内插
  const filter = '"Name=\'msedge.exe\' or Name=\'chrome.exe\'"';
  const cmd =
    "Get-CimInstance Win32_Process -Filter " + filter + " | " +
    "Where-Object { $_.CommandLine -like '*" + userDir + "*' } | " +
    "Select-Object -ExpandProperty ProcessId";
  try {
    const out = execFileSync("powershell",
      ["-NoProfile", "-NonInteractive", "-Command", cmd],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 25000 });
    return out.split(/\r?\n/)
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0);
  } catch (e) {
    return [];
  }
}

/** 按 user-data-dir 精确清理该浏览器实例的全部进程（同步，可重复调用） */
function killByUserDataDir(userDir) {
  if (!userDir) return 0;
  let total = 0;
  for (let round = 0; round < 3; round++) {
    const pids = psQueryPids(userDir);
    if (!pids.length) break;
    for (const pid of pids) {
      killTree(pid);          // 先按树杀
      total++;
    }
    // 给进程一点退出时间，然后复查
    try {
      execFileSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 350"],
        { stdio: "ignore", timeout: 8000 });
    } catch (e) {}
  }
  return total;
}
const WATCHDOG_SRC = [
  '"use strict";',
  'const { execFileSync } = require("child_process");',
  'const fs = require("fs");',
  'const parentPid = Number(process.argv[2]);',
  'const userDir = process.argv[3];',
  'const deadline = Date.now() + Number(process.argv[4]);',
  'function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return false; } }',
  '// 按唯一的 user-data-dir 找出该浏览器实例的全部进程（含脱离进程树的子进程）',
  'function pidsOf() {',
  '  try {',
  '    const cmd = "Get-CimInstance Win32_Process -Filter \\"Name=\'msedge.exe\' or Name=\'chrome.exe\'\\" | " +',
  '      "Where-Object { $_.CommandLine -like \'*" + userDir + "*\' } | " +',
  '      "Select-Object -ExpandProperty ProcessId";',
  '    const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd],',
  '      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 });',
  '    return out.split(/\\r?\\n/).map(s => parseInt(s.trim(), 10)).filter(n => n > 0);',
  '  } catch (e) { return []; }',
  '}',
  'function killAll() {',
  '  for (let round = 0; round < 4; round++) {',
  '    const pids = pidsOf();',
  '    if (!pids.length) return;',
  '    for (const pid of pids) {',
  '      try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 15000 }); } catch (e) {}',
  '    }',
  '    try { execFileSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 300"], { stdio: "ignore", timeout: 8000 }); } catch (e) {}',
  '  }',
  '}',
  'const timer = setInterval(function () {',
  '  const parentGone = !alive(parentPid);',
  '  const expired = Date.now() > deadline;',
  '  if (!parentGone && !expired) return;',
  '  clearInterval(timer);',
  '  killAll();',
  '  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}',
  '  process.exit(0);',
  '}, 700);'
].join("\n");

function spawnWatchdog(parentPid, userDir, maxMinutes = 30) {
  let scriptPath = null;
  try {
    scriptPath = path.join(os.tmpdir(), "ma-watchdog-" + process.pid + ".js");
    fs.writeFileSync(scriptPath, WATCHDOG_SRC, "utf8");
    const wd = spawn(process.execPath, [
      scriptPath, String(parentPid), userDir, String(maxMinutes * 60000)
    ], { detached: true, stdio: "ignore", windowsHide: true });
    wd.unref();   // 不阻塞父进程退出
    wd.on("error", () => {});
    return wd;
  } catch (e) {
    return null;
  }
}

/** 兜底：无论正常结束、抛异常还是被 Ctrl+C 中断，都要清干净 */
function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const cleanup = () => {
    for (const pid of SPAWNED) killTree(pid);
    for (const dir of SPAWNED_DIRS) killByUserDataDir(dir);
    SPAWNED.clear();
    SPAWNED_DIRS.clear();
  };
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    process.on(sig, () => { cleanup(); process.exit(130); });
  }
  process.on("uncaughtException", (e) => {
    cleanup();
    console.error("未捕获异常: " + (e && e.stack || e));
    process.exit(1);
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let body = "";
      res.on("data", c => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("超时")));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Browser {
  constructor() {
    this.proc = null;
    this.ws = null;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();     // method -> [fn]
    this.userDir = null;
    this.closed = false;
  }

  /** 启动无头浏览器并连上第一个页面目标 */
  async launch(opts = {}) {
    registerCleanup();
    const port = opts.port || 9333 + Math.floor(Math.random() * 400);
    this.userDir = fs.mkdtempSync(path.join(os.tmpdir(), "ma-cdp-"));
    SPAWNED_DIRS.add(this.userDir);
    const args = [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--allow-file-access-from-files", "--disable-dev-shm-usage",
      "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--disable-background-networking",
      "--disable-sync", "--mute-audio",
      // 关键：限制后台渲染，避免无头页面长期以满帧率空转烧 CPU
      "--disable-renderer-backgrounding=false",
      "--disable-backgrounding-occluded-windows",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + this.userDir,
      "--window-size=" + (opts.width || 1600) + "," + (opts.height || 1000)
    ];
    if (opts.url) args.push(opts.url);

    this.proc = spawn(findBrowser(), args, { stdio: "ignore", windowsHide: true });
    SPAWNED.add(this.proc.pid);
    this.proc.on("exit", () => SPAWNED.delete(this.proc.pid));
    // 即使本进程被硬杀，看门狗也会把浏览器整棵树收掉
    this.watchdog = spawnWatchdog(process.pid, this.userDir, opts.maxMinutes || 30);

    // 等调试端口就绪
    let targets = null;
    for (let i = 0; i < 80; i++) {
      try {
        targets = await httpGetJson("http://127.0.0.1:" + port + "/json/list");
        if (targets && targets.length) break;
      } catch (e) { /* 还没起来 */ }
      await sleep(150);
    }
    if (!targets || !targets.length) {
      await this.close();
      throw new Error("浏览器调试端口未就绪");
    }

    const page = targets.find(t => t.type === "page") || targets[0];
    await this.connect(page.webSocketDebuggerUrl);
    return this;
  }

  connect(wsUrl) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = e => reject(new Error("WebSocket 连接失败: " + (e.message || e.type)));
      this.ws.onmessage = ev => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        } else if (msg.method) {
          const list = this.handlers.get(msg.method) || [];
          list.forEach(fn => fn(msg.params));
        }
      };
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("CDP 超时: " + method));
        }
      }, 30000);
    });
  }

  /** 在页面里执行表达式（支持 await，返回值按值传回） */
  async eval(expression, awaitPromise = true) {
    const r = await this.send("Runtime.evaluate", {
      expression, awaitPromise, returnByValue: true, allowUnsafeEvalBlockedByCSP: true
    });
    if (r.exceptionDetails) {
      throw new Error("页面内异常: " + (r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    }
    return r.result.value;
  }

  /** 打开页面并等它加载完 */
  async open(url) {
    await this.send("Page.enable");
    const loaded = new Promise(res => {
      const h = () => res();
      this.on("Page.loadEventFired", h);
      setTimeout(res, 15000);
    });
    await this.send("Page.navigate", { url });
    await loaded;
  }

  /** 真实重载当前页面（保持同一 origin，localStorage / IndexedDB 不丢） */
  async reload() {
    await this.send("Page.enable");
    const loaded = new Promise(res => {
      this.on("Page.loadEventFired", () => res());
      setTimeout(res, 15000);
    });
    await this.send("Page.reload", { ignoreCache: true });
    await loaded;
  }

  async screenshot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return fs.statSync(file).size;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;

    // 先让浏览器自己优雅退出
    try {
      if (this.ws && this.ws.readyState === 1) {
        await this.send("Browser.close").catch(() => {});
      }
    } catch (e) { /* 忽略 */ }
    try { if (this.ws) this.ws.close(); } catch (e) {}

    // 等它自己退；退不掉就按 user-data-dir 精确清理全部相关进程
    if (this.proc && this.proc.pid) {
      const pid = this.proc.pid;
      for (let i = 0; i < 10; i++) {
        if (!isAlive(pid)) break;
        await sleep(120);
      }
      if (isAlive(pid)) killTree(pid);
      SPAWNED.delete(pid);
    }
    killByUserDataDir(this.userDir);   // 兜底：清掉脱离进程树的子进程

    // 正常收尾了，看门狗可以撤了
    if (this.watchdog) {
      try { this.watchdog.kill(); } catch (e) {}
      this.watchdog = null;
    }
    if (this.userDir) SPAWNED_DIRS.delete(this.userDir);

    if (this.userDir) {
      for (let i = 0; i < 6; i++) {
        try { fs.rmSync(this.userDir, { recursive: true, force: true }); break; }
        catch (e) { await sleep(200); }   // 文件可能还被占用，重试
      }
    }
  }
}

/** 清理可能残留的历史测试进程（脚本启动时调用，保证环境干净）
 *  注意：新版 Windows 已移除 wmic，这里用 PowerShell 的 CIM 查询替代。 */
function reapStaleProcesses() {
  if (!IS_WIN) return 0;
  let killed = 0;
  const psCmd =
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' or Name='chrome.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'headless|ma-cdp-' } | " +
    "Select-Object -ExpandProperty ProcessId";
  let out = "";
  try {
    out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCmd],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 25000 });
  } catch (e) {
    return 0;
  }
  for (const line of out.split(/\r?\n/)) {
    const pid = parseInt(line.trim(), 10);
    if (pid && pid !== process.pid) {
      killTree(pid);
      killed++;
    }
  }
  // 顺手清掉遗留的临时目录
  try {
    for (const d of fs.readdirSync(os.tmpdir())) {
      if (/^ma-(cdp|verify)-/.test(d)) {
        try { fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true }); } catch (e) {}
      }
    }
  } catch (e) { /* 忽略 */ }
  return killed;
}

module.exports = { Browser, findBrowser, sleep, killTree, reapStaleProcesses, spawnWatchdog, WATCHDOG_SRC };

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone smoke runner has no Effect runtime.
const hostPlatform = NodeOS.platform();
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone smoke runner validates the actual host architecture.
const hostArchitecture = NodeOS.arch();
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const CREDENTIAL_ENV_PATTERN =
  /(?:^|_)(?:API_?KEY|AUTH|COOKIE|CREDENTIAL|PASSWORD|SECRET|SESSION|TOKEN)(?:_|$)/i;
const CREDENTIAL_ENV_NAMES = new Set(["AWS_PROFILE", "SSH_AUTH_SOCK"]);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function parseSmokeArguments(args) {
  let appExecutable;
  let expectedArchitecture;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--app-executable") {
      appExecutable = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--expect-arch") {
      expectedArchitecture = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown desktop smoke argument: ${argument}`);
  }
  return { appExecutable, expectedArchitecture };
}

export function makeIsolatedEnvironment({ inherited, root, backendPort }) {
  const home = NodePath.join(root, "home");
  const t3Home = NodePath.join(root, "fd-code-home");
  const temporaryDirectory = NodePath.join(root, "tmp");
  const roamingAppData = NodePath.join(root, "appdata-roaming");
  const localAppData = NodePath.join(root, "appdata-local");
  const environment = {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    APPDATA: roamingAppData,
    LOCALAPPDATA: localAppData,
    XDG_CACHE_HOME: NodePath.join(root, "xdg-cache"),
    XDG_CONFIG_HOME: NodePath.join(root, "xdg-config"),
    XDG_DATA_HOME: NodePath.join(root, "xdg-data"),
    XDG_STATE_HOME: NodePath.join(root, "xdg-state"),
    PATH:
      hostPlatform === "win32"
        ? `${inherited.SystemRoot ?? "C:\\Windows"}\\System32;${inherited.SystemRoot ?? "C:\\Windows"}`
        : hostPlatform === "darwin"
          ? "/usr/bin:/bin:/usr/sbin:/sbin"
          : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    T3CODE_HOME: t3Home,
    T3CODE_PORT: String(backendPort),
    T3CODE_DISABLE_AUTO_UPDATE: "1",
    T3CODE_TELEMETRY_ENABLED: "0",
    T3CODE_OTEL_SDK_DISABLED: "true",
    OTEL_SDK_DISABLED: "true",
    ELECTRON_ENABLE_LOGGING: "1",
    NO_PROXY: "127.0.0.1,localhost",
  };
  delete environment.VITE_DEV_SERVER_URL;
  delete environment.ELECTRON_RUN_AS_NODE;
  for (const name of Object.keys(environment)) {
    if (CREDENTIAL_ENV_PATTERN.test(name) || CREDENTIAL_ENV_NAMES.has(name)) {
      delete environment[name];
    }
  }
  return { environment, home, t3Home, temporaryDirectory, roamingAppData, localAppData };
}

async function reservePort() {
  const server = NodeNet.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a loopback port for the desktop smoke test.");
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitFor(description, operation, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result !== undefined && result !== false && result !== null) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${detail}`);
}

async function fetchReady(baseUrl) {
  return waitFor("desktop backend readiness", async () => {
    const response = await fetch(new URL("/.well-known/fd-code/environment", baseUrl), {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const descriptor = await response.json();
    return typeof descriptor?.environmentId === "string" ? descriptor : false;
  });
}

async function verifyFrontend(baseUrl) {
  const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
  const body = await response.text();
  if (!response.ok || !body.includes('<div id="root">') || !body.includes("FD CODE")) {
    throw new Error(`Desktop backend did not serve the expected frontend at ${baseUrl}.`);
  }
}

async function evaluateCdp(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket connection failed.")), {
      once: true,
    });
  });
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP evaluation timed out.")), 5_000);
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result?.result?.value);
      });
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    });
  } finally {
    socket.close();
  }
}

async function verifyRenderer(debugPort) {
  return waitFor("renderer initialization", async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const targets = await response.json();
    const target = targets.find(
      (entry) => entry.type === "page" && typeof entry.webSocketDebuggerUrl === "string",
    );
    if (!target) return false;
    const state = await evaluateCdp(
      target.webSocketDebuggerUrl,
      `({
        readyState: document.readyState,
        title: document.title,
        bridge: typeof window.desktopBridge,
        bootShell: document.getElementById("boot-shell") !== null,
        rootChildren: document.getElementById("root")?.childElementCount ?? 0
      })`,
    );
    if (
      state?.readyState === "complete" &&
      state.title === "FD CODE" &&
      state.bridge === "object" &&
      state.bootShell === false &&
      state.rootChildren > 0
    ) {
      return state;
    }
    throw new Error(`Renderer is not initialized: ${JSON.stringify(state)}`);
  });
}

function appendOutput(current, chunk) {
  const next = current + chunk.toString();
  return next.length > MAX_OUTPUT_BYTES ? next.slice(-MAX_OUTPUT_BYTES) : next;
}

function processRows() {
  if (hostPlatform === "win32") {
    const result = NodeChildProcess.spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (result.status !== 0) {
      throw new Error(`Could not inspect Windows process tree: ${result.stderr}`);
    }
    const parsed = JSON.parse(result.stdout.trim() || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
      pid: Number(row.ProcessId),
      parentPid: Number(row.ParentProcessId),
      command: row.CommandLine ?? "",
    }));
  }
  const result = NodeChildProcess.spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Could not inspect process tree: ${result.stderr}`);
  return result.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] }));
}

export function descendantPids(rootPid, rows) {
  const descendants = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (
        (row.parentPid === rootPid || descendants.has(row.parentPid)) &&
        !descendants.has(row.pid)
      ) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  return descendants;
}

async function listeningPid(port) {
  if (hostPlatform === "darwin") {
    const { stdout } = await execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"]);
    const pids = [...stdout.matchAll(/^p(\d+)$/gm)].map((match) => Number(match[1]));
    return pids.length === 1 ? pids[0] : undefined;
  }
  if (hostPlatform === "linux") {
    const { stdout } = await execFile("ss", ["-H", "-ltnp", `sport = :${port}`]);
    const pids = [...stdout.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]));
    return pids.length === 1 ? pids[0] : undefined;
  }
  if (hostPlatform === "win32") {
    const { stdout } = await execFile(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true },
    );
    const parsed = JSON.parse(stdout.trim() || "[]");
    const pids = (Array.isArray(parsed) ? parsed : [parsed]).map(Number);
    return pids.length === 1 ? pids[0] : undefined;
  }
  return undefined;
}

async function closeElectron(child, debugPort) {
  if (hostPlatform !== "win32") {
    process.kill(child.pid, "SIGTERM");
    return;
  }
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
    signal: AbortSignal.timeout(2_000),
  });
  const version = await response.json();
  if (!response.ok || typeof version.webSocketDebuggerUrl !== "string") {
    throw new Error("Could not resolve the Electron browser target for clean shutdown.");
  }
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Browser CDP connection failed.")), {
      once: true,
    });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Electron did not acknowledge the browser close request.")),
      5_000,
    );
    const complete = () => {
      clearTimeout(timeout);
      resolve();
    };
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === 1) complete();
    });
    socket.addEventListener("close", complete, { once: true });
    socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  });
  socket.close();
}

async function waitForProcessExit(child, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Electron did not exit before the shutdown deadline.")),
        timeoutMs,
      ),
    ),
  ]);
}

async function ensurePidsExited(pids) {
  await waitFor(
    "tracked desktop child processes to exit",
    () => {
      const active = new Set(processRows().map((row) => row.pid));
      return [...pids].every((pid) => !active.has(pid));
    },
    10_000,
  );
}

async function runProjectCommand({ repoRoot, environment, args }) {
  const serverEntry = NodePath.join(repoRoot, "apps/server/dist/bin.mjs");
  if (!NodeFS.existsSync(serverEntry)) {
    throw new Error(`Desktop smoke requires the built server CLI at ${serverEntry}.`);
  }
  const result = await execFile(process.execPath, [serverEntry, "project", ...args], {
    cwd: repoRoot,
    env: environment,
    timeout: 20_000,
  });
  return result.stdout.trim();
}

async function launchOnce({
  executablePath,
  launchArgs,
  environment,
  backendPort,
  debugPort,
  expectedStateDir,
  exerciseBackendRestart,
  onReady,
}) {
  let output = "";
  const child = NodeChildProcess.spawn(
    executablePath,
    [`--remote-debugging-port=${debugPort}`, ...launchArgs],
    {
      cwd: NodePath.dirname(executablePath),
      detached: hostPlatform !== "win32",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => {
    output = appendOutput(output, chunk);
  });
  child.stderr.on("data", (chunk) => {
    output = appendOutput(output, chunk);
  });
  const failIfExited = () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Electron exited before readiness.\n${output}`);
    }
  };

  try {
    const baseUrl = new URL(`http://127.0.0.1:${backendPort}`);
    const descriptor = await fetchReady(baseUrl);
    failIfExited();
    await verifyFrontend(baseUrl);
    const renderer = await verifyRenderer(debugPort);
    const stateDatabase = NodePath.join(expectedStateDir, "statev2.sqlite");
    if (!NodeFS.existsSync(stateDatabase)) {
      throw new Error(
        `Backend readiness used an unexpected state directory; missing ${stateDatabase}.`,
      );
    }

    const rows = processRows();
    const descendants = descendantPids(child.pid, rows);
    const backendPid = await waitFor("desktop backend process ownership", async () => {
      const pid = await listeningPid(backendPort);
      return pid !== undefined && descendants.has(pid) ? pid : false;
    });
    if (exerciseBackendRestart) {
      process.kill(backendPid, "SIGTERM");
      const restartedPid = await waitFor("desktop backend restart", async () => {
        const pid = await listeningPid(backendPort).catch(() => undefined);
        if (pid === undefined || pid === backendPid) return false;
        const currentDescendants = descendantPids(child.pid, processRows());
        if (!currentDescendants.has(pid)) return false;
        await fetchReady(baseUrl);
        return pid;
      });
      if (restartedPid === backendPid)
        throw new Error("Desktop backend restart reused the dead process.");
    }

    await onReady?.({ descriptor, renderer });

    const trackedChildren = descendantPids(child.pid, processRows());
    await closeElectron(child, debugPort);
    const exit = await waitForProcessExit(child);
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error(
        `Electron shutdown was not clean (code=${exit.code}, signal=${exit.signal}).\n${output}`,
      );
    }
    await ensurePidsExited(trackedChildren);
    return { descriptor, renderer, stateDatabase };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (hostPlatform === "win32") {
          NodeChildProcess.spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
          });
        } else {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {}
      await waitForProcessExit(child, 5_000).catch(() => undefined);
    }
    const detail = output.trim().length > 0 ? `\nElectron output:\n${output}` : "";
    throw new Error(`${error instanceof Error ? error.message : String(error)}${detail}`, {
      cause: error,
    });
  }
}

function assertOwnedTemporaryRoot(root) {
  const temporaryRoot = NodeFS.realpathSync(NodeOS.tmpdir());
  const resolvedRoot = NodeFS.realpathSync(root);
  if (!resolvedRoot.startsWith(`${temporaryRoot}${NodePath.sep}`)) {
    throw new Error(`Refusing to use non-temporary desktop smoke root: ${resolvedRoot}`);
  }
}

export async function runDesktopLifecycleSmoke({
  executablePath,
  launchArgs,
  repoRoot,
  expectedArchitecture,
}) {
  if (!NodeFS.existsSync(executablePath)) {
    throw new Error(`Desktop executable does not exist: ${executablePath}`);
  }
  if (expectedArchitecture && hostArchitecture !== expectedArchitecture) {
    throw new Error(
      `Desktop smoke host architecture ${hostArchitecture} does not match ${expectedArchitecture}.`,
    );
  }

  // Keep this short because macOS limits Unix-domain socket paths to 103 bytes.
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fds-"));
  assertOwnedTemporaryRoot(root);
  const backendPort = await reservePort();
  const debugPort = await reservePort();
  const { environment, home, t3Home, temporaryDirectory, roamingAppData, localAppData } =
    makeIsolatedEnvironment({
      inherited: process.env,
      root,
      backendPort,
    });
  const expectedStateDir = NodePath.join(t3Home, "userdata");
  const appDataDirectory =
    hostPlatform === "darwin"
      ? NodePath.join(home, "Library", "Application Support")
      : hostPlatform === "win32"
        ? roamingAppData
        : environment.XDG_CONFIG_HOME;
  const expectedUserData = NodePath.join(appDataDirectory, "t3code-v2");
  const projectDir = NodePath.join(root, "synthetic-project");
  for (const directory of [home, temporaryDirectory, roamingAppData, localAppData, projectDir]) {
    await NodeFSP.mkdir(directory, { recursive: true });
  }
  await NodeFSP.writeFile(
    NodePath.join(projectDir, "README.md"),
    "# FD CODE desktop lifecycle smoke project\n",
  );

  console.log(`Desktop smoke isolation: ${root}`);
  try {
    const first = await launchOnce({
      executablePath,
      launchArgs,
      environment,
      backendPort,
      debugPort,
      expectedStateDir,
      exerciseBackendRestart: true,
      onReady: () =>
        runProjectCommand({
          repoRoot,
          environment,
          args: ["add", projectDir, "--title", "Lifecycle Smoke", "--base-dir", t3Home],
        }),
    });

    if (!NodeFS.existsSync(expectedUserData)) {
      throw new Error(
        `Electron used an unexpected profile directory; missing ${expectedUserData}.`,
      );
    }

    const second = await launchOnce({
      executablePath,
      launchArgs,
      environment,
      backendPort,
      debugPort,
      expectedStateDir,
      exerciseBackendRestart: false,
      onReady: () =>
        runProjectCommand({
          repoRoot,
          environment,
          args: ["rename", projectDir, "Lifecycle Smoke Restarted", "--base-dir", t3Home],
        }),
    });
    if (first.descriptor.environmentId !== second.descriptor.environmentId) {
      throw new Error("Desktop environment identity changed across an isolated restart.");
    }

    console.log("Desktop lifecycle smoke passed:");
    console.log(` - backend ready at http://127.0.0.1:${backendPort}`);
    console.log(" - frontend and renderer initialized");
    console.log(" - unexpected backend exit recovered");
    console.log(" - normal shutdown reaped tracked children");
    console.log(" - second launch preserved the synthetic project and environment identity");
  } finally {
    assertOwnedTemporaryRoot(root);
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
}

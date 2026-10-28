import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { makeIsolatedEnvironment, runDesktopLifecycleSmoke } from "./smoke-test-lib.mjs";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const repoRoot = NodePath.resolve(__dirname, "..", "..", "..");
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone artifact verifier targets the actual host.
const hostPlatform = NodeOS.platform();
const PROCESS_TIMEOUT_MS = 120_000;

function parseArguments(args) {
  let installerPath;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--installer") {
      installerPath = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown Windows installer smoke argument: ${args[index]}`);
  }
  if (!installerPath) {
    throw new Error("Usage: smoke-test-windows-installer.mjs --installer <artifact.exe>");
  }
  return NodePath.resolve(installerPath);
}

function runProcess(executablePath, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(executablePath, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const timeout = setTimeout(() => {
      NodeChildProcess.spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
      reject(new Error(`${NodePath.basename(executablePath)} timed out.\n${output}`));
    }, PROCESS_TIMEOUT_MS);
    child.once("error", (cause) => {
      clearTimeout(timeout);
      reject(new Error(`Could not launch ${executablePath}.`, { cause }));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && signal === null) resolve(output);
      else {
        reject(
          new Error(
            `${NodePath.basename(executablePath)} failed (code=${code}, signal=${signal}).\n${output}`,
          ),
        );
      }
    });
  });
}

async function waitForRemoval(resourcePath) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!NodeFS.existsSync(resourcePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Uninstaller did not remove ${resourcePath}.`);
}

async function removeTemporaryRoot(root) {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      await NodeFSP.rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (
        Date.now() >= deadline ||
        !error ||
        typeof error !== "object" ||
        !["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function sha256(filePath) {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertPe(filePath, expectedMachine) {
  const handle = await NodeFSP.open(filePath, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    await handle.read(dosHeader, 0, dosHeader.length, 0);
    if (dosHeader.toString("ascii", 0, 2) !== "MZ") {
      throw new Error(`${filePath} is not a Windows PE executable.`);
    }
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const coffHeader = Buffer.alloc(6);
    await handle.read(coffHeader, 0, coffHeader.length, peOffset);
    if (coffHeader.toString("ascii", 0, 4) !== "PE\0\0") {
      throw new Error(`${filePath} has an invalid Windows PE header.`);
    }
    if (expectedMachine !== undefined && coffHeader.readUInt16LE(4) !== expectedMachine) {
      throw new Error(`${filePath} does not target the expected Windows architecture.`);
    }
  } finally {
    await handle.close();
  }
}

if (hostPlatform !== "win32") {
  console.log("Windows installer smoke skipped: this check requires a Windows runner.");
  process.exit(0);
}

const installerPath = parseArguments(process.argv.slice(2));
if (!NodeFS.existsSync(installerPath) || NodePath.extname(installerPath).toLowerCase() !== ".exe") {
  throw new Error(`Windows installer does not exist: ${installerPath}`);
}
await assertPe(installerPath);
const artifactStat = await NodeFSP.stat(installerPath);
const artifactHash = await sha256(installerPath);
const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-code-windows-smoke-"));
const installDir = NodePath.join(root, "installation");
const installerStateRoot = NodePath.join(root, "installer-state");
const { environment, home, temporaryDirectory, roamingAppData, localAppData } =
  makeIsolatedEnvironment({ inherited: process.env, root: installerStateRoot, backendPort: 1 });
for (const directory of [home, temporaryDirectory, roamingAppData, localAppData]) {
  await NodeFSP.mkdir(directory, { recursive: true });
}

let installed = false;
try {
  await runProcess(installerPath, ["/S", `/D=${installDir}`], { env: environment });
  const executablePath = NodePath.join(installDir, "FD CODE.exe");
  const uninstallerPath = NodePath.join(installDir, "Uninstall FD CODE.exe");
  if (!NodeFS.existsSync(executablePath) || !NodeFS.existsSync(uninstallerPath)) {
    throw new Error(`NSIS did not create the expected FD CODE installation at ${installDir}.`);
  }
  installed = true;
  await assertPe(executablePath, 0x8664);

  await runDesktopLifecycleSmoke({
    executablePath,
    launchArgs: [],
    repoRoot,
    expectedArchitecture: "x64",
  });

  await runProcess(uninstallerPath, ["/S"], { env: environment });
  installed = false;
  await waitForRemoval(installDir);

  console.log("Windows x64 installer smoke passed:");
  console.log(` - artifact: ${NodePath.basename(installerPath)}`);
  console.log(` - size: ${artifactStat.size} bytes`);
  console.log(` - SHA-256: ${artifactHash}`);
  console.log(
    " - isolated install, lifecycle recovery, persistence, shutdown, and uninstall passed",
  );
} finally {
  if (installed) {
    const uninstallerPath = NodePath.join(installDir, "Uninstall FD CODE.exe");
    if (NodeFS.existsSync(uninstallerPath)) {
      await runProcess(uninstallerPath, ["/S"], { env: environment }).catch(() => undefined);
    }
  }
  await removeTemporaryRoot(root);
}

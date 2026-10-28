import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { runDesktopLifecycleSmoke } from "./smoke-test-lib.mjs";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const repoRoot = NodePath.resolve(__dirname, "..", "..", "..");
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone artifact verifier targets the actual host.
const hostPlatform = NodeOS.platform();

function parseArguments(args) {
  let dmgPath;
  let expectedArchitecture = "arm64";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dmg") {
      dmgPath = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--expect-arch") {
      expectedArchitecture = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown macOS DMG smoke argument: ${argument}`);
  }
  if (!dmgPath)
    throw new Error("Usage: smoke-test-macos-dmg.mjs --dmg <artifact> [--expect-arch arm64]");
  return { dmgPath: NodePath.resolve(dmgPath), expectedArchitecture };
}

async function requiredPath(resourcePath) {
  if (!NodeFS.existsSync(resourcePath)) {
    throw new Error(`Packaged application is missing required resource: ${resourcePath}`);
  }
}

if (hostPlatform !== "darwin") {
  console.log("macOS DMG smoke skipped: this check requires a macOS runner.");
  process.exit(0);
}

const { dmgPath, expectedArchitecture } = parseArguments(process.argv.slice(2));
if (!NodeFS.existsSync(dmgPath) || NodePath.extname(dmgPath).toLowerCase() !== ".dmg") {
  throw new Error(`DMG artifact does not exist: ${dmgPath}`);
}

const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "fd-code-dmg-smoke-"));
const mountPoint = NodePath.join(root, "mount");
await NodeFSP.mkdir(mountPoint);
let mounted = false;

try {
  await execFile(
    "hdiutil",
    ["attach", dmgPath, "-readonly", "-nobrowse", "-mountpoint", mountPoint],
    {
      timeout: 60_000,
    },
  );
  mounted = true;
  const appNames = (await NodeFSP.readdir(mountPoint)).filter(
    (name) => name.startsWith("FD CODE") && name.endsWith(".app"),
  );
  if (appNames.length !== 1) {
    throw new Error(
      `Expected exactly one FD CODE application in the DMG, found ${appNames.length}.`,
    );
  }

  const appBundle = NodePath.join(mountPoint, appNames[0]);
  const plistPath = NodePath.join(appBundle, "Contents", "Info.plist");
  const { stdout: executableNameOutput } = await execFile("plutil", [
    "-extract",
    "CFBundleExecutable",
    "raw",
    plistPath,
  ]);
  const executablePath = NodePath.join(appBundle, "Contents", "MacOS", executableNameOutput.trim());
  const resources = NodePath.join(appBundle, "Contents", "Resources");
  await Promise.all([
    requiredPath(executablePath),
    requiredPath(NodePath.join(resources, "app.asar")),
    requiredPath(NodePath.join(resources, "resource-monitor", "fd-code-resource-monitor")),
    requiredPath(
      NodePath.join(
        appBundle,
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
        "Versions",
        "A",
        "Electron Framework",
      ),
    ),
  ]);

  const { stdout: architectureOutput } = await execFile("lipo", ["-archs", executablePath]);
  const architectures = architectureOutput.trim().split(/\s+/);
  if (!architectures.includes(expectedArchitecture)) {
    throw new Error(
      `Packaged executable architectures ${architectures.join(", ")} do not include ${expectedArchitecture}.`,
    );
  }

  let gatekeeper = "accepted";
  try {
    await execFile("spctl", ["--assess", "--type", "execute", appBundle]);
  } catch {
    gatekeeper = "not accepted (expected for an unsigned local build)";
  }

  await runDesktopLifecycleSmoke({
    executablePath,
    launchArgs: [],
    repoRoot,
    expectedArchitecture,
  });
  console.log(`macOS DMG smoke passed: ${NodePath.basename(dmgPath)}`);
  console.log(` - mounted application: ${appNames[0]}`);
  console.log(` - executable architectures: ${architectures.join(", ")}`);
  console.log(` - Gatekeeper: ${gatekeeper}`);
} finally {
  if (mounted) {
    await execFile("hdiutil", ["detach", mountPoint], { timeout: 30_000 }).catch(async () => {
      await execFile("hdiutil", ["detach", mountPoint, "-force"], { timeout: 30_000 });
    });
  }
  await NodeFSP.rm(root, { recursive: true, force: true });
}

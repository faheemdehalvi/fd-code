import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { resolveElectronBinaryPath } from "./electron-launcher.mjs";
import { parseSmokeArguments, runDesktopLifecycleSmoke } from "./smoke-test-lib.mjs";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const repoRoot = NodePath.resolve(desktopDir, "..", "..");
const options = parseSmokeArguments(process.argv.slice(2));
const executablePath = options.appExecutable ?? resolveElectronBinaryPath();
const launchArgs = options.appExecutable
  ? []
  : [NodePath.resolve(desktopDir, "dist-electron/boot.cjs")];

await runDesktopLifecycleSmoke({
  executablePath,
  launchArgs,
  repoRoot,
  expectedArchitecture: options.expectedArchitecture,
});

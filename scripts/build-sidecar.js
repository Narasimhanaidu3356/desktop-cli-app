import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const sidecarDir = path.join(rootDir, "automation-sidecar");
const binDir = path.join(sidecarDir, "bin");
const specFile = path.join(sidecarDir, "talentscreen-automation.spec");

const exeName = process.platform === "win32" ? "talentscreen-automation.exe" : "talentscreen-automation";
const targetExe = path.join(binDir, exeName);

console.log("[build-sidecar] Checking automation sidecar binary...");

let pythonCmd = null;
for (const cmd of ["python", "python3", "py"]) {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore" });
    pythonCmd = cmd;
    break;
  } catch {}
}

if (pythonCmd) {
  console.log(`[build-sidecar] Using ${pythonCmd} to build sidecar with PyInstaller...`);
  try {
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }
    execSync(`${pythonCmd} -m PyInstaller --clean --noconfirm --distpath "${binDir}" "${specFile}"`, {
      cwd: rootDir,
      stdio: "inherit"
    });
    console.log(`[build-sidecar] Successfully built ${targetExe}`);
    process.exit(0);
  } catch (err) {
    console.warn(`[build-sidecar] PyInstaller build failed: ${err.message}`);
  }
} else {
  console.warn("[build-sidecar] Python environment not detected.");
}

if (fs.existsSync(targetExe)) {
  console.log(`[build-sidecar] Using existing pre-built binary at ${targetExe}`);
} else {
  console.error(`[build-sidecar] ERROR: Binary ${targetExe} is missing and PyInstaller build could not complete!`);
  console.error("Please install Python 3 & PyInstaller (pip install -r automation-sidecar/requirements-build.txt) to build the sidecar executable.");
  process.exit(1);
}

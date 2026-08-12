# TalentScreen Apply - Setup and Run Guide (From Scratch)

This guide walks you through the step-by-step process of setting up and running the **TalentScreen Apply** application from scratch on a new machine after cloning it from GitHub.

---

## 🛠️ Phase 1: Prerequisites

Before setting up the project, make sure the following dependencies are installed on your machine:

1. **Node.js** (v18 or higher)
   * Download and install from: [nodejs.org](https://nodejs.org/)
2. **Python** (v3.10 or higher)
   * Download and install from: [python.org](https://www.python.org/)
   * *Important:* Ensure you check the box to **"Add Python to PATH"** during installation.
3. **Rust & Tauri build tools**
   * Install Rustup from: [rustup.rs](https://rustup.rs/)
   * **On Windows:** Make sure you install the **Microsoft C++ Build Tools** when prompted by the Rust installer or download it separately.

---

## 📦 Phase 2: Installing Dependencies

Open a terminal (e.g., PowerShell on Windows) in the root of the cloned project folder (`talentscreen-desktop`) and run the following commands:

### 1. Install Node.js Frontend & Tauri Packages
```powershell
npm install
```

### 2. Install Python Dependencies & PyInstaller
```powershell
pip install -r automation-sidecar/requirements-build.txt
```

### 3. Install NLP Name Extraction & Gender Guesser Libraries
```powershell
pip install spacy gender-guesser
python -m spacy download en_core_web_sm
```

### 4. Install Playwright Browser Files
This installs the required Chromium browser binary in the default local cache directory:
```powershell
python -m playwright install chromium
```

*(Optional)* If you want to install Chromium directly into the `automation-sidecar/browsers` folder for Tauri packaging:
```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "automation-sidecar\browsers"
python -m playwright install chromium
```

---

## 🏗️ Phase 3: Building the Sidecar Binaries

Before running Tauri in dev mode or compiling a build, you need to compile the Python automation engine sidecars into executable binaries:

```powershell
npm run build:sidecar
```

This script will run PyInstaller and copy `talentscreen-automation.exe` and `main.exe` into the `automation-sidecar/bin/` folder.

---

## 🚀 Phase 4: Running the App in Development Mode

To launch the desktop application with live hot-reloading for both the frontend (React) and native shell (Tauri/Rust):

```powershell
npm run tauri dev
```

---

## 📂 Phase 5: Creating the Production Installer

To bundle the frontend, Rust engine, Python sidecars, and browser files into a final production installer (`.exe` installer for Windows):

```powershell
npm run tauri build
```

The completed installer will be output to:
`src-tauri\target\release\bundle\nsis\TalentScreen Apply_<version>_x64-setup.exe`

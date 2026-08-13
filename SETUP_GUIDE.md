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

## 📦 Phase 2: Installing Dependencies & Environment Setup

Open a terminal in the root of the cloned project folder and run the following commands:

### 1. Install Node.js Frontend & Tauri Packages
```powershell
npm install
```

### 2. Set Up Python Virtual Environment & Install Dependencies
Setting up a virtual environment ensures clean dependency isolation:

**On Windows (PowerShell):**
```powershell
# Create virtual environment
python -m venv .venv

# Install Python packages
.venv\Scripts\pip install -r automation-sidecar/requirements-build.txt
```

**On macOS / Linux:**
```bash
# Create virtual environment
python3 -m venv .venv

# Install Python packages
.venv/bin/pip install -r automation-sidecar/requirements-build.txt
```

### 3. Install Playwright Chromium Browser
You **must** download and install the browser inside the `automation-sidecar/browsers` folder so it can be correctly bundled by Tauri:

**On Windows (PowerShell):**
```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "automation-sidecar\browsers"
.venv\Scripts\python -m playwright install chromium
```

**On macOS / Linux:**
```bash
export PLAYWRIGHT_BROWSERS_PATH="automation-sidecar/browsers"
.venv/bin/python -m playwright install chromium
```

### 4. Create and Configure `.env` File
By default, the application runs in Demo/Mock Mode. To run the real application and login with your Whitebox Learning account, you must create a `.env` file and set mock data to false:

1. Copy `.env.example` to `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Open `.env` and configure the following variables:
   ```env
   VITE_WBL_API_URL=https://api.whitebox-learning.com/api
   VITE_USE_MOCK_DATA=false
   VITE_USE_APPLICATION_API=true
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

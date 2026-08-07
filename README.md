# TalentScreen Apply

Standalone Tauri desktop application for Windows and macOS to automatically apply to supported Greenhouse and Lever jobs from the Whitebox Learning job feed.

---

## 🛠 How It Works

TalentScreen Apply operates as a hybrid desktop application designed to run locally on the candidate's machine. The application structure consists of:

1. **Frontend Dashboard (React, Vite, TypeScript):** A sleek, modern UI shell where candidates sign in, upload their resumes, define reusable application preferences, and see the job feed dashboard.
2. **Native Application Shell (Tauri & Rust):** Manages window lifecycles, file systems, and runs the local Python sidecar process.
3. **Local Automation Sidecar (FastAPI & Playwright Python):** Runs loopback-only APIs. It launches headless/headful Playwright browser instances to interact with Job Application forms.
4. **Lightweight Name-to-Gender Mapping:**
   - Infers the candidate's first name and predicts gender (Male or Female) using `gender-guesser`.
   - Runs instantly and offline with no heavy AI/NLP models (like spaCy), ensuring instant form-filling.
   - normalises demographic fields to match ATS form structures.
5. **Education Fields Autofill:**
   - Automatically parses and populates School, Degree, Major/Discipline, and Start/End Dates on both Greenhouse and Lever application forms.
6. **EEO & Demographic Logic:**
   - **Gender:** Pre-selects "Male" or "Female" based on name prediction. Defaults to "Decline to self-identify" if ambiguous.
   - **Race/Ethnicity:** Defaults to "Decline to self-identify" or uses manually-supplied preferences.
   - **Veteran Status:** **ALWAYS** selects the protected veteran classification option (e.g. "I am a veteran" or "I identify as one or more classifications of a protected veteran") per user requirements.
   - **Disability Status:** Defaults to "No, I don't have a disability" unless customized.
7. **Auto-Submit Polling Loop:**
   - When a CAPTCHA or missing required fields are encountered, the extension content script and sidecar enter a polling loop. Once the candidate completes the remaining details in the browser tab, the application is automatically submitted.

For a full breakdown of frontend, backend, and sidecar IPC channels, see the [ARCHITECTURE.md](file:///d:/jobsautomation%20-%20Copy/talentscreen-desktop/ARCHITECTURE.md) design document.

---

## 💻 Commands for Setup, Run, and Build

### 1. Prerequisites
Ensure the following tools are installed on your system:
- **Node.js** (v18 or higher)
- **Python** (v3.10 or higher)
- **Rust** (via Rustup, along with Microsoft C++ Build Tools on Windows)

---

### 2. Environment Setup

Run the following commands to install dependencies and download browser packages:

#### Install Frontend & Tauri packages:
```powershell
npm install
```

#### Install Python dependencies & PyInstaller build requirements:
```powershell
pip install -r automation-sidecar/requirements-build.txt
```

#### Install NLP name extraction & gender classification libraries:
```powershell
pip install spacy gender-guesser
python -m spacy download en_core_web_sm
```

#### Install Playwright browser binaries:
```powershell
# Installs Chromium browser in local cache/app directory
python -m playwright install chromium
```

---

### 3. Running in Development Mode

To start the desktop application in live development mode (with hot reloading for frontend and Rust sidecar):

```powershell
npm run tauri dev
```

> **Note:** If you want to work on the browser UI/Vite frontend only, you can run the Python sidecar manually in one terminal:
> ```powershell
> python automation-sidecar/main.py
> ```
> and launch the Vite dev server in another:
> ```powershell
> npm run dev
> ```

---

### 4. Building the Updated Automation Sidecars

Before compiling the Tauri installer, you must freeze the updated Python sidecar code into executable binaries (`.exe` format) using PyInstaller. You can run the automated script from the root `talentscreen-desktop` folder:

```powershell
npm run build:sidecar
```

Or you can run the manual commands:

```powershell
# 1. Navigate to the sidecar folder
cd automation-sidecar

# 2. Build the primary Playwright-bundled sidecar
pyinstaller --clean --noconfirm talentscreen-automation.spec

# 3. Build the fallback sidecar
pyinstaller --clean --noconfirm main.spec

# 4. Copy the newly compiled executables from the 'dist/' folder to the 'bin/' folder
Copy-Item -Path "dist/talentscreen-automation.exe" -Destination "bin/talentscreen-automation.exe" -Force
Copy-Item -Path "dist/main.exe" -Destination "bin/main.exe" -Force

# 5. Navigate back to the workspace root
cd ..
```

---

### 5. Building the Tauri Desktop Installer (NSIS)

To build the final production release bundle with the embedded Python sidecars and Playwright Chromium browsers packaged into a Windows NSIS installer (`.exe` installer):

```powershell
npm run tauri build
```

Once the compilation completes successfully, the output installer file will be located at:
`src-tauri\target\release\bundle\nsis\TalentScreen Apply_<version>_x64-setup.exe`

---

## 🔒 Security & Data Privacy

- Resume files and parsed metadata are kept inside the candidate's local temporary directory (`.talentscreen_resume`).
- No database or LLM is involved.
- All session automation runs locally over loopback (`127.0.0.1`).

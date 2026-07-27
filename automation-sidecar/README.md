# TalentScreen Playwright sidecar

This loopback-only FastAPI process is the desktop app's standalone Greenhouse
and Lever automation engine. It does not import JobCLI, load a Chrome extension,
or call an LLM.

The candidate's normalized JSON profile and PDF are stored in the OS session
temporary directory and removed when the Tauri process exits. The browser fills
only values present in that profile or in the reusable answers supplied in the
desktop app. Missing required answers and CAPTCHA stop submission.

Windows development:

```powershell
py -m pip install -r automation-sidecar\requirements-build.txt
py -m playwright install chromium
py automation-sidecar\main.py
```

The packaged macOS build embeds the sidecar executable and Playwright Chromium.

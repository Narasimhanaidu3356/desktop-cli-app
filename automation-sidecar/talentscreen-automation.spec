# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

# Locate the playwright package in the active Python environment so we can
# bundle the entire package (including the node.exe driver) into the frozen exe.
try:
    import playwright as _pw
    PLAYWRIGHT_PKG = str(Path(_pw.__file__).parent)
except ImportError:
    PLAYWRIGHT_PKG = None

# Bundle the complete playwright package so the exe is self-contained on any
# Windows machine that does NOT have playwright/Python installed.
datas = []
if PLAYWRIGHT_PKG:
    datas.append((PLAYWRIGHT_PKG, "playwright"))

try:
    import gender_guesser as _gg
    GENDER_GUESSER_DIR = str(Path(_gg.__file__).parent)
    datas.append((GENDER_GUESSER_DIR, "gender_guesser"))
except ImportError:
    pass

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[
        # Playwright internals that PyInstaller may miss via static analysis
        "playwright",
        "playwright.sync_api",
        "playwright.async_api",
        "playwright._impl._driver",
        "playwright._impl._browser",
        "playwright._impl._browser_context",
        "playwright._impl._page",
        # uvicorn internals
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        # starlette/FastAPI internals
        "anyio",
        "anyio._backends._asyncio",
        "starlette",
        "starlette.routing",
        "email.mime.text",
        "email.mime.multipart",
        "email.mime.base",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='talentscreen-automation',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

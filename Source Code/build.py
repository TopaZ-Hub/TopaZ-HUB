#!/usr/bin/env python3
"""
TopaZ build system (Python)
===========================
Builds the whole TopaZ product line for Windows x64:

  1. native C++ components (llvm-mingw cross compiler or MSVC/clang on Windows)
       - TopazMediaEngine.exe   (export engine, Media Foundation)
       - TopaZ Creative Hub.exe (app manager / updater)
       - TopaZSetupStub.exe     (installer / uninstaller)
  2. the TopaZ Editing Pro 26 application folder (Electron runtime + JS UI)
  3. dist/TopaZ_Editing_Pro_26_Setup.exe  (stub + ZIP payload + trailer)
  4. dist/manifest.json  (update feed for TopaZ Creative Hub)

Usage:
  python build.py [--version 26.0.0] [--electron-zip PATH] [--toolchain DIR]
                  [--installer-url URL] [--manifest-url URL] [--notes "..."]
"""
import argparse, hashlib, json, os, shutil, struct, subprocess, sys, zipfile, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
DIST = ROOT / "dist"
APP_NAME = "TopaZ Editing Pro 26"
APP_ID = "EditingPro26"
EXE_NAME = APP_NAME + ".exe"
HUB_EXE = "TopaZ Creative Hub.exe"
DEFAULT_MANIFEST_URL = "https://raw.githubusercontent.com/TopaZ-Hub/TopaZ-Editing-Pro/main/manifest.json"
KEEP_LOCALES = {"pl.pak", "en-US.pak", "en-GB.pak"}


def log(msg):
    print(f"[build] {msg}", flush=True)


def run(cmd, **kw):
    log(" ".join(str(c) for c in cmd) if isinstance(cmd, list) else cmd)
    subprocess.run(cmd, check=True, **kw)


def set_version_in_sources(version):
    """keep version strings in sync across JS / C++ / resource files"""
    pkg = ROOT / "package.json"
    data = json.loads(pkg.read_text(encoding="utf-8"))
    data["version"] = version
    pkg.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    parts = (version.split(".") + ["0", "0", "0"])[:4]
    for rc in ROOT.glob("native/**/*.rc"):
        t = rc.read_text(encoding="utf-8")
        t = re.sub(r'(FILEVERSION|PRODUCTVERSION) [\d,]+', lambda m: f"{m.group(1)} {','.join(parts)}", t)
        t = re.sub(r'VALUE "(FileVersion|ProductVersion)", "[^"]*"', lambda m: f'VALUE "{m.group(1)}", "{version}"', t)
        rc.write_text(t, encoding="utf-8")
    for src, pat in [(ROOT / "native/engine/engine.cpp", r'#define ENGINE_VERSION "[^"]*"'),
                     (ROOT / "native/hub/hub.cpp", r'HUB_VERSION = L"[^"]*"')]:
        t = src.read_text(encoding="utf-8")
        rep = f'#define ENGINE_VERSION "{version}"' if "ENGINE" in pat else f'HUB_VERSION = L"{version}"'
        src.write_text(re.sub(pat, rep, t), encoding="utf-8")


def compile_native(tc):
    """cross compile the C++ components"""
    bin_ = Path(tc) / "bin"
    cxx, cc, windres = bin_ / "x86_64-w64-mingw32-clang++", bin_ / "x86_64-w64-mingw32-clang", bin_ / "x86_64-w64-mingw32-windres"
    out = BUILD / "native"
    out.mkdir(parents=True, exist_ok=True)
    flags = ["-O2", "-std=c++17", "-municode", "-static", "-s"]
    # engine (console app)
    e = ROOT / "native/engine"
    run([windres, e / "engine.rc", "-O", "coff", "-o", out / "engine.res"], cwd=e)
    run([cxx, *flags, "-o", out / "TopazMediaEngine.exe", e / "engine.cpp", out / "engine.res",
         "-lmfplat", "-lmfreadwrite", "-lmfuuid", "-lole32", "-luuid"])
    # hub
    hdir = ROOT / "native/hub"
    run([windres, hdir / "hub.rc", "-O", "coff", "-o", out / "hub.res"], cwd=hdir)
    run([cxx, *flags, "-mwindows", "-o", out / HUB_EXE, hdir / "hub.cpp", out / "hub.res",
         "-lgdiplus", "-lshlwapi", "-lole32", "-luuid", "-lshell32", "-ldwmapi", "-lwinhttp", "-lbcrypt", "-luser32", "-lgdi32", "-ladvapi32"])
    # setup stub
    s = ROOT / "native/setup"
    run([windres, s / "setup.rc", "-O", "coff", "-o", out / "setup.res"], cwd=s)
    run([cc, "-O2", "-c", s / "miniz.c", "-o", out / "miniz.o"])
    run([cxx, *flags, "-mwindows", "-o", out / "TopaZSetupStub.exe", s / "setup.cpp", out / "miniz.o", out / "setup.res",
         "-lgdiplus", "-lshlwapi", "-lole32", "-luuid", "-lshell32", "-ldwmapi", "-lcomctl32", "-luser32", "-lgdi32", "-ladvapi32"])
    # same installer with the Creative Hub logo/icon (standalone hub setup)
    run([windres, "-DHUB_SETUP", s / "setup.rc", "-O", "coff", "-o", out / "setup_hub.res"], cwd=s)
    run([cxx, *flags, "-mwindows", "-o", out / "TopaZHubSetupStub.exe", s / "setup.cpp", out / "miniz.o", out / "setup_hub.res",
         "-lgdiplus", "-lshlwapi", "-lole32", "-luuid", "-lshell32", "-ldwmapi", "-lcomctl32", "-luser32", "-lgdi32", "-ladvapi32"])
    return out


def build_app(electron_zip, native_out, version, rcedit=None, wine=None):
    app_dir = BUILD / APP_NAME
    if app_dir.exists():
        shutil.rmtree(app_dir)
    log(f"rozpakowywanie Electron: {electron_zip}")
    with zipfile.ZipFile(electron_zip) as z:
        z.extractall(app_dir)
    (app_dir / "electron.exe").rename(app_dir / EXE_NAME)
    for f in (app_dir / "locales").iterdir():
        if f.name not in KEEP_LOCALES:
            f.unlink()
    res = app_dir / "resources"
    for f in ("default_app.asar",):
        if (res / f).exists():
            (res / f).unlink()
    dst = res / "app"
    dst.mkdir(parents=True)
    for f in ("package.json", "main.js", "preload.js"):
        shutil.copy2(ROOT / f, dst / f)
    shutil.copytree(ROOT / "renderer", dst / "renderer")
    (res / "engine").mkdir()
    shutil.copy2(native_out / "TopazMediaEngine.exe", res / "engine" / "TopazMediaEngine.exe")
    (app_dir / "version").write_text(version)
    if rcedit and wine:
        log("ustawianie ikony i informacji o wersji (rcedit)")
        env = dict(os.environ, WINEDEBUG="-all")
        run([wine, rcedit, str(app_dir / EXE_NAME), "--set-icon", str(ROOT / "branding/logo_editing.ico"),
             "--set-version-string", "FileDescription", APP_NAME, "--set-version-string", "ProductName", APP_NAME,
             "--set-version-string", "CompanyName", "TopaZ", "--set-version-string", "LegalCopyright", "(c) 2026 TopaZ",
             "--set-version-string", "OriginalFilename", EXE_NAME, "--set-version-string", "InternalName", "TopaZEditingPro",
             "--set-file-version", version, "--set-product-version", version], env=env)
    elif rcedit and os.name == "nt":
        run([rcedit, str(app_dir / EXE_NAME), "--set-icon", str(ROOT / "branding/logo_editing.ico"),
             "--set-version-string", "FileDescription", APP_NAME, "--set-version-string", "ProductName", APP_NAME,
             "--set-file-version", version, "--set-product-version", version])
    return app_dir


def build_setup(app_dir, native_out, version, manifest_url):
    DIST.mkdir(exist_ok=True)
    payload = BUILD / "payload.zip"
    ini = (f"AppId={APP_ID}\nAppName={APP_NAME}\nVersion={version}\nPublisher=TopaZ\nMainExe={EXE_NAME}\n"
           f"DefaultDir=TopaZ\\{APP_NAME}\nDirName={APP_NAME}\nFileExt=.tzproj\nFileDesc=Projekt TopaZ Editing Pro\n"
           f"HasHub=1\nHubExe={HUB_EXE}\nManifestURL={manifest_url or ''}\n")
    log("tworzenie paczki instalacyjnej (ZIP)…")
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED, compresslevel=7) as z:
        z.writestr("setup.ini", ini.encode("utf-8"))
        for p in sorted(app_dir.rglob("*")):
            if p.is_file():
                z.write(p, "app/" + p.relative_to(app_dir).as_posix())
        z.write(native_out / HUB_EXE, "hub/" + HUB_EXE)
        z.write(ROOT / "branding/logo_hub.ico", "hub/logo_hub.ico")
    out = DIST / f"TopaZ_Editing_Pro_26_Setup.exe"
    log(f"składanie {out.name}")
    with open(out, "wb") as f:
        f.write((native_out / "TopaZSetupStub.exe").read_bytes())
        size = 0
        with open(payload, "rb") as p:
            while True:
                b = p.read(1 << 20)
                if not b:
                    break
                f.write(b)
                size += len(b)
        f.write(struct.pack("<Q", size) + b"TZPAYLD1")
    return out


def append_payload(stub, payload, out):
    with open(out, "wb") as f:
        f.write(Path(stub).read_bytes())
        data = Path(payload).read_bytes()
        f.write(data)
        f.write(struct.pack("<Q", len(data)) + b"TZPAYLD1")


def build_hub_setup(native_out, version, manifest_url):
    """Standalone TopaZ Creative Hub installer (to share with friends)."""
    DIST.mkdir(exist_ok=True)
    payload = BUILD / "payload_hub.zip"
    ini = ("AppId=CreativeHub\nAppName=TopaZ Creative Hub\n"
           f"Version={version}\nPublisher=TopaZ\nMainExe={HUB_EXE}\n"
           "DefaultDir=TopaZ\\TopaZ Creative Hub\nDirName=TopaZ Creative Hub\nFileExt=\n"
           f"HasHub=0\nHubOnly=1\nAutoStart=1\nManifestURL={manifest_url or ''}\n")
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("setup.ini", ini.encode("utf-8"))
        z.write(native_out / HUB_EXE, "app/" + HUB_EXE)
        z.write(ROOT / "branding/logo_hub.ico", "app/logo_hub.ico")
    out = DIST / "TopaZ_Creative_Hub_Setup.exe"
    log(f"składanie {out.name}")
    append_payload(native_out / "TopaZHubSetupStub.exe", payload, out)
    return out


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def read_notes(version):
    """Lista zmian z notes/<wersja>.txt (np. notes/26.1.txt dla 26.1.0)."""
    short = re.sub(r"(\.0)+$", "", version)
    for name in (version, short):
        p = ROOT / "notes" / f"{name}.txt"
        if p.exists():
            return p.read_text(encoding="utf-8").strip()
    return f"Wersja {version}"


def write_manifest(setup, version, installer_url, notes):
    m = {
        "hub": "TopaZ Creative Hub",
        "updated": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "apps": [{
            "id": APP_ID, "name": APP_NAME, "version": version,
            "description": "Montaż wideo z silnikiem GPU: 90+ efektów, przejścia, Lumetri, szybki eksport sprzętowy H.264/H.265 do 4K.",
            "notes": notes or read_notes(version),
            "installer": installer_url or f"https://example.com/{setup.name}",
            "size": setup.stat().st_size, "sha256": sha256(setup)
        }]
    }
    p = DIST / "manifest.json"
    p.write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")
    return p


def main():
    ap = argparse.ArgumentParser(description="TopaZ build")
    ap.add_argument("--version", default=json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"])
    ap.add_argument("--electron-zip", default=os.environ.get("TOPAZ_ELECTRON_ZIP", str(ROOT.parent / "dl/electron-win.zip")))
    ap.add_argument("--toolchain", default=os.environ.get("TOPAZ_TOOLCHAIN", str(ROOT.parent / "dl/llvm-mingw-20250528-ucrt-ubuntu-22.04-x86_64")))
    ap.add_argument("--rcedit", default=os.environ.get("TOPAZ_RCEDIT", str(ROOT.parent / "dl/rcedit.exe")))
    ap.add_argument("--wine", default=os.environ.get("TOPAZ_WINE", ""))
    ap.add_argument("--installer-url", default="")
    ap.add_argument("--manifest-url", default=DEFAULT_MANIFEST_URL)
    ap.add_argument("--notes", default="")
    ap.add_argument("--skip-native", action="store_true")
    a = ap.parse_args()
    log(f"TopaZ Editing Pro {a.version}")
    set_version_in_sources(a.version)
    BUILD.mkdir(exist_ok=True)
    native_out = BUILD / "native" if a.skip_native else compile_native(a.toolchain)
    app_dir = build_app(a.electron_zip, native_out, a.version, a.rcedit if Path(a.rcedit).exists() else None, a.wine or None)
    setup = build_setup(app_dir, native_out, a.version, a.manifest_url)
    hub_setup = build_hub_setup(native_out, a.version, a.manifest_url)
    man = write_manifest(setup, a.version, a.installer_url, a.notes)
    log(f"        {hub_setup} ({hub_setup.stat().st_size / 1e6:.1f} MB)")
    log(f"GOTOWE: {setup} ({setup.stat().st_size / 1e6:.1f} MB)")
    log(f"        {man}")


if __name__ == "__main__":
    main()

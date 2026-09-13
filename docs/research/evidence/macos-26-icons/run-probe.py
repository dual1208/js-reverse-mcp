"""Repeat the same-bundle fixture experiment; never target a browser process."""

import argparse
import fcntl
import os
from pathlib import Path
import plistlib
import subprocess
import time


def run_probe():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-only", action="store_true")
    args = parser.parse_args()
    build = subprocess.check_output(["/usr/bin/sw_vers", "-buildVersion"], text=True).strip()
    if build != "25F84" or os.uname().machine != "arm64":
        raise SystemExit("This private-protocol experiment is restricted to macOS build 25F84 on arm64.")

    sources = Path(__file__).resolve().parent
    scratch = Path("/tmp/js-reverse-icon-research")
    scratch.mkdir(mode=0o700, exist_ok=True)
    lock = (scratch / "fixture-run.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("Another fixture runner is already active.")

    bundle = scratch / "Icon Fixture.app"
    executable = bundle / "Contents/MacOS/IconFixture"
    executable.parent.mkdir(parents=True, exist_ok=True)
    with (bundle / "Contents/Info.plist").open("wb") as info:
        plistlib.dump({
            "CFBundleExecutable": "IconFixture",
            "CFBundleIdentifier": "local.js-reverse.icon-fixture",
            "CFBundleName": "Icon research fixture",
            "CFBundlePackageType": "APPL",
            "CFBundleVersion": "1",
            "LSUIElement": False,
        }, info)
    sender = scratch / "dock-bitmap-probe"
    for source, output in [("fixture.m", executable), ("dock-bitmap-probe.m", sender)]:
        subprocess.run([
            "xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wno-deprecated-declarations",
            "-framework", "AppKit", "-framework", "ApplicationServices",
            str(sources / source), "-o", str(output),
        ], check=True)
    if args.build_only:
        print("Both programs compiled. No apps launched and no icon messages sent.")
        return

    (scratch / "stop-fixtures").unlink(missing_ok=True)
    children = []
    try:
        for label, icon in [("A", "/System/Applications/Calculator.app"),
                            ("B", "/System/Applications/TextEdit.app")]:
            ready = scratch / f"fixture-{label}.pid"
            ready.unlink(missing_ok=True)
            child = subprocess.Popen([str(executable), label])
            children.append(child)
            deadline = time.monotonic() + 10
            while not ready.exists():
                if child.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError(f"Fixture {label} did not become ready.")
                time.sleep(0.1)
            if ready.read_text() != str(child.pid):
                raise RuntimeError("Fixture identity did not match the spawned process.")
            subprocess.run([str(sender), str(child.pid), icon], check=True)

        print("Press Cmd+Tab: are the two 'Icon research fixture' entries Calculator and TextEdit?", flush=True)
        print("Transport success is not visual confirmation. Fixtures close after three minutes or Ctrl+C.", flush=True)
        while any(child.poll() is None for child in children):
            time.sleep(0.25)
    except KeyboardInterrupt:
        pass
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        print("Fixtures closed; browser processes were not targeted.")


if __name__ == "__main__":
    run_probe()

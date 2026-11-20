#!/usr/bin/env python3
"""Render the example images of the visual components from their own `examples/images.ts` in headless Chrome.

  python3.12 -B classes/render_images.py [COMPONENT ...]

`examples/images.ts` exports `scenes`: [{name, caption, width, height, look?, waitMs?, render(root, context)}], optionally
`uses` (components whose stylesheets the scenes need) and optionally `context()`, run once in Node before the screenshots:
it returns JSON the scenes receive, and may list in `stop` process ids ended afterwards (such as a local service the
scenes connect to). Each scene is bundled with the component's sources, the theme is applied with the look (`night`
unless given; theme-high-contrast applies its own themes), and Chrome takes a screenshot at the scene's size: on virtual
time, or on the real clock after `waitMs` for a scene that talks to a live service. The images go to `images/<name>.png`
and the manifest's `images` lists them in scene order (the first is the main image).
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent
COMPONENTS = WORKSPACE / "components"
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
ESBUILD = os.environ.get("ESBUILD", str(WORKSPACE / "ourapps/node_modules/.bin/esbuild"))
LIMIT = 2 * 1024 * 1024

ENTRY = """
import * as gallery from %(module)s;
import themes from %(themes)s with { type: "json" };
import { applyTheme, resolveTheme } from %(tokens)s;
(async () => {
  const scene = gallery.scenes[Number(new URLSearchParams(location.search).get("scene"))];
  applyTheme(resolveTheme(themes as any, { themeName: scene.look }), document.documentElement);
  document.documentElement.dataset.look = scene.look ?? "";
  const root = document.getElementById("root")!;
  // The scene's own size, also the box fixed-position parts are placed in: Chrome's window can be wider than a phone.
  Object.assign(root.style, { width: scene.width + "px", height: scene.height + "px", overflow: "hidden", transform: "translateZ(0)" });
  await scene.render(root, JSON.parse(document.getElementById("context")!.textContent!));
  document.title = "ready";
})().catch((error) => { document.title = "failed"; document.getElementById("root")!.textContent = "SCENE FAILED: " + error; });
"""

PAGE = """<!doctype html><html><head><meta charset="utf-8">%(links)s
<title>loading</title><style>html,body{margin:0;height:100%%;overflow:hidden}body{background:var(--background);color:var(--text);font-family:var(--font-family);font-size:var(--font-body)}
#root{position:relative;width:100%%;height:100%%;box-sizing:border-box}</style></head>
<body><div id="root"></div><script type="application/json" id="context">%(context)s</script><script>%(script)s</script></body></html>"""


def png_size(path):
    data = path.read_bytes()[:24]
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path
    return struct.unpack(">II", data[16:24])


def chrome(args, timeout=120):
    """Chrome's output; a run that hangs is tried again, up to three times."""
    for attempt in range(3):
        try:
            return subprocess.run([CHROME, *args], check=True, capture_output=True, text=True, timeout=timeout).stdout
        except subprocess.TimeoutExpired:
            if attempt == 2:
                raise


def listing_of(component):
    """The scene list without the render functions, the stylesheet components and the context, from Node."""
    # Beside the component, so the packages it imports resolve from its own node_modules.
    out = COMPONENTS / component / ".images-list.mjs"
    subprocess.run([ESBUILD, str(COMPONENTS / component / "examples/images.ts"), "--bundle", "--format=esm", "--platform=node", "--packages=external",
                    "--log-level=error", f"--outfile={out}"], check=True)
    script = (f"const m = await import({json.dumps(out.as_uri())}); const context = m.context ? await m.context() : {{}};"
              " process.stdout.write(JSON.stringify({uses: m.uses ?? [], context, scenes: m.scenes.map(({render, ...rest}) => rest)})); process.exit(0)")
    try:
        return json.loads(subprocess.run(["node", "--input-type=module", "-e", script], check=True, capture_output=True, text=True,
                                         cwd=COMPONENTS / component).stdout)
    finally:
        out.unlink()


def shoot(component, package, theme, work, listing):
    entry = work / "entry.ts"
    entry.write_text(ENTRY % {"module": json.dumps(str(package / "examples/images.ts")), "themes": json.dumps(str(theme / "themes.json")),
                              "tokens": json.dumps(str(theme / "tokens.ts"))})
    bundle = work / "bundle.js"
    # node: imports appear only in the Node-side context(); the page never runs it.
    subprocess.run([ESBUILD, str(entry), "--bundle", "--format=iife", "--platform=browser", "--loader:.svg=text", "--loader:.png=dataurl",
                    "--external:node:*", "--log-level=error", f"--outfile={bundle}"], check=True, cwd=package)
    sheets = [theme / "theme.css"]
    for name in [*listing["uses"], component]:
        sheets += sorted((COMPONENTS / name / "implementation/web").glob("*.css"))
    links = "".join(f'<link rel="stylesheet" href="{s.as_uri()}">' for s in dict.fromkeys(sheets))
    context = json.dumps(listing["context"]).replace("</", "<\\/")
    (work / "page.html").write_text(PAGE % {"links": links, "context": context, "script": bundle.read_text().replace("</script>", "<\\/script>")})
    target = package / "images"
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir()
    images = []
    for index, scene in enumerate(listing["scenes"]):
        shot = target / f"{scene['name']}.png"
        profile = work / f"profile-{index}"
        page = (work / "page.html").as_uri() + f"?scene={index}"
        wait = [f"--timeout={scene['waitMs']}"] if scene.get("waitMs") else ["--virtual-time-budget=4000"]
        common = ["--headless=new", "--disable-gpu", "--no-first-run", "--allow-file-access-from-files",
                  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", *wait]
        chrome([*common, "--hide-scrollbars", "--force-device-scale-factor=1", f"--user-data-dir={profile}",
                f"--window-size={scene['width']},{scene['height']}", f"--screenshot={shot}", page])
        dom = chrome([*common, f"--user-data-dir={profile}-dom", "--dump-dom", page])
        if "<title>ready</title>" not in dom:
            body = dom[dom.find('<div id="root"'):dom.find("<script")]
            raise SystemExit(f"{component} {scene['name']}: the scene did not finish: {body[:400]}")
        width, height = png_size(shot)
        assert (width, height) == (scene["width"], scene["height"]), (shot, width, height)
        assert shot.stat().st_size <= LIMIT, (shot, shot.stat().st_size)
        assert len(scene["caption"]) <= 140, scene["name"]
        images.append({"path": f"images/{shot.name}", "caption": scene["caption"], "platform": "web", "width": width, "height": height})
    assert 1 <= len(images) <= 12, component
    return images


def render(component):
    package = COMPONENTS / component
    theme = COMPONENTS / ("theme-high-contrast" if component == "theme-high-contrast" else "theme") / "implementation/web"
    with tempfile.TemporaryDirectory(prefix="images-") as directory:
        listing = listing_of(component)
        try:
            images = shoot(component, package, theme, Path(directory), listing)
        finally:
            for pid in listing["context"].get("stop", []):
                try:
                    os.kill(pid, 9)
                except ProcessLookupError:
                    pass
    manifest_path = package / "component.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["images"] = images
    sys.path.insert(0, os.environ.get("AEPM_CHECKOUT", str(WORKSPACE / "aepm")))
    from aepm.model import canonical
    manifest_path.write_bytes(canonical(manifest))
    print(f"{component}: {len(images)} images")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("components", nargs="*")
    names = parser.parse_args().components or sorted(p.parent.parent.name for p in COMPONENTS.glob("*/examples/images.ts"))
    for name in names:
        render(name)


if __name__ == "__main__":
    main()

"""Assemble index.html from src/. Usage: python3 build.py"""
from pathlib import Path

root = Path(__file__).resolve().parent
src = root / "src"
read = lambda name: (src / name).read_text(encoding="utf-8")

app = read("app.js")
app = app.replace("/*ICONS_DATA*/", "var ICONS = " + read("icons.json").strip() + ";")
app = app.replace("/*DEMO_DATA*/", read("demo.js").strip())

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#050a13">
<meta name="description" content="Community vault for ChromieCraft challenge characters: browse what other players offer, or share your own spare items.">
<title>Iron Vault</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>
{read("base.css")}{read("extra.css")}</style>
<!-- Wowhead tooltips. Link rewriting is off: the page draws its own icons, names and quality colours. -->
<script>const whTooltips = {{ colorLinks: false, iconizeLinks: false, renameLinks: false }};</script>
<script src="https://wow.zamimg.com/widgets/power.js" defer></script>
</head>
<body>
{read("glyphs.svg")}
{read("body.html")}
<script src="config.js"></script>
<script>
{app}</script>
</body>
</html>
"""
(root / "index.html").write_text(html, encoding="utf-8")
print("index.html", len(html), "bytes")

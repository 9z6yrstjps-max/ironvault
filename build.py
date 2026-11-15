"""Assemble index.html (landing page) and vault.html (the vault) from src/. Usage: python3 build.py"""
from pathlib import Path

root = Path(__file__).resolve().parent
src = root / "src"
read = lambda name: (src / name).read_text(encoding="utf-8")

app = read("app.js")
app = app.replace("/*ICONS_DATA*/", "var ICONS = " + read("icons.json").strip() + ";")
app = app.replace("/*DEMO_DATA*/", read("demo.js").strip())

DESC = "Community vault for ChromieCraft challenge characters: browse what other players offer, or share your own spare items."

def page(title, body, scripts=""):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#050a13">
<meta name="description" content="{DESC}">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
<style>
{read("base.css")}{read("extra.css")}</style>
</head>
<body>
{body}
{scripts}</body>
</html>
"""

# Wowhead tooltips. Link rewriting is off: the vault draws its own icons, names and quality colours.
vault_scripts = f"""<script>const whTooltips = {{ colorLinks: false, iconizeLinks: false, renameLinks: false }};</script>
<script src="https://wow.zamimg.com/widgets/power.js" defer></script>
<script src="config.js"></script>
<script>
{app}</script>
"""

pages = {
    "index.html": page("Iron Vault: community vault for ChromieCraft challenges", read("landing.html"),
                       f"""<script src="config.js"></script>\n<script>\n{read("landing.js")}</script>\n"""),                 # landing page
    "vault.html": page("Iron Vault", read("glyphs.svg") + "\n" + read("body.html"), vault_scripts),       # the vault itself
}
for name, html in pages.items():
    (root / name).write_text(html, encoding="utf-8")
    print(name, len(html), "bytes")

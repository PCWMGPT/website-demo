#!/usr/bin/env python3
"""
SharePoint -> website sync (Pointer Creek).

Publishes the documents listed in sharepoint_map.json from the
"Pointer Creek Web Content" SharePoint site: downloads each into ./docs/,
then rebuilds the Resources page document list (grouped by section),
sitemap.xml, and llms.txt. Only files named in the map are published;
everything else in the library is ignored.

Runs in GitHub Actions on a schedule.

Required secrets (env):  SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET
Optional config (env):   SP_HOSTNAME (default pointercreek.sharepoint.com),
                         SP_SITE_PATH (default /sites/Websitecontent),
                         SP_LIBRARY  (default Documents)
Dry run (no SharePoint): SP_DRYRUN=1  -> renders the page layout from the map
                         alone, with placeholder /docs/<slug>.pdf links.
"""

import os
import re
import sys
import json
import html
import pathlib
import requests

GRAPH = "https://graph.microsoft.com/v1.0"
HOSTNAME = os.environ.get("SP_HOSTNAME", "pointercreek.sharepoint.com")
SITE_PATH = os.environ.get("SP_SITE_PATH", "/sites/Websitecontent")
LIBRARY = os.environ.get("SP_LIBRARY", "Documents")
DRYRUN = os.environ.get("SP_DRYRUN") == "1"

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "docs"
RESOURCES = ROOT / "resources.html"
SITEMAP = ROOT / "sitemap.xml"
LLMS = ROOT / "llms.txt"
MAP_FILE = ROOT / "sharepoint_map.json"
SITE_URL = "https://www.pointercreek.com"

TYPE_LABEL = {".pdf": "PDF", ".docx": "DOCX", ".doc": "DOC", ".xlsx": "XLSX",
              ".xls": "XLS", ".pptx": "PPTX", ".csv": "CSV", ".txt": "TXT"}


def die(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load_map():
    if not MAP_FILE.exists():
        die("sharepoint_map.json not found.")
    m = json.loads(MAP_FILE.read_text(encoding="utf-8"))
    return m.get("documents", {}), m.get("_section_order", [])


def slugify(title, ext):
    s = re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-").lower()
    return f"{s}{ext.lower()}"


def get_token():
    tid, cid, sec = (os.environ.get(k) for k in
                     ("SP_TENANT_ID", "SP_CLIENT_ID", "SP_CLIENT_SECRET"))
    if not (tid and cid and sec):
        die("Missing SP_TENANT_ID / SP_CLIENT_ID / SP_CLIENT_SECRET secrets.")
    r = requests.post(
        f"https://login.microsoftonline.com/{tid}/oauth2/v2.0/token",
        data={"client_id": cid, "client_secret": sec,
              "scope": "https://graph.microsoft.com/.default",
              "grant_type": "client_credentials"}, timeout=30)
    if r.status_code != 200:
        die(f"Token request failed ({r.status_code}): {r.text}")
    return r.json()["access_token"]


def g(session, url):
    r = session.get(url, timeout=60)
    if r.status_code != 200:
        die(f"Graph GET failed ({r.status_code}) {url}\n{r.text}")
    return r.json()


def list_files(session, drive_id, item_id="root"):
    out = []
    url = f"{GRAPH}/drives/{drive_id}/items/{item_id}/children?$top=200"
    while url:
        data = g(session, url)
        for it in data.get("value", []):
            if it.get("folder"):
                out += list_files(session, drive_id, it["id"])
            elif it.get("file"):
                out.append(it)
        url = data.get("@odata.nextLink")
    return out


def collect_from_sharepoint(mapping):
    token = get_token()
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {token}"
    site = g(s, f"{GRAPH}/sites/{HOSTNAME}:{SITE_PATH}")
    print(f"Site: {site.get('displayName')}")
    drives = g(s, f"{GRAPH}/sites/{site['id']}/drives").get("value", [])
    drive = next((d for d in drives if d.get("name", "").lower() == LIBRARY.lower()),
                 None) or g(s, f"{GRAPH}/sites/{site['id']}/drive")
    drive_id = drive["id"]
    DOCS_DIR.mkdir(exist_ok=True)
    entries = []
    for f in list_files(s, drive_id):
        name = f["name"]
        if name not in mapping:
            continue                      # only publish mapped files
        meta = mapping[name]
        ext = os.path.splitext(name)[1].lower()
        local = slugify(meta["title"], ext)
        dl = f.get("@microsoft.graph.downloadUrl")
        if not dl:
            dl = g(s, f"{GRAPH}/drives/{drive_id}/items/{f['id']}").get("@microsoft.graph.downloadUrl")
        (DOCS_DIR / local).write_bytes(requests.get(dl, timeout=180).content)
        entries.append({"title": meta["title"], "section": meta["section"],
                        "file": local, "type": TYPE_LABEL.get(ext, ext.upper().strip("."))})
        print(f"  {name} -> docs/{local}")
    return entries


def collect_dryrun(mapping):
    entries = []
    for name, meta in mapping.items():
        ext = os.path.splitext(name)[1].lower()
        entries.append({"title": meta["title"], "section": meta["section"],
                        "file": slugify(meta["title"], ext),
                        "type": TYPE_LABEL.get(ext, "PDF")})
    return entries


def main():
    mapping, order = load_map()
    entries = collect_dryrun(mapping) if DRYRUN else collect_from_sharepoint(mapping)
    print(f"{len(entries)} document(s).")
    rebuild_resources(entries, order)
    update_sitemap(entries)
    update_llms(entries, order)
    print("Done." + (" (dry run)" if DRYRUN else ""))


def grouped(entries, order):
    secs = {}
    for e in entries:
        secs.setdefault(e["section"], []).append(e)
    ordered = [s for s in order if s in secs] + [s for s in secs if s not in order]
    for s in ordered:
        yield s, sorted(secs[s], key=lambda e: e["title"].lower())


def rebuild_resources(entries, order):
    if not RESOURCES.exists():
        return
    rows = ["          <!-- SP-DOCS:START --><!-- Auto-generated from SharePoint. Do not edit by hand. -->"]
    for section, docs in grouped(entries, order):
        rows.append(f'          <p class="res-cat">{html.escape(section)}</p>')
        for e in docs:
            rows.append(
                f'          <a class="res-doc" href="docs/{e["file"]}">'
                f'<span>{html.escape(e["title"])}</span>'
                f'<span class="type">{e["type"]} ↓</span></a>')
    rows.append("          <!-- SP-DOCS:END -->")
    block = "\n".join(rows)
    txt = RESOURCES.read_text(encoding="utf-8")
    txt = re.sub(r"<!-- SP-DOCS:START -->.*?<!-- SP-DOCS:END -->", block, txt, flags=re.S)
    RESOURCES.write_text(txt, encoding="utf-8")


def update_sitemap(entries):
    if not SITEMAP.exists():
        return
    txt = SITEMAP.read_text(encoding="utf-8")
    txt = re.sub(r"\n\s*<url><loc>[^<]*/docs/[^<]*</loc>[^\n]*</url>", "", txt)
    lines = "".join(
        f'  <url><loc>{SITE_URL}/docs/{e["file"]}</loc><priority>0.5</priority></url>\n'
        for e in entries)
    SITEMAP.write_text(txt.replace("</urlset>", lines + "</urlset>"), encoding="utf-8")


def update_llms(entries, order):
    if not LLMS.exists():
        return
    block = "## Documents\n"
    for section, docs in grouped(entries, order):
        for e in docs:
            block += f'- [{e["title"]}]({SITE_URL}/docs/{e["file"]}) ({section}): {e["type"]} download.\n'
    txt = LLMS.read_text(encoding="utf-8")
    if "## Documents\n" in txt:
        txt = re.sub(r"## Documents\n(?:- .*\n)*", block, txt)
    else:
        txt = txt.rstrip() + "\n\n" + block
    LLMS.write_text(txt, encoding="utf-8")


if __name__ == "__main__":
    main()

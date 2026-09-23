#!/usr/bin/env python3
"""
SharePoint -> website sync (Pointer Creek).

Reads documents from the SharePoint "Pointer Creek Web Content" site via the
Microsoft Graph API, downloads them into ./docs/ with fixed URLs, and rebuilds
the document list on resources.html plus sitemap.xml and llms.txt so the files
are downloadable and discoverable by Google / AI crawlers.

It is intended to run in GitHub Actions on a schedule; it commits nothing itself
(the workflow commits any changes it produces).

Required environment variables (set as GitHub Actions secrets):
  SP_TENANT_ID       Entra ID (Azure AD) tenant id (GUID)
  SP_CLIENT_ID       App registration (client) id
  SP_CLIENT_SECRET   App registration client secret

Optional (have sensible defaults for this site):
  SP_HOSTNAME   default: pointercreek.sharepoint.com
  SP_SITE_PATH  default: /sites/Websitecontent
  SP_LIBRARY    default: Documents        (the document library / drive name)
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

ROOT = pathlib.Path(__file__).resolve().parent.parent   # repo root
DOCS_DIR = ROOT / "docs"
RESOURCES = ROOT / "resources.html"
SITEMAP = ROOT / "sitemap.xml"
LLMS = ROOT / "llms.txt"
SITE_URL = "https://www.pointercreek.com"

TYPE_LABEL = {
    ".pdf": "PDF", ".docx": "DOCX", ".doc": "DOC", ".xlsx": "XLSX",
    ".xls": "XLS", ".pptx": "PPTX", ".csv": "CSV", ".txt": "TXT",
}


def die(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def get_token():
    tid = os.environ.get("SP_TENANT_ID")
    cid = os.environ.get("SP_CLIENT_ID")
    sec = os.environ.get("SP_CLIENT_SECRET")
    if not (tid and cid and sec):
        die("Missing SP_TENANT_ID / SP_CLIENT_ID / SP_CLIENT_SECRET secrets.")
    r = requests.post(
        f"https://login.microsoftonline.com/{tid}/oauth2/v2.0/token",
        data={
            "client_id": cid,
            "client_secret": sec,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    if r.status_code != 200:
        die(f"Token request failed ({r.status_code}): {r.text}")
    return r.json()["access_token"]


def g(session, url):
    r = session.get(url, timeout=60)
    if r.status_code != 200:
        die(f"Graph GET failed ({r.status_code}) {url}\n{r.text}")
    return r.json()


def slugify(name):
    stem, ext = os.path.splitext(name)
    stem = re.sub(r"[^A-Za-z0-9]+", "-", stem).strip("-").lower()
    return f"{stem}{ext.lower()}"


def list_files(session, drive_id, item_id="root", prefix=""):
    """Recursively list files in a drive folder."""
    out = []
    url = f"{GRAPH}/drives/{drive_id}/items/{item_id}/children?$top=200"
    while url:
        data = g(session, url)
        for it in data.get("value", []):
            if it.get("folder"):
                out += list_files(session, drive_id, it["id"], prefix + it["name"] + "/")
            elif it.get("file"):
                out.append(it)
        url = data.get("@odata.nextLink")
    return out


def main():
    token = get_token()
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {token}"

    # 1) resolve the site
    site = g(s, f"{GRAPH}/sites/{HOSTNAME}:{SITE_PATH}")
    site_id = site["id"]
    print(f"Site: {site.get('displayName')}  ({site_id})")

    # 2) find the document library (drive) by name, else default drive
    drives = g(s, f"{GRAPH}/sites/{site_id}/drives").get("value", [])
    drive = next((d for d in drives if d.get("name", "").lower() == LIBRARY.lower()), None)
    if not drive:
        drive = g(s, f"{GRAPH}/sites/{site_id}/drive")
    drive_id = drive["id"]
    print(f"Library: {drive.get('name')}  ({drive_id})")

    # 3) list + download files
    files = list_files(s, drive_id)
    DOCS_DIR.mkdir(exist_ok=True)
    entries = []
    for f in files:
        name = f["name"]
        ext = os.path.splitext(name)[1].lower()
        if ext not in TYPE_LABEL:
            print(f"  skip (unsupported type): {name}")
            continue
        local = slugify(name)
        dl = f.get("@microsoft.graph.downloadUrl")
        if not dl:
            item = g(s, f"{GRAPH}/drives/{drive_id}/items/{f['id']}")
            dl = item.get("@microsoft.graph.downloadUrl")
        content = requests.get(dl, timeout=120).content
        (DOCS_DIR / local).write_bytes(content)
        title = os.path.splitext(name)[0]
        entries.append({"title": title, "file": local, "type": TYPE_LABEL[ext]})
        print(f"  downloaded: {name} -> docs/{local}  ({len(content)//1024} KB)")

    entries.sort(key=lambda e: e["title"].lower())
    print(f"{len(entries)} document(s) published.")

    # 4) rebuild the resources.html document list between markers
    rebuild_resources(entries)
    update_sitemap(entries)
    update_llms(entries)
    print("Done.")


def rebuild_resources(entries):
    if not RESOURCES.exists():
        return
    txt = RESOURCES.read_text(encoding="utf-8")
    if entries:
        rows = ["          <!-- SP-DOCS:START --><!-- Auto-generated from SharePoint. Do not edit by hand. -->"]
        for e in entries:
            t = html.escape(e["title"])
            rows.append(
                f'          <a class="res-doc" href="docs/{e["file"]}">'
                f'<span>{t}</span><span class="type">{e["type"]} ↓</span></a>'
            )
        rows.append("          <!-- SP-DOCS:END -->")
        block = "\n".join(rows)
    else:
        block = ('          <!-- SP-DOCS:START -->\n'
                 '          <!-- SP-DOCS:END -->')
    new = re.sub(r"<!-- SP-DOCS:START -->.*?<!-- SP-DOCS:END -->", block,
                 txt, flags=re.S)
    RESOURCES.write_text(new, encoding="utf-8")


def update_sitemap(entries):
    if not SITEMAP.exists():
        return
    txt = SITEMAP.read_text(encoding="utf-8")
    txt = re.sub(r"\n\s*<url><loc>[^<]*/docs/[^<]*</loc>[^\n]*</url>", "", txt)
    lines = "".join(
        f'  <url><loc>{SITE_URL}/docs/{e["file"]}</loc><priority>0.5</priority></url>\n'
        for e in entries
    )
    txt = txt.replace("</urlset>", lines + "</urlset>")
    SITEMAP.write_text(txt, encoding="utf-8")


def update_llms(entries):
    if not LLMS.exists():
        return
    txt = LLMS.read_text(encoding="utf-8")
    block = "## Documents\n" + "".join(
        f'- [{e["title"]}]({SITE_URL}/docs/{e["file"]}): {e["type"]} download.\n'
        for e in entries
    )
    if "## Documents\n" in txt:
        txt = re.sub(r"## Documents\n(?:- .*\n)*", block, txt)
    else:
        txt = txt.rstrip() + "\n\n" + block
    LLMS.write_text(txt, encoding="utf-8")


if __name__ == "__main__":
    main()

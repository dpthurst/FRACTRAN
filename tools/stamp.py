#!/usr/bin/env python3
"""Stamp index.html with a build id and versioned asset URLs.

GitHub Pages serves everything with `cache-control: max-age=600`, so after a
push a browser can keep running yesterday's app.js for ten minutes — and a
mixed page (fresh index.html, stale app.js) is worse than a stale one.  This
script does two things:

  * rewrites every `<script src="...">` and the stylesheet link to carry
    `?v=<build id>`, so a freshly loaded index.html always pulls matching
    assets rather than whatever the cache happens to hold;
  * writes the build id into the footer, so the person testing the live page
    can see which build they are running.

The build id is a UTC timestamp: it cannot be the commit's own hash (the hash
does not exist until after the file is written).  Run this before committing
any change that a live page should pick up:

    python3 tools/stamp.py && git add index.html && git commit ...

Idempotent for a given minute; run it again if the minute rolls over.
"""

import datetime
import re
import sys

PATH = "index.html"

def main():
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    with open(PATH, encoding="utf-8") as fh:
        html = fh.read()

    # version every local asset reference (never external URLs); an existing
    # ?v=... query is replaced, not doubled
    def version(match):
        attr, path = match.group(1), match.group(2)
        if path.startswith("http") or path.startswith("//"):
            return match.group(0)
        base = path.split("?")[0]
        return f'{attr}="{base}?v={stamp}"'

    html, n_assets = re.subn(
        r'(src|href)="([^"?]+\.(?:js|css))(?:\?[^"]*)?"', version, html)
    html, n_stamp = re.subn(
        r'(<span id="build"[^>]*>)[^<]*(</span>)',
        r'\g<1>' + stamp + r'\g<2>', html)
    if n_stamp != 1:
        print("error: expected exactly one <span id=\"build\"> in index.html", file=sys.stderr)
        return 1

    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"stamped {n_assets} asset URLs and the footer with build {stamp}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
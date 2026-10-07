#!/usr/bin/env bash
# Builds the two browser copies from index.html (the Artifact source, which has no <html>/<head> of its own).
#   standalone.html : open straight from disk in any browser
#   site/index.html : static site for public hosting (adds link-preview tags, kept out of search engines)
set -euo pipefail
cd "$(dirname "$0")"
DESC="Interactive 3D tabletop exercise of the National Mall on July 4, 2026: nine scenario injects, crowd and egress simulation, sensor feeds and AI decision support."
OG_IMG="https://d8j0ntlcm91z4.cloudfront.net/user_3ElygVjTX24E5NzAtPDUPVlTTIu/hf_20261007_195450_ca989dc7-255b-4286-babc-e65974fb6640.png"
HEAD='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:dark}body{margin:0}img{max-width:100%}</style>'
{ printf '<!doctype html>\n<html lang="en"><head>%s</head><body>\n' "$HEAD"; cat index.html; printf '\n</body></html>\n'; } > standalone.html
mkdir -p site
{ printf '<!doctype html>\n<html lang="en"><head>%s\n' "$HEAD"
  printf '<meta name="description" content="%s">\n<meta name="robots" content="noindex">\n' "$DESC"
  printf '<meta property="og:type" content="website">\n<meta property="og:title" content="America 250 Mall Ops">\n<meta property="og:description" content="%s">\n<meta property="og:image" content="%s">\n<meta name="twitter:card" content="summary_large_image">\n' "$DESC" "$OG_IMG"
  printf '</head><body>\n'; cat index.html; printf '\n</body></html>\n'; } > site/index.html
echo "built standalone.html and site/index.html"

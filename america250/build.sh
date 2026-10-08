#!/usr/bin/env bash
# Builds the two browser copies from index.html (the Artifact source, which has no <html>/<head> of its own).
#   standalone.html : open straight from disk in any browser
#   site/index.html : static site for public hosting (adds link-preview tags, kept out of search engines)
set -euo pipefail
cd "$(dirname "$0")"
# The public copy serves three.js (r128, MIT) and OrbitControls from site/vendor, because some managed networks block the CDNs.
# standalone.html and the Artifact keep the CDN links.
SELF_HOSTED() { sed -e 's#https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js#/vendor/three.min.js#' -e 's#https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js#/vendor/OrbitControls.js#' index.html; }
DESC="Make the call at nine incidents on the National Mall. A free, fictional tabletop exercise built with AI. Real places, invented incidents. Not an operational tool."
SITE_URL="https://america250-mall-ops.vercel.app/"
OG_TITLE="America 250 · National Mall exercise (fictional)"
# Link-preview card (1200x627): a rendered image served from the site itself, so it never depends on a third-party CDN.
OG_IMG="${SITE_URL}og.jpg"
OG_ALT="America 250, National Mall: a fictional tabletop exercise. A 3D model of the Mall with a crowd shown by density, beside the title."
HEAD='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:dark}body{margin:0}img{max-width:100%}</style>'
{ printf '<!doctype html>\n<html lang="en"><head>%s</head><body>\n' "$HEAD"; cat index.html; printf '\n</body></html>\n'; } > standalone.html
mkdir -p site
{ printf '<!doctype html>\n<html lang="en"><head>%s\n' "$HEAD"
  printf '<meta name="description" content="%s">\n<meta name="robots" content="noindex">\n' "$DESC"
  printf '<meta property="og:type" content="website">\n<meta property="og:site_name" content="Ad Astra AI">\n<meta property="og:url" content="%s">\n<meta property="og:title" content="%s">\n<meta property="og:description" content="%s">\n' "$SITE_URL" "$OG_TITLE" "$DESC"
  printf '<meta property="og:image" content="%s">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="627">\n<meta property="og:image:alt" content="%s">\n' "$OG_IMG" "$OG_ALT"
  printf '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="%s">\n<meta name="twitter:description" content="%s">\n<meta name="twitter:image" content="%s">\n' "$OG_TITLE" "$DESC" "$OG_IMG"
  printf '</head><body>\n'; SELF_HOSTED; printf '\n</body></html>\n'; } > site/index.html
echo "built standalone.html and site/index.html"

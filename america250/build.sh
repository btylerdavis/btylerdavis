#!/usr/bin/env bash
# Builds the two browser copies from index.html (the Artifact source, which has no <html>/<head> of its own).
#   standalone.html : open straight from disk in any browser
#   site/index.html : static site for public hosting (adds link-preview tags, kept out of search engines)
set -euo pipefail
cd "$(dirname "$0")"
# The public copy serves three.js (r128, MIT) and OrbitControls from site/vendor, because some managed networks block the CDNs.
# standalone.html and the Artifact keep the CDN links.
# The public copy also counts visits with Vercel Web Analytics (served from this site's own address). It is added here and nowhere else, because the
# /_vercel/insights/* routes exist only on that deployment, and only after the project's Analytics switch is on. The first script is a queue, so
# clicks made before the second one loads are kept. Browsers that send Do Not Track or Global Privacy Control are not counted.
# index.html calls track() for the events; where this snippet is absent (Claude, standalone.html) those calls do nothing.
ANALYTICS='<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};window.va("beforeSend",function(e){return navigator.doNotTrack==="1"||navigator.globalPrivacyControl?null:e})</script>
<script defer src="/_vercel/insights/script.js"></script>'
# The footer says so, on the public copy only (the placeholder in index.html is an HTML comment everywhere else).
# It makes no claim about cookies: Vercel describes the product as cookie-free (a daily hash instead), but its docs only name third-party cookies, so that is not ours to promise.
COUNT_NOTE=' This page counts visits and clicks, and skips browsers that send Do Not Track or Global Privacy Control. Nothing you type into the page is recorded.'
# sed treats & # \ specially in a replacement, so escape them: the sentence can then be edited freely.
NOTE_SED=$(printf '%s' "$COUNT_NOTE" | sed -e 's/[&#\\]/\\&/g')
SELF_HOSTED() { sed -e 's#https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js#/vendor/three.min.js#' -e 's#https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js#/vendor/OrbitControls.js#' -e "s#<!--COUNT_NOTE-->#${NOTE_SED}#" index.html; }
DESC="Make the call at nine incidents on the National Mall. A free, fictional tabletop exercise built with AI. Real places, invented incidents. Not an operational tool."
SITE_URL="https://america250-mall-ops.vercel.app/"
OG_TITLE="America 250 · National Mall exercise (fictional)"
# Link-preview card (1200x627): a rendered image served from the site itself, so it never depends on a third-party CDN.
OG_IMG="${SITE_URL}og.jpg"
OG_ALT="America 250, National Mall: a fictional tabletop exercise. A 3D model of the Mall with a crowd shown by density, beside the title."
HEAD='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:dark}body{margin:0}img{max-width:100%}</style>'
{ printf '<!doctype html>\n<html lang="en"><head>%s</head><body>\n' "$HEAD"; cat index.html; printf '\n</body></html>\n'; } > standalone.html
mkdir -p site
# The public copy is built in a temp file and checked before it replaces site/index.html. A page that ships the counting script without its
# footer sentence, or a half-written page, must never be left in site/.
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
{ printf '<!doctype html>\n<html lang="en"><head>%s\n' "$HEAD"
  printf '<meta name="description" content="%s">\n<meta name="robots" content="noindex">\n' "$DESC"
  # No og:url on purpose. LinkedIn may treat it as the canonical address and send card clicks there, which would drop the ?utm_source tag from a tagged link.
  printf '<meta property="og:type" content="website">\n<meta property="og:site_name" content="Ad Astra AI">\n<meta property="og:title" content="%s">\n<meta property="og:description" content="%s">\n' "$OG_TITLE" "$DESC"
  printf '<meta property="og:image" content="%s">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="627">\n<meta property="og:image:alt" content="%s">\n' "$OG_IMG" "$OG_ALT"
  printf '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="%s">\n<meta name="twitter:description" content="%s">\n<meta name="twitter:image" content="%s">\n' "$OG_TITLE" "$DESC" "$OG_IMG"
  printf '%s\n' "$ANALYTICS"
  printf '</head><body>\n'; SELF_HOSTED; printf '\n</body></html>\n'; } > "$TMP"
# Counting and its disclosure ship together or not at all. (grep -F with an empty pattern matches everything, so an empty sentence has to be refused here.)
if [ -n "$ANALYTICS" ] && [ -z "$COUNT_NOTE" ]; then
  echo "build.sh: ANALYTICS is set but COUNT_NOTE is empty, so the page would count visits without saying so. Set both or clear both. site/index.html was left as it was." >&2
  exit 1
fi
if [ -z "$ANALYTICS" ] && [ -n "$COUNT_NOTE" ]; then
  echo "build.sh: COUNT_NOTE is set but ANALYTICS is empty, so the footer would claim counting that is not happening. Set both or clear both. site/index.html was left as it was." >&2
  exit 1
fi
# This checks that the sentence is in the page, not that it is visible there.
if [ -n "$COUNT_NOTE" ] && ! grep -qF -- "$COUNT_NOTE" "$TMP"; then
  echo "build.sh: the footer sentence is missing from the public copy. Is <!--COUNT_NOTE--> still in index.html? site/index.html was left as it was." >&2
  exit 1
fi
chmod 644 "$TMP"; mv "$TMP" site/index.html
echo "built standalone.html and site/index.html"

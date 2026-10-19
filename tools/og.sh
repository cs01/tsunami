#!/bin/sh
# Renders the share thumbnails into app/public/ with headless Chrome.
set -e
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for page in tsunami quakes; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1200,630 --virtual-time-budget=4000 \
    --screenshot="$PWD/app/public/og-$page.png" "file://$PWD/tools/og-card.html#$page" 2>/dev/null
done
ls -la app/public/og-*.png

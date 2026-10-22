#!/bin/sh
# Fetches the exact Inter v20 files that @remotion/google-fonts loads for
# packages/video/src/fonts.ts (latin + latin-ext, normal + italic; one variable
# font per subset serves every weight), and decompresses them to TTF.
set -eu
cd "$(dirname "$0")"
mkdir -p fonts
REPO=$(cd ../.. && pwd)
node -e '
const info = require(process.argv[1]).getInfo();
for (const style of ["normal", "italic"])
  for (const subset of ["latin", "latin-ext"])
    console.log(`${style}-${subset} ${info.fonts[style]["500"][subset]}`);
' "$REPO/packages/video/node_modules/@remotion/google-fonts/dist/cjs/Inter.js" | while read -r name url; do
  curl -sSfL "$url" -o "fonts/inter-$name.woff2"
  uvx --quiet --from 'fonttools[woff]' fonttools ttLib.woff2 decompress -o "fonts/inter-$name.ttf" "fonts/inter-$name.woff2"
  rm "fonts/inter-$name.woff2"
done
ls fonts

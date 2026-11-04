#!/bin/sh
# 브라우저 테스트용 번들을 만든다 (Next 없이 같은 소스를 esbuild 로 묶음)
# 사용: sh test/build-harness.sh   → test/out/web/
set -e
cd "$(dirname "$0")/.."
mkdir -p test/out/web
ESB="${ESBUILD:-esbuild}"
$ESB test/harness.tsx --bundle --outfile=test/out/web/bundle.js --jsx=automatic --alias:@=./src --external:ag-psd --define:process.env.NODE_ENV=\"production\" --minify --log-level=warning
cp src/app/globals.css test/out/web/globals.css
cp test/web/index.html test/out/web/index.html
rm -rf test/out/web/materials && cp -r public/materials test/out/web/materials

#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "Node.js isn't installed. Get it from https://nodejs.org (the LTS button), install it, then double-click this again."
  read -n 1 -s -r -p "Press any key to close"; exit 1
fi
[ -d node_modules/electron/dist ] || npm install
npm start

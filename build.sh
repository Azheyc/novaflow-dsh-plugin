#!/usr/bin/env bash
set -euo pipefail
# Run from the package directory. npm uses package.json's actual version and files list.
node --check index.js
node --check client.js
node --test test/client-contract.test.js test/plugin-install-flow.test.js
npm pack --ignore-scripts

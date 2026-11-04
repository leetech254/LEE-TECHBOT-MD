'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { TMP_DIR } = require('./lib/runtime');

const removableDirs = [TMP_DIR, path.join(os.tmpdir(), 'lee-techbot-tmp')];
for (const directory of removableDirs) {
  fs.mkdirSync(directory, { recursive: true });
  for (const entry of fs.readdirSync(directory)) {
    const target = path.join(directory, entry);
    fs.rmSync(target, { recursive: true, force: true });
  }
  console.log(`Cleaned runtime directory: ${directory}`);
}

console.log('Cleanup complete; authentication and persistent data were preserved.');

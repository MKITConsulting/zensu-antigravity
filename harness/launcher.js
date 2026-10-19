#!/usr/bin/env node
'use strict';
// The host adapter owns process arguments and metadata; the contract stays here.
require('../hooks/antigravity/worker-runtime.js').launch(process.argv.slice(2))
  .then(code => { process.exitCode = code; }, error => {
    process.stderr.write(`zensu launcher: ${error.message}\n`); process.exitCode = 2;
  });

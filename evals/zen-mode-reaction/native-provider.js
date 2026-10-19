#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function options(argv) {
  for (const raw of [argv[4], argv[3]]) {
    try { const data=JSON.parse(raw); if (data && data.vars && typeof data.vars.spec_block==='string') return data.vars; } catch {}
  }
  throw new Error('Missing scenario spec_block');
}
function adapt(result) {
  if (!result || result.kind!=='live' || result.skipped || result.unavailable || result.error || result.exit_code!==0
      || typeof result.stdout!=='string' || !result.stdout.trim()) return 'LIVE-UNAVAILABLE no successful nonempty native model response';
  if (/LIVE-(SKIPPED|UNAVAILABLE|INCONCLUSIVE)/.test(result.stdout)) return 'LIVE-UNAVAILABLE native probe was not verified';
  return `[native_verified_prose]\n[assistant_text]\n${result.stdout.trim()}\n[wrapper_attestation]\nNative response observed; tool-execution absence is not attested.`;
}
function main() {
  if (process.env.ZENSU_LIVE_AGY!=='1') { process.stdout.write('LIVE-SKIPPED ZENSU_LIVE_AGY is not 1'); return; }
  try {
    const vars=options(process.argv);
    const provider=path.resolve(__dirname,'../promptfoo/lib/agy-live-provider.js');
    const child=spawnSync(process.execPath,[provider,'native-zen','{}',JSON.stringify({vars:{probe:'prompt',prompt:vars.spec_block,timeout_s:120}})],
      {encoding:'utf8',timeout:155000,maxBuffer:4*1024*1024,env:process.env});
    if (child.status!==0 || child.error) throw new Error('Native prompt transport failed');
    process.stdout.write(adapt(JSON.parse(child.stdout)));
  } catch (error) { process.stdout.write(`LIVE-UNAVAILABLE ${error.message}`); }
}
module.exports={options,adapt};
if (require.main===module) main();

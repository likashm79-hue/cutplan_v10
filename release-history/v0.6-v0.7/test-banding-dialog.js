'use strict';
const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('index.html', 'utf8');
const checks = [
  ['dedicated dialog exists', /<dialog id="bandingDialog"/.test(html)],
  ['prominent edge-banding launcher exists', /id="openBanding"[^>]*>⛶ Open Edge Banding/.test(html)],
  ['explicit close button exists', /id="closeBanding"/.test(html)],
  ['Escape/native close handling exists', /bandingDialog\.addEventListener\('close'/.test(html)],
  ['guided progress indicator exists', /id="bandingProgress"/.test(html) && /id="bandingProgressFill"/.test(html)],
  ['current part reference and dimensions visible', /id="bandingCurrentRef"/.test(html) && /id="bandingCurrentDims"/.test(html)],
  ['Previous and Next navigation exist', /id="bandingPrev"/.test(html) && /id="bandingNext"/.test(html)],
  ['reference dropdown removed from guided workflow', !/id="bandingPart"/.test(html)],
  ['0.8 mm length and width inputs exist', /id="band08Length"/.test(html) && /id="band08Width"/.test(html)],
  ['2 mm length and width inputs exist', /id="band2Length"/.test(html) && /id="band2Width"/.test(html)],
  ['full-screen dialog uses viewport dimensions', /\.banding-dialog\{position:fixed;inset:0;width:100vw;height:100dvh/.test(html)],
  ['edge-banding inputs are outside cutting-list table', !/<th[^>]*>ED/i.test(html) && !/<td[^>]*>\s*<input[^>]+data-k="band/.test(html)],
  ['input values save on typing', /addEventListener\('input',\s*\(\)\s*=>\s*saveBandingEditor\(\{silent:true\}\)\)/.test(html)],
  ['navigation saves before moving', /function moveBandingPart\(direction\)[\s\S]*?if \(!saveBandingEditor\(\)\) return/.test(html)],
];
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  assert.ok(ok, name);
}
console.log(`All ${checks.length} guided edge-banding structural tests passed.`);

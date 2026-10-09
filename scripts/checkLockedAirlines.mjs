// Working-carrier freeze requested 2026-10-08.
// Change these hashes ONLY after the owner explicitly approves unlocking
// Saudia (065), Emirates (176), Cathay Pacific (160), or Ethiopian (071).
// Cathay's reusable, AWB-matched dated flight ETA extraction is protected here.
// Other airlines' parsers remain editable. No airline parser is modified by this check.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const locked = Object.freeze({
  'lib/ethiopian.js':'2a0a98c04d3923b0f79cff63a8ecbf306f7e4ab1',
  'lib/cathay.js':'4d7019c1d75cab806c1adeb0172272f56bdf083c',
  'lib/cathay-browser-fallback.js':'abfa9bdc5a37084e0410325f1aeb395b9c3622ca',
  'lib/emirates.js':'f41f225840527faca5adb33745b16d4b280e4abe',
  'lib/emiratesFast.js':'fcc0ac0320c69617d7983ea9e791210bf6b1777a',
  'lib/saudiaDirect.js':'cf70796f383793531541f72ed48add3e05fbdda4',
  'lib/saudiaStrong.js':'d24fecbc68d30fa76f142db9d13401a6feb86e68',
  'lib/saudiaSalPublic.js':'9c55a2fc495706ab8fc799800a0d29b48a1b316c',
  'lib/saudia.js':'db7739b0860ad49ac762fded8b82654e6c05ff31',
  'lib/saudiaSal.js':'3e6ee3646ae3b67833d3c379af2b85ffab999fda'
});
let changed=false;
for (const [filename,expected] of Object.entries(locked)){
  try{
    const data=readFileSync(filename);
    const head=Buffer.from(`blob ${data.byteLength}\0`);
    const actual=createHash('sha1').update(head).update(data).digest('hex');
    if(actual!==expected){
      console.error(`LOCKED AIRLINE FILE MODIFIED: ${filename}. Explicit unlock approval required.`);
      changed=true;
    }
  }catch(err){console.error(`LOCKED AIRLINE FILE UNREADABLE: ${filename}: ${err.message}`);changed=true;}
}
// Cathay relies on a shared track route which also contains other airlines.
 // Avoid freezing the whole shared route; guard only the Cathay integration
 // contract, so KLM/other fixes may still be deployed independently.
const sharedRoute=readFileSync('app/api/track/route.js','utf8');
const cathayRouteContract=[
  ["Cathay official adapter import","import { trackCathay } from '../../../lib/cathay.js';"],
  ["Cathay dedicated 160 tracking","if(mawb.startsWith('160-')) return trackCathay(mawb);"],
  ["Cathay prefix fast path","const cathayFastPath=mawb.startsWith('160-');"],
  ["Cathay shared persistence","airIndiaFastPath||qatarFastPath||cathayFastPath||malaysiaFastPath"],
  ["Cathay saved-row eligibility","mawb.startsWith('074-')||mawb.startsWith('160-')||mawb.startsWith('098-')"]
];
for(const [label,fragment] of cathayRouteContract){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED CATHAY INTEGRATION CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
// Ethiopian 071 is locked without freezing the shared multi-airline route.
// These invariants block accidental removal of official tracking, estimated
// final-flight ETA, no-OCR policy and server persistence on later KLM updates.
const ethiopianRouteContract=[
  ["Ethiopian official adapter import","import { trackEthiopian } from '../../../lib/ethiopian.js';"],
  ["Ethiopian dedicated 071 tracking","if(mawb.startsWith('071-')) return trackEthiopian(mawb);"],
  ["Ethiopian fast path","const ethiopianFastPath=mawb.startsWith('071-');"],
  ["Ethiopian official-only source","const skipGenericApi=ethiopianFastPath||klmFastPath||"],
  ["Ethiopian skip OCR","const skipGenericOcr=mawb.startsWith('071-')||mawb.startsWith('074-')"],
  ["Ethiopian AWB live verification","const hasUseful=ethiopianFastPath"],
  ["Ethiopian saved row eligibility","mawb.startsWith('071-')||mawb.startsWith('074-')||"],
  ["Ethiopian persistence","||klmFastPath||ethiopianFastPath||virginFastPath"]
];
for(const [label,fragment] of ethiopianRouteContract){
  if(!sharedRoute.includes(fragment)){
    console.error('LOCKED ETHIOPIAN INTEGRATION CHANGED: '+label+'. Explicit unlock approval required.');
    changed=true;
  }
}
if(changed)process.exit(1);
console.log('Airline lock check passed: Saudia (065), Emirates (176), Cathay Pacific (160), and Ethiopian (071).');

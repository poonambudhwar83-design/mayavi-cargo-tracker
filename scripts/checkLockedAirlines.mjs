// Working-carrier freeze requested 2026-10-08.
// Change these hashes ONLY after the owner explicitly approves unlocking
// Saudia (065) or Emirates (176). No carrier parser is modified by this check.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const locked = Object.freeze({
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
if(changed)process.exit(1);
console.log('Airline lock check passed: Saudia (065) and Emirates (176) sources unchanged.');

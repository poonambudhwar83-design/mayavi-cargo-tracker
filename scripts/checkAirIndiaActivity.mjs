import assert from 'node:assert/strict';
import { extractActivityMaster } from '../lib/airIndia.js';

const book='AWB Activity Timeline\nBOOKED Booked 19 pcs 1,002 kg at DEL for AI 187, 18 Oct 2026\nDEL • 17 Oct 2026, 18:30';
const correct=extractActivityMaster(book,{pieces:'17',bags:'17',weight:'985'});
assert.equal(correct?.pieces,'19');
assert.equal(correct?.bags,'19');
assert.equal(correct?.weight,'1002');
assert.equal(correct?.weightSource,'Air India AWB Activity View master milestone');

const fow='AWB Activity Timeline\nFREIGHT ON HAND Freight on hand 19 pcs 1,002.5 kg\nDEL • 17 Oct 2026, 16:40';
assert.equal(extractActivityMaster(fow,{pieces:'19',weight:'1002'})?.weight,'1002.5');
assert.equal(extractActivityMaster(fow,{pieces:'19',weight:'1002'})?.masterPieces,'19');

const split='AWB Activity Timeline\nBOOKED Booked 20 pcs 600 kg at DEL for AI 187, 18 Oct 2026\nBOOKED Booked 13 pcs 390 kg at DEL for AI 190, 19 Oct 2026';
assert.equal(extractActivityMaster(split,{pieces:'33',weight:'990'}),null,
  'Two individual part-bookings must not replace the 33-piece master');

const part='AWB Activity Timeline\nBOOKED Booked 20 pcs 600 kg at DEL for AI 187, 18 Oct 2026';
assert.equal(extractActivityMaster(part,{pieces:'33',weight:'990'}),null,
  'A single partial milestone must not replace a larger known master');

const arrival='AWB Activity Timeline\nARRIVAL Arrived 20 pcs 600 kg on AI187, 18 Oct 2026 12:30 (A) at DEL';
assert.equal(extractActivityMaster(arrival,{pieces:'33',weight:'990'}),null,
  'Movement quantity alone is not a verified master quantity');

assert.equal(extractActivityMaster('Tracking View: 19 pcs 1002 kg',{pieces:'19'}),null,
  'A hidden or unopened Activity View is not proof of activity totals');

const total='AWB Activity Timeline\nBOOKED Booked 33 pcs 990 kg at DEL for AI 187, 18 Oct 2026\nMANIFESTED Manifested 20 pcs 600 kg for AI187, 18 Oct 2026 at DEL';
assert.equal(extractActivityMaster(total,{pieces:'33',weight:'960'})?.weight,'990');
console.log('Air India Activity View quantity tests passed: master, FOW, split, part and hidden view.');

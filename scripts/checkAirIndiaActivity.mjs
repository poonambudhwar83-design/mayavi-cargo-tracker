import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: the live tab uses \s and \b once, not escaped literals.
// Otherwise the crawler misses hydrated milestones and may read stale summary data.
const adapterSource=readFileSync(new URL('../lib/airIndia.js',import.meta.url),'utf8');
assert.ok(adapterSource.includes(String.raw`current.search(/AWB\s+Activity\s+Timeline/i)`),
  'Activity View must detect the hydrated timeline heading');
assert.ok(adapterSource.includes(String.raw`timeline.match(/\b(?:FREIGHT\s+ON\s+HAND|FOW|BOOKED\s+Booked|DEPARTURE\s+Departed|ARRIVAL\s+Arrived|MANIFESTED\s+Manifested)\b/gi)`),
  'Activity View must detect new FOW and movement milestones');
assert.ok(!adapterSource.includes(String.raw`current.search(/AWB\\s+Activity\\s+Timeline/i)`),
  'Escaped literal \\s would break timeline hydration detection');

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
// A preliminary Tracking View can show 40 pcs / 800 kg while a verified FOW
// event records 36 pcs / 764 kg. Always prefer Activity View FOW.
const corrected=extractActivityMaster(
  'AWB Activity Timeline\nBOOKED Booked 40 pcs 800 kg at DEL for AI190, 18 Oct 2026\nFREIGHT ON HAND Freight on hand 36 pcs 764 kg',
  {pieces:'40',bags:'40',weight:'800'});
assert.equal(corrected?.pieces,'36');
assert.equal(corrected?.bags,'36');
assert.equal(corrected?.weight,'764');
assert.equal(corrected?.activityQuantitySource,'FOW');
// Duplicate FOW milestones are not separate loads.
assert.equal(extractActivityMaster(
  'AWB Activity Timeline\nFREIGHT ON HAND Freight on hand 36 pcs 764 kg\nFOW Freight on hand 36 pcs 764 kg',
  {pieces:'40',weight:'800'})?.pieces,'36');
// Multiple different partial FOW milestones are ambiguous; do not sum or
// replace a master shipment without a verified total.
assert.equal(extractActivityMaster(
  'AWB Activity Timeline\nFOW Freight on hand 20 pcs 400 kg\nFOW Freight on hand 16 pcs 364 kg',
  {pieces:'40',weight:'800'}),null);

console.log('Air India Activity View quantity tests passed: master, FOW, split, part and hidden view.');

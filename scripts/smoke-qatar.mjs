import { trackOfficial } from '../lib/official-tracker.js';

const exampleMawb = '157-10631913';
const result = await trackOfficial(exampleMawb);

const summary = {
  ok: result.ok,
  technical: result.technical || false,
  notFound: result.notFound || false,
  reason: result.reason || '',
  stage: result.debug?.stage || '',
  frames: result.debug?.frames || 0,
  submit: result.debug?.submit || null,
  airline: result.airline?.name || ''
};

console.log(JSON.stringify(summary, null, 2));

const formWorked = result.ok || result.notFound || result.debug?.stage === 'OFFICIAL_RESULT_UNREADABLE';
if (!formWorked) process.exit(1);

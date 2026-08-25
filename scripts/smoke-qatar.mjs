import { trackQatar } from '../lib/adapters/qatar.js';

// Public format-valid example only; no customer shipment is exposed in CI logs.
const result = await trackQatar('157-10631913');

const summary = {
  ok: result.ok,
  technical: result.technical || false,
  notFound: result.notFound || false,
  reason: result.reason || '',
  stage: result.debug?.stage || '',
  submit: result.debug?.submit || null,
  airline: result.airline?.name || ''
};

console.log(JSON.stringify(summary, null, 2));

// Success here means the real Qatar form was found, populated and submitted.
// A fake example can legitimately return no record; that still proves the browser flow works.
const submitted = result.ok || result.notFound || ['QATAR_RESULT_UNREADABLE', 'QATAR_SUCCESS', 'QATAR_NO_RECORD'].includes(result.debug?.stage);
if (!submitted) process.exit(1);

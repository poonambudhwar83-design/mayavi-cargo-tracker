import { trackQatarLive } from '../lib/adapters/qatar-live.js';

// Public format-valid example only; no customer shipment is exposed in CI logs.
const result = await trackQatarLive('157-12345675');

const summary = {
  ok: result.ok,
  technical: result.technical || false,
  notFound: result.notFound || false,
  reason: result.reason || '',
  stage: result.debug?.stage || '',
  networkResponses: result.debug?.networkResponses ?? 0,
  submit: result.debug?.submit || null,
  airline: result.airline?.name || ''
};

console.log('QATAR_SMOKE_RESULT=' + JSON.stringify(summary));

// Passing means the official Qatar page opened, accepted the form flow, and produced
// either a normal no-record result or a machine-readable shipment result.
if (['QATAR_BROWSER_ERROR', 'QATAR_FORM_FAILED', 'QATAR_RESULT_UNREADABLE'].includes(summary.stage)) {
  process.exit(1);
}

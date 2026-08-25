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

const submit = result.debug?.submit;
const formReallySubmitted = Boolean(
  submit?.ok &&
  submit?.serialLength === 8 &&
  /Track Shipment/i.test(String(submit?.button || ''))
);

if (!formReallySubmitted) process.exit(1);

import { trackQatarLive } from '../lib/adapters/qatar-live.js';

// Public format-valid example only; no customer shipment is exposed in CI logs.
const result = await trackQatarLive('157-12345675');

const shipment = result.shipment || {};
const summary = {
  ok: result.ok,
  technical: result.technical || false,
  notFound: result.notFound || false,
  reason: result.reason || '',
  stage: result.debug?.stage || '',
  networkResponses: result.debug?.networkResponses ?? 0,
  submit: result.debug?.submit || null,
  airline: result.airline?.name || '',
  extracted: {
    origin: shipment.origin || '',
    destination: shipment.destination || '',
    pieces: shipment.pieces || '',
    weight: shipment.weight || '',
    flightNo: shipment.flightNo || '',
    arrivalDate: shipment.arrivalDate || '',
    arrivalTime: shipment.arrivalTime || '',
    status: shipment.status || '',
    source: shipment.source || ''
  }
};

console.log('QATAR_SMOKE_RESULT=' + JSON.stringify(summary));

if (['QATAR_BROWSER_ERROR', 'QATAR_FORM_FAILED', 'QATAR_RESULT_UNREADABLE'].includes(summary.stage)) {
  process.exit(1);
}

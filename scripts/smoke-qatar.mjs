import { trackQatarLiveV2 } from '../lib/adapters/qatar-live-v2.js';

// Public historical Qatar shipment used only to verify the official-site parser.
const result = await trackQatarLiveV2('157-12345675');
const shipment = result.shipment || {};

const summary = {
  ok: result.ok,
  technical: result.technical || false,
  notFound: result.notFound || false,
  reason: result.reason || '',
  stage: result.debug?.stage || '',
  networkResponses: result.debug?.networkResponses ?? 0,
  submit: result.debug?.submit || null,
  extracted: {
    origin: shipment.origin || '',
    destination: shipment.destination || '',
    pieces: shipment.pieces || '',
    weight: shipment.weight || '',
    flightNo: shipment.flightNo || '',
    arrivalDate: shipment.arrivalDate || '',
    arrivalTime: shipment.arrivalTime || '',
    arrivalIsActual: shipment.arrivalIsActual || false,
    status: shipment.status || ''
  }
};

console.log('QATAR_V2_SMOKE=' + JSON.stringify(summary));

const expected = summary.ok &&
  summary.stage === 'QATAR_SUCCESS_NETWORK' &&
  summary.extracted.origin === 'HAN' &&
  summary.extracted.destination === 'DFW' &&
  summary.extracted.pieces === '13' &&
  summary.extracted.weight === '4559.0' &&
  summary.extracted.flightNo === 'QR0729' &&
  summary.extracted.arrivalDate === '2021-05-18' &&
  summary.extracted.arrivalTime === '15:22' &&
  summary.extracted.status === 'DELIVERED';

if (!expected) process.exit(1);

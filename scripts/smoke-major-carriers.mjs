import { trackExactOfficial } from '../lib/adapters/exact-official.js';

const cases = [
  ['Saudia Cargo', '065-12345675'],
  ['Emirates SkyCargo', '176-12345675'],
  ['Air India Cargo', '098-12345675']
];

let failed = false;
for (const [name, mawb] of cases) {
  const result = await trackExactOfficial(mawb);
  const summary = {
    carrier: name,
    ok: result.ok,
    technical: result.technical || false,
    notFound: result.notFound || false,
    reason: result.reason || '',
    stage: result.debug?.stage || '',
    submitted: result.debug?.submitted ?? null,
    networkResponses: result.debug?.networkResponses ?? 0,
    shipment: result.shipment ? {
      origin: result.shipment.origin || '',
      destination: result.shipment.destination || '',
      pieces: result.shipment.pieces || '',
      weight: result.shipment.weight || '',
      flightNo: result.shipment.flightNo || '',
      arrivalDate: result.shipment.arrivalDate || '',
      arrivalTime: result.shipment.arrivalTime || '',
      status: result.shipment.status || ''
    } : null
  };
  console.log('CARRIER_SMOKE=' + JSON.stringify(summary));

  // Browser/form failures are real adapter failures. A clean no-record response is acceptable
  // for these public format-valid examples.
  if (['EXACT_BROWSER_ERROR', 'EXACT_FORM_NOT_FOUND', 'EXACT_RESULT_UNREADABLE'].includes(summary.stage)) failed = true;
}

if (failed) process.exit(1);

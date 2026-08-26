import { trackQatarLive } from '../lib/adapters/qatar-live.js';

const result = await trackQatarLive('157-00000000');
const summary = {
  ok: result.ok,
  notFound: Boolean(result.notFound),
  reason: result.reason || '',
  stage: result.debug?.stage || '',
  submit: result.debug?.submit || null,
  networkResponses: result.debug?.networkResponses ?? null
};
console.log('QATAR_PRODUCTION_ADAPTER=' + JSON.stringify(summary));

// A dummy but format-valid MAWB should be successfully submitted to Qatar and
// reach Qatar's own "no record" result. That proves the production adapter can
// enter the AWB token, click Track Shipment(s), and read the official response.
if (!(result.notFound && result.debug?.stage === 'QATAR_NO_RECORD')) {
  process.exitCode = 2;
}

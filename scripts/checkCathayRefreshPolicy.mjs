import assert from 'node:assert/strict';
import { cathayRefreshDecision, CX_ACTIVE_ARRIVED_RETRY_MS, CX_FAILED_RETRY_MS } from '../lib/cathayRefreshPolicy.js';
const now=Date.parse('2026-11-10T08:00:00Z');
const settled={status:'ARRIVED',flightNo:'CX695',arrivalDate:'2026-11-06',arrivalTime:'21:19',arrivalIsActual:true};
assert.equal(CX_ACTIVE_ARRIVED_RETRY_MS,300000);
assert.equal(cathayRefreshDecision(settled,'ACTIVE',now,new Date(now-6*60000).toISOString()).due,true);
assert.equal(cathayRefreshDecision(settled,'ACTIVE',now,new Date(now-2*60000).toISOString()).due,false);
assert.equal(cathayRefreshDecision(settled,'SKIP',now,new Date(now-6*60000).toISOString()).due,false);
assert.equal(cathayRefreshDecision({status:'BOOKED',flightNo:'',arrivalDate:'',arrivalTime:''},'ACTIVE',now,new Date(now).toISOString()).due,true);
assert.equal(CX_FAILED_RETRY_MS,3600000);
const failed={status:'BOOKED',flightNo:'',arrivalDate:'',arrivalTime:'',
  trackingError:'CATHAY TERMINAL DATA NOT AVAILABLE'};
assert.equal(cathayRefreshDecision(failed,'ACTIVE',now,new Date(now-5*60000).toISOString()).due,false);
assert.equal(cathayRefreshDecision(failed,'ACTIVE',now,new Date(now-61*60000).toISOString()).due,true);
const recentlyFailed={...failed,cxAutoLastError:'CATHAY TERMINAL DATA NOT AVAILABLE',
  cxAutoAttemptAt:new Date(now-5*60000).toISOString()};
assert.equal(cathayRefreshDecision(recentlyFailed,'ACTIVE',now,new Date(now-200*60000).toISOString()).due,false);
assert.equal(cathayRefreshDecision(recentlyFailed,'ACTIVE',now,new Date(now-200*60000).toISOString()).gap,CX_FAILED_RETRY_MS);
console.log('CX active polling cadence, first booking and failed-AWB hourly cooldown passed.');

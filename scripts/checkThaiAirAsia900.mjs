import assert from 'node:assert/strict';
import { airlineForMawb } from '../lib/airlines.js';
import { parseAirAsiaResult, trackAirAsia } from '../lib/airAsia.js';

// Synthetic AWB-specific SmartKargo results; never calls external systems.
function fixture(prefix,serial='12345675',station='DEL'){
  return '<section>AWB : '+prefix+'-'+serial+' ( BKK - DEL ) 12 P / 200.00 Kgs.</section>'
    +'<table><tr><td>Arrived</td><td>'+station+'</td><td>27/10/2026 17:29</td></tr></table>'
    +'<div>Last Activity Arrived at '+station+'</div>';
}
assert.equal(airlineForMawb('900-12345675')?.iata,'FD');
assert.equal(airlineForMawb('807-12345675')?.iata,'AK');
assert.equal(airlineForMawb('217-12345675')?.iata,'TG');
const thai=parseAirAsiaResult(fixture('900'),'900-12345675');
assert.ok(thai,'Thai AirAsia result must parse');
assert.equal(thai.carrierCode,'FD');
assert.equal(thai.airlineName,'Thai AirAsia Cargo / Teleport');
assert.equal(thai.status,'ARRIVED');
assert.equal(thai.arrivalIsActual,true);
assert.equal(thai.arrivalDate,'2026-10-27');
assert.equal(thai.arrivalTime,'17:29');
assert.equal(thai.weight,'200.00');
assert.equal(thai.pieces,'12');
assert.equal(parseAirAsiaResult(fixture('807'),'900-12345675'),null,'Never accept 807 card for 900 AWB');
assert.equal(parseAirAsiaResult(fixture('900'),'807-12345675'),null,'Never accept 900 card for 807 AWB');
assert.equal(parseAirAsiaResult(fixture('900','12345676'),'900-12345675'),null,'Never accept another serial');
assert.equal(parseAirAsiaResult(fixture('900','12345675','BKK'),'900-12345675')?.arrivalIsActual,false,'Transit cannot confirm final DEL arrival');
assert.equal(parseAirAsiaResult(fixture('807'),'807-12345675')?.carrierCode,'AK','807 parser must remain working');


function transitFixture(finalArrived=false){
  return '<section>AWB : 900-15927424 (HAN-DEL) 19 P / 564.00 Kgs.</section>'
    +'<div>Last Activity Arrived at '+(finalArrived?'DEL':'DMK')+'</div>'
    +'<table><tr><th>Status</th><th>Station</th><th>Dest</th></tr>'
    +'<tr><td>Booked</td><td>HAN</td><td>DMK</td><td>19</td><td>564.00 Kgs</td><td>FD641 29/10/2026 12:20</td><td>19/10/2026 15:16</td></tr>'
    +'<tr><td>Booked</td><td>DMK</td><td>DEL</td><td>19</td><td>564.00 Kgs</td><td>XJ230 31/10/2026 15:16</td><td>19/10/2026 15:16</td></tr></table>'
    +'<table><tr><th>Station</th><th>Milestone</th><th>Pcs</th><th>Weight</th><th>Flight</th><th>Flight Date</th><th>Org</th><th>Dst</th></tr>'
    +'<tr><td>HAN</td><td>Departed</td><td>19</td><td>564.00 Kgs</td><td>FD641</td><td>29/10/2026 12:20</td><td>HAN</td><td>DMK</td></tr>'
    +'<tr><td>DMK</td><td>Arrived</td><td>19</td><td>564.00 Kgs</td><td>FD641</td><td>29/10/2026 14:15</td><td>HAN</td><td>DMK</td></tr>'
    +(finalArrived?'<tr><td>DEL</td><td>Arrived</td><td>19</td><td>564.00 Kgs</td><td>XJ230</td><td>31/10/2026 19:40</td><td>DMK</td><td>DEL</td></tr>':'')
    +'</table>';
}
const dmK= parseAirAsiaResult(transitFixture(), '900-15927424');
assert.ok(dmK);
assert.equal(dmK.destination,'DEL');
assert.equal(dmK.currentLocation,'DMK');
assert.equal(dmK.transitAirport,'DMK');
assert.equal(dmK.status,'IN TRANSIT');
assert.equal(dmK.arrivalIsActual,false);
assert.equal(dmK.arrivalVerifiedAbsent,true);
assert.equal(dmK.arrivalDate,'');
assert.equal(dmK.arrivalTime,'');
assert.equal(dmK.flightDate,'2026-10-31');
assert.equal(dmK.finalFlightNo,'XJ230');
assert.equal(dmK.departureIsActual,true);
const arrivedAtDel=parseAirAsiaResult(transitFixture(true),'900-15927424');
assert.equal(arrivedAtDel.status,'ARRIVED');
assert.equal(arrivedAtDel.arrivalVerifiedAbsent,false);
assert.equal(arrivedAtDel.arrivalDate,'2026-10-31');
assert.equal(arrivedAtDel.arrivalTime,'19:40');

// Exercise GET -> POST prefix/serial submission with a mocked SmartKargo page.
const originalFetch=globalThis.fetch;
const calls=[];
globalThis.fetch=async (_url,opts={})=>{
  calls.push(opts);
  const isPost=opts.method==='POST';
  return {
    ok:true,status:200,headers:{get:()=>''},
    text:async()=>isPost?fixture('900'):
      '<form><input type="hidden" name="__VIEWSTATE" value="test"/><input name="txtPrefix" id="txtPrefix"/><input name="TextBoxAWBno" id="TextBoxAWBno"/><input type="submit" name="ButtonGO" value="Track"/></form>'
  };
};
try{
  const response=await trackAirAsia('90012345675');
  assert.equal(response.ok,true);
  assert.equal(response.shipment.carrierCode,'FD');
  assert.equal(response.shipment.arrivalIsActual,true);
  assert.equal(calls.length,2);
  const form=new URLSearchParams(calls[1].body);
  assert.equal(form.get('txtPrefix'),'900');
  assert.equal(form.get('TextBoxAWBno'),'12345675');
}finally{
  globalThis.fetch=originalFetch;
}
console.log('Thai AirAsia 900 and AirAsia 807 regression checks passed');

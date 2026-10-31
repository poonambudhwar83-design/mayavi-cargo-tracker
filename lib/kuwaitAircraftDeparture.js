// Flight tracking and cargo uplift are separate milestones.
// A dated/route-verified aircraft departure can be displayed even while
// Kuwait Cargo still reports MAN / PRE for the AWB's physical pieces.
const norm=v=>String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const ymd=v=>(String(v||'').match(/20\d{2}-\d{2}-\d{2}/)||[])[0]||'';
export function markKuwaitAircraftDeparture(shipment={},flightRecord=null){
  if(!String(shipment.mawb||'').replace(/\D/g,'').startsWith('229'))return shipment;
  const flight=norm(shipment.flightNo),date=ymd(shipment.flightDate);
  if(!/^KU\d{2,4}$/.test(flight)||!date||
    norm(shipment.origin)!=='KWI'||norm(shipment.destination)!=='DEL')return shipment;
  const verified=Boolean(flightRecord?.ok===true&&flightRecord.departureIsActual===true
    &&ymd(flightRecord.departureDate)===date
    &&(!flightRecord.flightNo||norm(flightRecord.flightNo)===flight)
    &&(!flightRecord.departureOrigin||norm(flightRecord.departureOrigin)==='KWI')
    &&(!flightRecord.departureDestination||norm(flightRecord.departureDestination)==='DEL'));
  if(!verified)return shipment;
  const hasCargoDeparture=String(shipment.status||'').toUpperCase()==='IN TRANSIT'
    ||Array.isArray(shipment.partShipments)&&shipment.partShipments.some(p=>
      String(p.sourceStatus||'').toUpperCase()==='DEP');
  return {...shipment,
    kuwaitFlightDeparted:true,
    kuwaitFlightDepartureDate:date,
    kuwaitFlightDepartureTime:String(flightRecord.departureTime||''),
    kuwaitFlightDepartureSource:flightRecord.source||'Dated flight departure status',
    kuwaitCargoDepartureConfirmed:hasCargoDeparture,
    // Keep MAN/PRE shipment and part status unchanged until official cargo DEP.
    // A passenger aircraft taking off is not proof that the AWB was uplifted.
  };
}

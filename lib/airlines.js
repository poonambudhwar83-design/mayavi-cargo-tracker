export const AIRLINES = {
  '001': { name: 'American Airlines Cargo', iata: 'AA', url: 'https://www.aacargo.com/AACargo/tracking' },
  '006': { name: 'Delta Cargo', iata: 'DL', url: 'https://www.deltacargo.com/Cargo/catalog/products/track-shipment' },
  '014': { name: 'Air Canada Cargo', iata: 'AC', url: 'https://www.aircanada.com/cargo/en/tools-forms/track-and-trace/' },
  '016': { name: 'United Cargo', iata: 'UA', url: 'https://www.unitedcargo.com/en/us/track' },
  '020': { name: 'Lufthansa Cargo', iata: 'LH', url: 'https://www.lufthansa-cargo.com/en/eservices/etracking' },
  '023': { name: 'FedEx Express', iata: 'FX', url: 'https://www.fedex.com/en-us/tracking.html' },
  '057': { name: 'Air France KLM Martinair Cargo', iata: 'AF', url: 'https://www.afklcargo.com/' },
  '065': { name: 'Saudia Cargo', iata: 'SV', url: 'https://www.saudiacargo.com/e-services' },
  '071': { name: 'Ethiopian Cargo', iata: 'ET', url: 'https://cargo.ethiopianairlines.com/my-cargo/track-your-shipment' },
  '074': { name: 'KLM Cargo', iata: 'KL', url: 'https://www.afklcargo.com/' },
  '075': { name: 'Iberia Cargo', iata: 'IB', url: 'https://www.iagcargo.com/en/track/' },
  '081': { name: 'Qantas Freight', iata: 'QF', url: 'https://freight.qantas.com/' },
  '098': { name: 'Air India Cargo', iata: 'AI', url: 'https://cargo.airindia.com/in/en/track-shipment.html' },
  '105': { name: 'Finnair Cargo', iata: 'AY', url: 'https://cargo.finnair.com/' },
  '125': { name: 'British Airways / IAG Cargo', iata: 'BA', url: 'https://www.iagcargo.com/en/track/' },
  '131': { name: 'Japan Airlines Cargo', iata: 'JL', url: 'https://www.jal.co.jp/jalcargo/inter/track/' },
  '157': { name: 'Qatar Airways Cargo', iata: 'QR', url: 'https://www.qrcargo.com/s/track-your-shipment' },
  '160': { name: 'Cathay Cargo', iata: 'CX', url: 'https://www.cathaycargo.com/en-us/track-and-trace.html' },
  '176': { name: 'Emirates SkyCargo', iata: 'EK', url: 'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt' },
  '180': { name: 'Korean Air Cargo', iata: 'KE', url: 'https://cargo.koreanair.com/en/tracking' },
  '205': { name: 'ANA Cargo', iata: 'NH', url: 'https://www.anacargo.jp/en/int/airwaybill/' },
  '217': { name: 'Thai Airways Cargo', iata: 'TG', url: 'https://www.thaicargo.com/en/track-shipment' },
  '232': { name: 'Malaysia Airlines Cargo', iata: 'MH', url: 'https://www.maskargo.com/' },
  '235': { name: 'Turkish Cargo', iata: 'TK', url: 'https://turkishcargo.com/en/cargo-tracking' },
  '297': { name: 'China Airlines Cargo', iata: 'CI', url: 'https://cargo.china-airlines.com/ccnetv2/content/manage/ShipmentTracking.aspx' },
  '312': { name: 'IndiGo CarGo', iata: '6E', url: 'https://6ecargo.goindigo.in/FrmAWBTracking.aspx' },
  '406': { name: 'UPS Airlines', iata: '5X', url: 'https://www.ups.com/track' },
  '607': { name: 'Etihad Cargo', iata: 'EY', url: 'https://www.etihadcargo.com/' },
  '618': { name: 'Singapore Airlines Cargo', iata: 'SQ', url: 'https://www.siacargo.com/e-services/track-shipment' },
  '724': { name: 'SWISS WorldCargo', iata: 'LX', url: 'https://www.swissworldcargo.com/' },
  '988': { name: 'Asiana Cargo', iata: 'OZ', url: 'https://www.asiana-cargo.com/tracking/viewTraceAirWaybill.do' },
  '999': { name: 'Air China Cargo', iata: 'CA', url: 'https://www.airchinacargo.com/en/trackShipment' }
};

export function normalizeMawb(value = '') {
  const digits = String(value).replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : '';
}

export function airlineForMawb(mawb = '') {
  const prefix = String(mawb).replace(/\D/g, '').slice(0, 3);
  return AIRLINES[prefix] || null;
}
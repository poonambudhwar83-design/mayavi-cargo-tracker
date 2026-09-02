export const AIRLINES = {
  '001': { name: 'American Airlines Cargo', iata: 'AA', region: 'USA', url: 'https://www.aacargo.com/AACargo/tracking' },
  '006': { name: 'Delta Cargo', iata: 'DL', region: 'USA', url: 'https://www.deltacargo.com/Cargo/trackShipment' },
  '014': { name: 'Air Canada Cargo', iata: 'AC', region: 'Canada', url: 'https://www.aircanada.com/cargo/tracking?lang=en' },
  '016': { name: 'United Cargo', iata: 'UA', region: 'USA', url: 'https://www.unitedcargo.com/en/us/track' },
  '020': { name: 'Lufthansa Cargo', iata: 'LH', region: 'Germany', url: 'https://www.lufthansa-cargo.com/en/eservices/etracking' },
  '023': { name: 'FedEx Express', iata: 'FX', region: 'USA', url: 'https://www.fedex.com/en-us/tracking.html' },
  '057': { name: 'Air France KLM Martinair Cargo', iata: 'AF', region: 'Europe', url: 'https://www.afklcargo.com/' },
  '065': { name: 'Saudia Cargo', iata: 'SV', region: 'Saudi Arabia / Jeddah', url: 'https://saudiacargo.com/e-services/track-shipment' },
  '072': { name: 'Gulf Air Cargo', iata: 'GF', region: 'Bahrain', url: 'https://www.gulfair.com/cargo' },
  '074': { name: 'KLM Cargo', iata: 'KL', region: 'Europe', url: 'https://www.afklcargo.com/' },
  '075': { name: 'Iberia Cargo / IAG Cargo', iata: 'IB', region: 'Europe / UK network', url: 'https://www.iagcargo.com/' },
  '098': { name: 'Air India Cargo', iata: 'AI', region: 'India', url: 'https://cargo.airindia.com/in/en/track-shipment.html' },
  '125': { name: 'British Airways / IAG Cargo', iata: 'BA', region: 'UK', url: 'https://www.iagcargo.com/' },
  '131': { name: 'Japan Airlines Cargo', iata: 'JL', region: 'Japan', url: 'https://www.jal.co.jp/jp/en/jalcargo/' },
  '157': { name: 'Qatar Airways Cargo', iata: 'QR', region: 'Qatar', url: 'https://www.qrcargo.com/s/track-your-shipment' },
  '160': { name: 'Cathay Cargo', iata: 'CX', region: 'Hong Kong / Asia', url: 'https://www.cathaycargo.com/en-us/track-and-trace.html' },
  '172': { name: 'Cargolux', iata: 'CV', region: 'Europe', url: 'https://www.cargolux.com/track-and-trace' },
  '176': { name: 'Emirates SkyCargo', iata: 'EK', region: 'Dubai / UAE', url: 'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt' },
  '180': { name: 'Korean Air Cargo', iata: 'KE', region: 'Korea / Asia', url: 'https://cargo.koreanair.com/en/tracking' },
  '205': { name: 'ANA Cargo', iata: 'NH', region: 'Japan', url: 'https://www.anacargo.jp/en/int/' },
  '217': { name: 'THAI Cargo', iata: 'TG', region: 'Bangkok / Thailand', url: 'https://www.thaicargo.com/en/tracking' },
  '229': { name: 'Kuwait Airways Cargo', iata: 'KU', region: 'Kuwait', url: 'https://www.kuwaitairways.com/en/cargo' },
  '232': { name: 'Malaysia Airlines Cargo', iata: 'MH', region: 'Malaysia / Asia', url: 'https://www.maskargo.com/' },
  '235': { name: 'Turkish Cargo', iata: 'TK', region: 'Türkiye / Europe', url: 'https://turkishcargo.com/en/cargo-tracking' },
  '297': { name: 'China Airlines Cargo', iata: 'CI', region: 'Taiwan / Asia', url: 'https://cargo.china-airlines.com/ccnetv2/content/manage/ShipmentTracking.aspx' },
  '406': { name: 'UPS Airlines', iata: '5X', region: 'USA', url: 'https://www.ups.com/track' },
  '607': { name: 'Etihad Cargo', iata: 'EY', region: 'Abu Dhabi / UAE', url: 'https://www.etihadcargo.com/en/track-and-trace' },
  '618': { name: 'Singapore Airlines Cargo', iata: 'SQ', region: 'Singapore / Asia', url: 'https://www.siacargo.com/' },
  '695': { name: 'EVA Air Cargo', iata: 'BR', region: 'Taiwan / Asia', url: 'https://www.brcargo.com/' },
  '910': { name: 'Oman Air Cargo', iata: 'WY', region: 'Oman', url: 'https://www.omanair.com/cargo' },
  '932': { name: 'Virgin Atlantic Cargo', iata: 'VS', region: 'UK', url: 'https://www.virginatlanticcargo.com/' },
  '933': { name: 'Nippon Cargo Airlines', iata: 'KZ', region: 'Japan', url: 'https://www.nca.aero/e/service/tracing/' }
};

export const CONFIGURED_PREFIXES = Object.keys(AIRLINES);

export function normalizeMawb(value='') {
  const digits = String(value).replace(/\D/g,'');
  return digits.length === 11 ? `${digits.slice(0,3)}-${digits.slice(3)}` : '';
}
export function airlineForMawb(mawb='') {
  return AIRLINES[String(mawb).replace(/\D/g,'').slice(0,3)] || null;
}

export const AIRLINES = {
  '001': { name: 'American Airlines Cargo', iata: 'AA', region: 'USA', url: 'https://www.aacargo.com/AACargo/tracking' },
  '006': { name: 'Delta Cargo', iata: 'DL', region: 'USA', url: 'https://www.deltacargo.com/Cargo/trackShipment' },
  '014': { name: 'Air Canada Cargo', iata: 'AC', region: 'Canada', url: 'https://www.aircanada.com/cargo/tracking?lang=en' },
  '016': { name: 'United Cargo', iata: 'UA', region: 'USA', url: 'https://www.unitedcargo.com/en/us/track' },
  '020': { name: 'Lufthansa Cargo', iata: 'LH', region: 'Germany', url: 'https://www.lufthansa-cargo.com/en/eservices/etracking', priority: true },
  '023': { name: 'FedEx Express', iata: 'FX', region: 'USA', url: 'https://www.fedex.com/en-us/tracking.html' },
  '057': { name: 'Air France KLM Martinair Cargo', iata: 'AF', region: 'Europe', url: 'https://www.afklcargo.com/', priority: true },
  '065': { name: 'Saudia Cargo', iata: 'SV', region: 'Saudi Arabia / Jeddah', url: 'https://china.saudiacargo.com/e-services', priority: true },
  '071': { name: 'Ethiopian Cargo', iata: 'ET', region: 'Ethiopia / Africa', url: 'https://cargo.ethiopianairlines.com/my-cargo/track-your-shipment', priority: true },
  '072': { name: 'Gulf Air Cargo', iata: 'GF', region: 'Bahrain', url: 'https://www.gulfair.com/cargo' },
  '074': { name: 'KLM Cargo', iata: 'KL', region: 'Europe', url: 'https://www.afklcargo.com/' },
  '075': { name: 'Iberia Cargo / IAG Cargo', iata: 'IB', region: 'Europe / UK network', url: 'https://www.iagcargo.com/' },
  '098': { name: 'Air India Cargo', iata: 'AI', region: 'India', url: 'https://cargo.airindia.com/in/en/track-shipment.html', priority: true },
  '112': { name: 'China Cargo Airlines', iata: 'CK', region: 'China / Asia', url: 'https://www.ckair.com/' },
  '125': { name: 'British Airways / IAG Cargo', iata: 'BA', region: 'UK', url: 'https://www.iagcargo.com/' },
  '126': { name: 'Garuda Indonesia Cargo', iata: 'GA', region: 'Indonesia / Asia', url: 'https://www.garuda-indonesia.com/' },
  '131': { name: 'Japan Airlines Cargo', iata: 'JL', region: 'Japan', url: 'https://www.jal.co.jp/jp/en/jalcargo/' },
  '141': { name: 'flydubai Cargo', iata: 'FZ', region: 'Dubai / UAE', url: 'https://www.flydubai.com/en/information/cargo/', priority: true },
  '157': { name: 'Qatar Airways Cargo', iata: 'QR', region: 'Qatar', url: 'https://www.qrcargo.com/s/track-your-shipment', priority: true },
  '160': { name: 'Cathay Cargo', iata: 'CX', region: 'Hong Kong / Asia', url: 'https://www.cathaycargo.com/en-us/track-and-trace.html', priority: true },
  '172': { name: 'Cargolux', iata: 'CV', region: 'Europe', url: 'https://www.cargolux.com/track-and-trace' },
  '176': { name: 'Emirates SkyCargo', iata: 'EK', region: 'Dubai / UAE', url: 'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt', priority: true },
  '180': { name: 'Korean Air Cargo', iata: 'KE', region: 'Korea / Asia', url: 'https://cargo.koreanair.com/en/tracking' },
  '205': { name: 'ANA Cargo', iata: 'NH', region: 'Japan', url: 'https://www.anacargo.jp/en/int/' },
  '217': { name: 'THAI Cargo', iata: 'TG', region: 'Bangkok / Thailand', url: 'https://www.thaicargo.com/en/tracking', priority: true },
  '229': { name: 'Kuwait Airways Cargo', iata: 'KU', region: 'Kuwait', url: 'https://www.kuwaitairways.com/en/cargo' },
  '232': { name: 'Malaysia Airlines Cargo', iata: 'MH', region: 'Malaysia / Asia', url: 'https://www.maskargo.com/', priority: true },
  '235': { name: 'Turkish Cargo', iata: 'TK', region: 'Türkiye / Europe', url: 'https://turkishcargo.com/en/cargo-tracking', priority: true },
  '297': { name: 'China Airlines Cargo', iata: 'CI', region: 'Taiwan / Asia', url: 'https://cargo.china-airlines.com/ccnetv2/content/manage/ShipmentTracking.aspx' },
  '312': { name: 'IndiGo CarGo', iata: '6E', region: 'India', url: 'https://6ecargo.goindigo.in/FrmAWBTracking.aspx', priority: true },
  '406': { name: 'UPS Airlines', iata: '5X', region: 'USA', url: 'https://www.ups.com/track' },
  '514': { name: 'Air Arabia Cargo', iata: 'G9', region: 'Sharjah / UAE', url: 'https://cargo.airarabia.com/cargo-tracking/', priority: true },
  '603': { name: 'SriLankan Cargo', iata: 'UL', region: 'Sri Lanka / Asia', url: 'https://www.srilankancargo.com/', priority: true },
  '607': { name: 'Etihad Cargo', iata: 'EY', region: 'Abu Dhabi / UAE', url: 'https://www.etihadcargo.com/en/track-and-trace', priority: true },
  '618': { name: 'Singapore Airlines Cargo', iata: 'SQ', region: 'Singapore / Asia', url: 'https://www.siacargo.com/' },
  '695': { name: 'EVA Air Cargo', iata: 'BR', region: 'Taiwan / Asia', url: 'https://www.brcargo.com/' },
  '738': { name: 'Vietnam Airlines Cargo', iata: 'VN', region: 'Vietnam / Asia', url: 'https://cargo.vietnamairlines.com/vn/en/shipping-guide/track-your-cargo' },
  '775': { name: 'SpiceJet Cargo', iata: 'SG', region: 'India', url: 'https://corporate.spicejet.com/Cargo.aspx' },
  '781': { name: 'China Eastern Cargo', iata: 'MU', region: 'China / Asia', url: 'https://cargo.ceair.com/' },
  '784': { name: 'China Southern Cargo', iata: 'CZ', region: 'China / Asia', url: 'https://cargo.csair.com/pages/cargotracking' },
  '816': { name: 'Batik Air Malaysia', iata: 'OD', region: 'Malaysia / Asia', url: 'https://www.batikair.com/', priority: true },
  '910': { name: 'Oman Air Cargo', iata: 'WY', region: 'Oman', url: 'https://www.omanair.com/cargo', priority: true },
  '932': { name: 'Virgin Atlantic Cargo', iata: 'VS', region: 'UK', url: 'https://www.virginatlanticcargo.com/' },
  '933': { name: 'Nippon Cargo Airlines', iata: 'KZ', region: 'Japan', url: 'https://www.nca.aero/e/service/tracing/' },
  '978': { name: 'VietJet Cargo', iata: 'VJ', region: 'Vietnam / Asia', url: 'https://www.vietjetair.com/' },
  '999': { name: 'Air China Cargo', iata: 'CA', region: 'China / Asia', url: 'https://www.airchinacargo.com/' }
};

export const CONFIGURED_PREFIXES = Object.keys(AIRLINES);
export const PRIORITY_PREFIXES = Object.entries(AIRLINES).filter(([,v])=>v.priority).map(([k])=>k);

export function normalizeMawb(value='') {
  const digits = String(value).replace(/\D/g,'');
  return digits.length === 11 ? `${digits.slice(0,3)}-${digits.slice(3)}` : '';
}
export function airlineForMawb(mawb='') {
  return AIRLINES[String(mawb).replace(/\D/g,'').slice(0,3)] || null;
}

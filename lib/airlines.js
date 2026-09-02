export const AIRLINES = {
  '057': { name: 'Air France KLM Martinair Cargo', iata: 'AF', url: 'https://www.afklcargo.com/' },
  '065': { name: 'Saudia Cargo', iata: 'SV', url: 'https://saudiacargo.com/e-services/track-shipment' },
  '098': { name: 'Air India Cargo', iata: 'AI', url: 'https://cargo.airindia.com/in/en/track-shipment.html' },
  '157': { name: 'Qatar Airways Cargo', iata: 'QR', url: 'https://www.qrcargo.com/s/track-your-shipment' },
  '160': { name: 'Cathay Cargo', iata: 'CX', url: 'https://www.cathaycargo.com/en-us/track-and-trace.html' },
  '176': { name: 'Emirates SkyCargo', iata: 'EK', url: 'https://scekprd.emirates.com/skychain/app?initial=y&service=page%2Fnwp%3ATrackshipmt' },
  '235': { name: 'Turkish Cargo', iata: 'TK', url: 'https://turkishcargo.com/en/cargo-tracking' }
};

export function normalizeMawb(value='') {
  const digits = String(value).replace(/\D/g,'');
  return digits.length === 11 ? `${digits.slice(0,3)}-${digits.slice(3)}` : '';
}
export function airlineForMawb(mawb='') {
  return AIRLINES[String(mawb).replace(/\D/g,'').slice(0,3)] || null;
}

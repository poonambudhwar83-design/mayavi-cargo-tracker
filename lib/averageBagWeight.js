import { partKg, masterKg } from './arrivalWeights.js';
// Per physical part: 49/99 bags and 1147/2565 kg means 1147/49, not 2565/99.
export function averageWeightPerBag(row={}){
  const bagText=String(row.bags??row.pieces??'').split('/')[0].replace(/,/g,'').trim();
  if(!/^\d+(?:\.\d+)?$/.test(bagText))return null;
  const bags=Number(bagText);
  if(!Number.isFinite(bags)||bags<=0)return null;
  const split=Boolean(row._partKey||row._saudiaPendingVirtual
    ||String(row.bags??row.pieces??'').includes('/')
    ||String(row.weight??'').includes('/'));
  const kg=partKg(row.weight)??(split?null:masterKg(row));
  return kg===null||!Number.isFinite(kg)?null:kg/bags;
}

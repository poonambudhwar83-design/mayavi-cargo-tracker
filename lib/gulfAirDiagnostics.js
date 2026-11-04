// Prevent Gulf Air provider errors returned as JSON objects from being stored
// as the meaningless string "[object Object]" in Mayavi tracking diagnostics.
export function readableGulfFailure(value){
  if(value===null||value===undefined||value==='')return '';
  if(typeof value==='string')return value.trim().slice(0,450);
  if(value instanceof Error)return String(value.message||value).slice(0,450);
  if(typeof value==='object'){
    const preferred=[value.reason,value.message,value.error,value.code,value.detail,value.statusText]
      .filter(item=>item!==null&&item!==undefined&&item!==''&&item!==value);
    if(preferred.length){
      const meaningful=preferred.map(item=>readableGulfFailure(item)).filter(Boolean).join(' / ');
      if(meaningful)return meaningful.slice(0,450);
    }
    try{return JSON.stringify(value).slice(0,450)}catch{return 'Unrecognized Gulf tracking provider error'}
  }
  return String(value).slice(0,450);
}

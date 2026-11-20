// CSV parser for bank statements. Handles BOM, quoted commas and embedded newlines.
// ZIP workbook containers are read separately by the API via JSZip.
export function decodeBankCsv(buffer){
  const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer||[]);
  if(bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xfe)return bytes.subarray(2).toString('utf16le');
  if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff){
    const swapped=Buffer.from(bytes.subarray(2));
    for(let i=0;i+1<swapped.length;i+=2){const x=swapped[i];swapped[i]=swapped[i+1];swapped[i+1]=x;}
    return swapped.toString('utf16le');
  }
  return bytes.toString('utf8').replace(/^\uFEFF/,'');
}
export function parseBankCsv(text,maxRows=8000,maxColumns=48){
  const source=String(text||'');
  const leading=source.slice(0,6000);
  const delimiter=leading.includes('\t')&&!leading.includes(',')?'\t':leading.includes(';')&&!leading.includes(',')?';':',';
  const result=[];
  let cells=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(ch==='"'){
      if(quoted&&source[i+1]==='"'){cell+='"';i++;}
      else quoted=!quoted;
    }else if(!quoted&&ch===delimiter){
      if(cells.length<maxColumns)cells.push(cell.trim());cell='';
    }else if(!quoted&&(ch==='\n'||ch==='\r')){
      if(cells.length<maxColumns)cells.push(cell.trim());
      if(cells.some(Boolean))result.push(cells);
      cells=[];cell='';
      if(ch==='\r'&&source[i+1]==='\n')i++;
      if(result.length>maxRows)throw Error('More than '+maxRows+' populated CSV rows; split the statement into smaller files.');
    }else cell+=ch;
  }
  if(quoted)throw Error('CSV contains an unclosed quoted field.');
  if(cells.length<maxColumns)cells.push(cell.trim());
  if(cells.some(Boolean))result.push(cells);
  if(result.length>maxRows)throw Error('Too many CSV rows.');
  return result;
}

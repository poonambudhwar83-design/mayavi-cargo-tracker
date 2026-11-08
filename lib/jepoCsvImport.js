// JEPO export CSV support: use same column matcher as XLSX without
// converting a large CSV into a memory-heavy ExcelJS workbook.
const MAX_ROWS=50002; // header + 50,000 records; parser caps existing import limit
const MAX_COLUMNS=500;
function decodeCsv(bytes){
 const data=Buffer.from(bytes);
 if(data.length>=2&&data[0]===0xff&&data[1]===0xfe)return new TextDecoder('utf-16le').decode(data.subarray(2));
 if(data.length>=2&&data[0]===0xfe&&data[1]===0xff){
  const swapped=Buffer.from(data.subarray(2));
  for(let i=0;i+1<swapped.length;i+=2){const temp=swapped[i];swapped[i]=swapped[i+1];swapped[i+1]=temp;}
  return new TextDecoder('utf-16le').decode(swapped);
 }
 const utf8=new TextDecoder('utf-8',{fatal:false}).decode(data);
 // Old accounting exports can be Windows-1252, with invalid UTF-8 bytes.
 return (utf8.match(/\uFFFD/g)||[]).length>1
  ?new TextDecoder('windows-1252').decode(data):utf8;
}
function firstRecord(text){
 let quoted=false,result='';
 for(let i=0;i<text.length&&i<25000;i++){
  const ch=text[i];
  if(ch==='"'){
   if(quoted&&text[i+1]==='"'){result+='""';i++;continue;}
   quoted=!quoted;
  }
  if(!quoted&&(ch==='\r'||ch==='\n'))break;
  result+=ch;
 }
 return result;
}
function countDelimiter(record,delimiter){
 let quoted=false,count=0;
 for(let i=0;i<record.length;i++){
  const ch=record[i];
  if(ch==='"'){
   if(quoted&&record[i+1]==='"'){i++;continue;}
   quoted=!quoted;
  }else if(!quoted&&ch===delimiter)count++;
 }
 return count;
}
function dialect(text){
 const first=firstRecord(text);
 // Excel CSV can begin with 'sep=;' (before its real heading row).
 const specified=first.match(/^sep\s*=\s*([,;\t|])\s*$/i);
 const input=specified?text.slice(first.length).replace(/^\r?\n/,''):text;
 const sample=firstRecord(input);
 const choices=[',',';','\t','|'].map(sep=>({sep,count:countDelimiter(sample,sep)}))
  .sort((a,b)=>b.count-a.count);
 if(!choices[0].count)throw Error('CSV mein multiple columns nahi mile. File delimiter check karein.');
 return {separator:specified?specified[1]:choices[0].sep,input};
}
export function parseJepoCsv(text){
 const {separator,input}=dialect(String(text||'').replace(/^\uFEFF/,''));
 const rows=[];let cells=[],value='',quoted=false,overflow=false;
 const saveCell=()=>{
  if(cells.length>=MAX_COLUMNS){overflow=true;return;}
  cells.push(value);value='';
 };
 const saveRow=()=>{
  if(cells.some(v=>String(v).trim()!==''))rows.push(cells);
  cells=[];
 };
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(quoted){
   if(ch==='"'&&input[i+1]==='"'){value+='"';i++;continue;}
   if(ch==='"'){quoted=false;continue;}
   value+=ch;continue;
  }
  if(ch==='"'&&value===''){quoted=true;continue;}
  if(ch===separator){saveCell();continue;}
  if(ch==='\r'||ch==='\n'){
   saveCell();saveRow();
   if(ch==='\r'&&input[i+1]==='\n')i++;
   if(rows.length>MAX_ROWS)throw Error('CSV mein 50,000 se zyada entries hain. File split karke upload karein.');
   continue;
  }
  value+=ch;
 }
 if(quoted)throw Error('CSV mein ek quoted field close nahi hua. CSV dobara export karein.');
 if(value!==''||cells.length){saveCell();saveRow();}
 if(overflow)throw Error('CSV has more than 500 columns. Please reduce unused columns.');
 if(rows.length<2)throw Error('CSV mein heading aur AWB records nahi mile.');
 return rows;
}
export function csvAsJepoWorkbook(bytes,fileName='jepo.csv'){
 const rows=parseJepoCsv(decodeCsv(bytes));
 const name=String(fileName||'JEPO CSV').replace(/\.csv$/i,'').slice(0,100);
 const sheet={
  name,rowCount:rows.length,
  columnCount:Math.max(...rows.slice(0,Math.min(rows.length,101)).map(r=>r.length)),
  actualColumnCount:Math.max(...rows.slice(0,Math.min(rows.length,101)).map(r=>r.length)),
  getRow(number){
   const fields=rows[number-1]||[];
   return {getCell(column){
    const v=fields[column-1]??null;
    return {value:v,text:v===null?'':String(v),numFmt:''};
   }};
  }
 };
 return {eachSheet(callback){callback(sheet,1);}};
}

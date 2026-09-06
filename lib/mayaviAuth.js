import crypto from 'node:crypto';

export const SESSION_COOKIE='mayavi_session';
export const SESSION_MAX_AGE=12*60*60;

function secret(){
  return process.env.MAYAVI_SESSION_SECRET||process.env.MAYAVI_ADMIN_KEY||'';
}
function encode(value){return Buffer.from(value).toString('base64url')}
function decode(value){return Buffer.from(value,'base64url').toString('utf8')}
function secureEqual(a='',b=''){
  const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));
  return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}
function sign(body){
  const key=secret();
  if(!key)throw new Error('Mayavi session secret is not configured.');
  return crypto.createHmac('sha256',key).update(body).digest('base64url');
}

export function normalizeUsername(value=''){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,'');
}
export function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
  const hash=crypto.scryptSync(String(password),salt,64).toString('hex');
  return {salt,hash};
}
export function verifyPassword(password,salt,expectedHash){
  if(!salt||!expectedHash)return false;
  const actual=crypto.scryptSync(String(password),String(salt),64).toString('hex');
  return secureEqual(actual,expectedHash);
}
export function verifyAdminPassword(password=''){
  const configured=process.env.MAYAVI_ADMIN_KEY||'';
  return Boolean(configured&&secureEqual(password,configured));
}
export function createSessionToken(user={}){
  const payload={
    username:normalizeUsername(user.username),
    displayName:String(user.displayName||user.username||'').trim(),
    role:user.role==='admin'?'admin':'employee',
    exp:Math.floor(Date.now()/1000)+SESSION_MAX_AGE
  };
  const body=encode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}
export function readSession(request){
  try{
    const cookie=request?.headers?.get('cookie')||'';
    const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1)||'';
    const [body,sig]=token.split('.');
    if(!body||!sig||!secureEqual(sign(body),sig))return null;
    const payload=JSON.parse(decode(body));
    if(!payload?.username||!payload?.displayName||!payload?.exp||payload.exp<Math.floor(Date.now()/1000))return null;
    return {username:normalizeUsername(payload.username),displayName:String(payload.displayName),role:payload.role==='admin'?'admin':'employee',exp:payload.exp};
  }catch{return null}
}
export function sessionCookie(token,maxAge=SESSION_MAX_AGE){
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearSessionCookie(){
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

'use client';
import { useEffect, useMemo, useState } from 'react';
import DashboardClient from './DashboardClient.js';

const FALLBACK_USERS=[
  {username:'admin',displayName:'Admin',role:'admin',passwordSet:false},
  {username:'naman',displayName:'Naman',role:'employee',passwordSet:false},
  {username:'renu',displayName:'Renu',role:'employee',passwordSet:false},
  {username:'sumit',displayName:'Sumit',role:'employee',passwordSet:false},
  {username:'bholu',displayName:'Bholu',role:'employee',passwordSet:false},
  {username:'bholi',displayName:'Bholi',role:'employee',passwordSet:false}
];

export default function UnifiedDashboard(){
  const [session,setSession]=useState(null);
  const [users,setUsers]=useState(FALLBACK_USERS);
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');

  const selected=useMemo(()=>users.find(u=>u.username===username),[users,username]);
  const firstLogin=Boolean(selected&&!selected.passwordSet);

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const res=await fetch('/api/auth',{cache:'no-store'});
        const data=await res.json();
        if(!active)return;
        if(Array.isArray(data.users)&&data.users.length)setUsers(data.users);
        if(data.authenticated&&data.session)setSession(data.session);
        if(!data.ok&&data.error)setNote(data.error);
      }catch{if(active)setNote('Login service is temporarily unavailable.')}finally{if(active)setLoading(false)}
    })();
    return()=>{active=false};
  },[]);

  async function login(){
    if(!username){setNote('Please select your name.');return}
    if(password.length<4){setNote('Password must be at least 4 characters.');return}
    setBusy(true);setNote('');
    try{
      const res=await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
      const data=await res.json();
      if(!data.ok)throw new Error(data.error||'Login failed.');
      setSession(data.session);setPassword('');
    }catch(e){setNote(e.message||'Login failed.')}finally{setBusy(false)}
  }
  async function logout(){
    try{await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'logout'})})}catch{}
    setSession(null);setUsername('');setPassword('');setNote('Logged out.');
  }

  if(loading)return <main className="loginShell"><section className="loginCard"><div className="eyebrow">MAYAVI CARGO</div><h1>Opening secure dashboard…</h1></section></main>;
  if(session)return <DashboardClient isAdmin={session.role==='admin'} currentUser={session} onLogout={logout}/>;

  return <main className="loginShell">
    <section className="loginCard">
      <div className="eyebrow">MAYAVI CARGO • SECURE ACCESS</div>
      <h1>MAWB Tracker Login</h1>
      <p>Everyone uses this same link. Select your name and enter your password.</p>
      <label>YOUR NAME</label>
      <select value={username} onChange={e=>{setUsername(e.target.value);setPassword('');setNote('')}}>
        <option value="">Select name</option>
        {users.map(u=><option key={u.username} value={u.username}>{u.displayName}{u.role==='admin'?' (Admin)':''}</option>)}
      </select>
      <label>{firstLogin?'SET YOUR PASSWORD':'PASSWORD'}</label>
      <input type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} placeholder={firstLogin?'Choose password on first login':'Enter password'} autoComplete="current-password"/>
      {firstLogin&&<div className="firstLogin">First login: this password will become your permanent Mayavi password.</div>}
      {note&&<div className="loginNote">{note}</div>}
      <button disabled={busy} onClick={login}>{busy?'CHECKING…':firstLogin?'SET PASSWORD & LOGIN':'LOGIN'}</button>
      <small>Admin access is password protected. Employee MAWBs automatically record who entered them.</small>
    </section>
  </main>;
}

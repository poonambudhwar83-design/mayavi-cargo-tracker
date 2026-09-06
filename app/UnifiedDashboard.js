'use client';
import { useEffect, useMemo, useState } from 'react';
import DashboardClient from './DashboardClient.js';

const FALLBACK_USERS=[
  {username:'admin',displayName:'Admin',role:'admin',passwordSet:false},
  {username:'naman',displayName:'Naman',role:'employee',passwordSet:false},
  {username:'renu',displayName:'Renu',role:'employee',passwordSet:false},
  {username:'sumit',displayName:'Sumit',role:'employee',passwordSet:false},
  {username:'mandeep',displayName:'Mandeep',role:'employee',passwordSet:false},
  {username:'parvesh',displayName:'Parvesh',role:'employee',passwordSet:false},
  {username:'rahul',displayName:'Rahul',role:'employee',passwordSet:false}
];
const LOCAL_SHIPMENT_KEY='mayavi_v3_shipments';

const modalBack={position:'fixed',inset:0,zIndex:100,background:'rgba(0,0,0,.48)',display:'flex',alignItems:'center',justifyContent:'center',padding:18};
const modalCard={width:'min(460px,100%)',background:'#fff',borderRadius:18,padding:22,boxShadow:'0 18px 55px rgba(0,0,0,.28)'};
const fullInput={width:'100%',boxSizing:'border-box',marginBottom:12};
const topAccountBar={display:'flex',justifyContent:'flex-end',alignItems:'center',gap:8,flexWrap:'wrap',padding:'8px 14px',background:'#f7f9fc',borderBottom:'1px solid #e1e6ef'};
const topAccountButton={border:'1px solid #cfd7e5',background:'#fff',borderRadius:9,padding:'8px 12px',fontWeight:800,cursor:'pointer',fontSize:12};

function clearStaleShipmentBackup(){try{localStorage.removeItem(LOCAL_SHIPMENT_KEY)}catch{}}

export default function UnifiedDashboard(){
  const [session,setSession]=useState(null);
  const [users,setUsers]=useState(FALLBACK_USERS);
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState('');

  const [changeOpen,setChangeOpen]=useState(false);
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [showChangePasswords,setShowChangePasswords]=useState(false);
  const [changeBusy,setChangeBusy]=useState(false);
  const [changeNote,setChangeNote]=useState('');

  const [manageOpen,setManageOpen]=useState(false);
  const [targetUsername,setTargetUsername]=useState('');
  const [adminNewPassword,setAdminNewPassword]=useState('');
  const [showAdminPassword,setShowAdminPassword]=useState(false);
  const [manageBusy,setManageBusy]=useState(false);
  const [manageNote,setManageNote]=useState('');

  const selected=useMemo(()=>users.find(u=>u.username===username),[users,username]);
  const firstLogin=Boolean(selected&&!selected.passwordSet);
  const employeeUsers=useMemo(()=>users.filter(u=>u.role!=='admin'),[users]);

  async function loadUsers(){
    const res=await fetch('/api/auth',{cache:'no-store'});
    const data=await res.json();
    if(Array.isArray(data.users)&&data.users.length)setUsers(data.users);
    return data;
  }

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        const data=await loadUsers();
        if(!active)return;
        if(data.authenticated&&data.session){clearStaleShipmentBackup();setSession(data.session);}
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
      clearStaleShipmentBackup();setSession(data.session);setPassword('');setShowPassword(false);
      await loadUsers().catch(()=>{});
    }catch(e){setNote(e.message||'Login failed.')}finally{setBusy(false)}
  }

  async function logout(){
    try{await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'logout'})})}catch{}
    setSession(null);setUsername('');setPassword('');setShowPassword(false);setNote('Logged out.');
    closeChange();closeManage();
  }

  function forgotPassword(){
    if(!username){setNote('Select your name first, then press Forgot Password.');return}
    if(selected?.role==='admin'){
      setNote('Admin password is never displayed or recoverable. If you can still login, use Change My Password. Otherwise a secure database reset is required.');
      return;
    }
    setNote(`${selected?.displayName||'User'}: please ask Admin to reset your password. Admin can set a new password or enable fresh password setup for your next login.`);
  }

  function closeChange(){
    setChangeOpen(false);setCurrentPassword('');setNewPassword('');setConfirmPassword('');setShowChangePasswords(false);setChangeNote('');
  }

  async function changePassword(){
    if(currentPassword.length<4){setChangeNote('Enter your current password.');return}
    if(newPassword.length<4){setChangeNote('New password must be at least 4 characters.');return}
    if(newPassword!==confirmPassword){setChangeNote('New password and confirm password do not match.');return}
    setChangeBusy(true);setChangeNote('');
    try{
      const res=await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'change_password',currentPassword,newPassword})});
      const data=await res.json();
      if(!data.ok)throw new Error(data.error||'Password change failed.');
      setCurrentPassword('');setNewPassword('');setConfirmPassword('');setShowChangePasswords(false);setChangeNote('Password changed successfully. Use the new password next time you login.');
    }catch(e){setChangeNote(e.message||'Password change failed.')}finally{setChangeBusy(false)}
  }

  function closeManage(){
    setManageOpen(false);setTargetUsername('');setAdminNewPassword('');setShowAdminPassword(false);setManageNote('');
  }

  async function adminPasswordAction(action){
    if(!targetUsername){setManageNote('Select an employee first.');return}
    if(action==='admin_set_password'&&adminNewPassword.length<4){setManageNote('New password must be at least 4 characters.');return}
    setManageBusy(true);setManageNote('');
    try{
      const res=await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,targetUsername,newPassword:adminNewPassword})});
      const data=await res.json();
      if(!data.ok)throw new Error(data.error||'Password update failed.');
      setAdminNewPassword('');setShowAdminPassword(false);setManageNote(data.message||'Password updated.');
      await loadUsers().catch(()=>{});
    }catch(e){setManageNote(e.message||'Password update failed.')}finally{setManageBusy(false)}
  }

  if(loading)return <main className="loginShell"><section className="loginCard"><div className="eyebrow">MAYAVI CARGO</div><h1>Opening secure dashboard…</h1></section></main>;

  if(session)return <>
    <div style={topAccountBar}>
      {session.role==='admin'&&<button onClick={()=>{setManageOpen(true);setManageNote('')}} style={topAccountButton}>MANAGE USER PASSWORDS</button>}
      <button onClick={()=>{setChangeOpen(true);setChangeNote('')}} style={topAccountButton}>CHANGE MY PASSWORD</button>
    </div>
    <DashboardClient isAdmin={session.role==='admin'} currentUser={session} onLogout={logout}/>

    {changeOpen&&<div style={modalBack}>
      <section style={modalCard}>
        <div className="eyebrow">MAYAVI CARGO • SECURE ACCOUNT</div>
        <h2 style={{margin:'8px 0'}}>Change My Password</h2>
        <p style={{marginTop:0}}>Logged in as <b>{session.displayName}</b>.</p>
        <label>CURRENT PASSWORD</label>
        <input style={fullInput} type={showChangePasswords?'text':'password'} value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} placeholder="Current password" autoComplete="current-password"/>
        <label>NEW PASSWORD</label>
        <input style={fullInput} type={showChangePasswords?'text':'password'} value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="New password" autoComplete="new-password"/>
        <label>CONFIRM NEW PASSWORD</label>
        <input style={fullInput} type={showChangePasswords?'text':'password'} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&changePassword()} placeholder="Confirm new password" autoComplete="new-password"/>
        <button type="button" onClick={()=>setShowChangePasswords(v=>!v)} style={{background:'transparent',border:'1px solid #ccd3df',borderRadius:8,padding:'7px 11px',cursor:'pointer'}}>{showChangePasswords?'HIDE PASSWORDS':'SHOW PASSWORDS'}</button>
        {changeNote&&<div className="loginNote" style={{marginTop:12}}>{changeNote}</div>}
        <div style={{display:'flex',gap:10,marginTop:16}}>
          <button disabled={changeBusy} onClick={changePassword} style={{flex:1}}>{changeBusy?'CHANGING…':'SAVE NEW PASSWORD'}</button>
          <button disabled={changeBusy} onClick={closeChange} style={{flex:1}}>CLOSE</button>
        </div>
      </section>
    </div>}

    {session.role==='admin'&&manageOpen&&<div style={modalBack}>
      <section style={modalCard}>
        <div className="eyebrow">MAYAVI CARGO • ADMIN</div>
        <h2 style={{margin:'8px 0'}}>User Password Management</h2>
        <p style={{marginTop:0}}>Choose an employee. You can assign a new password or reset them to first-login setup.</p>
        <label>EMPLOYEE</label>
        <select style={fullInput} value={targetUsername} onChange={e=>{setTargetUsername(e.target.value);setAdminNewPassword('');setManageNote('')}}>
          <option value="">Select employee</option>
          {employeeUsers.map(u=><option key={u.username} value={u.username}>{u.displayName} {u.passwordSet?'• Password set':'• First login pending'}</option>)}
        </select>
        <label>NEW PASSWORD</label>
        <div style={{display:'flex',gap:8,alignItems:'stretch'}}>
          <input style={{flex:1,minWidth:0}} type={showAdminPassword?'text':'password'} value={adminNewPassword} onChange={e=>setAdminNewPassword(e.target.value)} placeholder="Admin can assign a new password" autoComplete="new-password"/>
          <button type="button" onClick={()=>setShowAdminPassword(v=>!v)} style={{width:84,padding:'0 10px'}}>{showAdminPassword?'HIDE':'SHOW'}</button>
        </div>
        {manageNote&&<div className="loginNote" style={{marginTop:12}}>{manageNote}</div>}
        <div style={{display:'grid',gap:10,marginTop:16}}>
          <button disabled={manageBusy} onClick={()=>adminPasswordAction('admin_set_password')}>{manageBusy?'WORKING…':'SET NEW PASSWORD'}</button>
          <button disabled={manageBusy} onClick={()=>adminPasswordAction('admin_reset_password')}>RESET FOR FIRST LOGIN</button>
          <button disabled={manageBusy} onClick={closeManage}>CLOSE</button>
        </div>
        <small style={{display:'block',marginTop:12}}>Reset for First Login removes the old password securely; the employee then chooses a fresh password on their next login.</small>
      </section>
    </div>}
  </>;

  return <main className="loginShell">
    <section className="loginCard">
      <div className="eyebrow">MAYAVI CARGO • SECURE ACCESS</div>
      <h1>MAWB Tracker Login</h1>
      <p>Everyone uses this same link. Select your name and enter your password.</p>
      <label>YOUR NAME</label>
      <select value={username} onChange={e=>{setUsername(e.target.value);setPassword('');setShowPassword(false);setNote('')}}>
        <option value="">Select name</option>
        {users.map(u=><option key={u.username} value={u.username}>{u.displayName}{u.role==='admin'?' (Admin)':''}</option>)}
      </select>
      <label>{firstLogin?'SET YOUR PASSWORD':'PASSWORD'}</label>
      <div style={{display:'flex',gap:8,alignItems:'stretch'}}>
        <input style={{flex:1,minWidth:0}} type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} placeholder={firstLogin?'Choose password on first login':'Enter password'} autoComplete={firstLogin?'new-password':'current-password'}/>
        <button type="button" onClick={()=>setShowPassword(v=>!v)} style={{width:84,padding:'0 10px'}}>{showPassword?'HIDE':'SHOW'}</button>
      </div>
      {firstLogin&&<div className="firstLogin">First login: this password will become your permanent Mayavi password.</div>}
      {note&&<div className="loginNote">{note}</div>}
      <button disabled={busy} onClick={login}>{busy?'CHECKING…':firstLogin?'SET PASSWORD & LOGIN':'LOGIN'}</button>
      {!firstLogin&&<button type="button" onClick={forgotPassword} style={{marginTop:8,background:'transparent',color:'#174f96',border:'none',textDecoration:'underline',cursor:'pointer'}}>FORGOT PASSWORD?</button>}
      <small>Saved passwords are never displayed from the database. You can show what you are typing, change your own password after login, and Admin can reset employee passwords.</small>
    </section>
  </main>;
}

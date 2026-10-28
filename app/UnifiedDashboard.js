'use client';
import { useEffect, useMemo, useState } from 'react';
import DashboardClient from './DashboardClient.js';
import SpeedPostDashboard from './SpeedPostDashboard.js';
import AdminNotesDashboard from './AdminNotesDashboard.js';
import SaudiaAssist from './SaudiaAssist.js';
import ImportFinanceSection from './ImportFinanceSection.js';
import ExportProfitSheet from './ExportProfitSheet.js';
import BranchLoadsDashboard from './BranchLoadsDashboard.js';
import HaryanaAdminDashboard from './HaryanaAdminDashboard.js';

const FALLBACK_USERS=[
  {username:'admin',displayName:'Admin',role:'admin',passwordSet:false},
  {username:'naman',displayName:'Naman',role:'employee',passwordSet:false},
  {username:'renu',displayName:'Renu',role:'employee',passwordSet:false},
  {username:'sumit',displayName:'Sumit',role:'employee',passwordSet:false},
  {username:'mandeep',displayName:'Mandeep',role:'employee',passwordSet:false},
  {username:'parvesh',displayName:'Parvesh',role:'employee',passwordSet:false},
  {username:'rahul',displayName:'Rahul',role:'employee',passwordSet:false},
  {username:'sonu',displayName:'Sonu',role:'employee',passwordSet:false},
  {username:'jind',displayName:'Jind',role:'employee',branchScope:'JIND',passwordSet:false},
  {username:'karnal',displayName:'Karnal',role:'employee',branchScope:'KARNAL',passwordSet:false},
  {username:'haryanaadmin',displayName:'Haryana Admin',role:'haryana_admin',branchScope:'HARYANA',passwordSet:false}
];
const LOCAL_SHIPMENT_KEY='mayavi_v3_shipments';

const modalBack={position:'fixed',inset:0,zIndex:1000,background:'rgba(15,23,42,.55)',display:'flex',alignItems:'center',justifyContent:'center',padding:16,overflowY:'auto'};
const modalCard={position:'relative',width:'min(460px,100%)',maxHeight:'calc(100dvh - 32px)',overflowY:'auto',overscrollBehavior:'contain',margin:'auto',background:'#fff',borderRadius:18,padding:22,boxSizing:'border-box',boxShadow:'0 18px 55px rgba(0,0,0,.28)'};
const fullInput={width:'100%',boxSizing:'border-box',marginBottom:12};
const topAccountBar={display:'flex',justifyContent:'flex-end',alignItems:'center',gap:8,flexWrap:'wrap',padding:'8px 14px',background:'#f7f9fc',borderBottom:'1px solid #e1e6ef'};
const topAccountButton={border:'1px solid #cfd7e5',background:'#fff',borderRadius:9,padding:'8px 12px',fontWeight:800,cursor:'pointer',fontSize:12};

function clearStaleShipmentBackup(){try{localStorage.removeItem(LOCAL_SHIPMENT_KEY)}catch{}}

export default function UnifiedDashboard(){
  const [session,setSession]=useState(null);
  const [selectedDashboard,setSelectedDashboard]=useState('AIR_CARGO');
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
  const managedSelected=useMemo(()=>users.find(u=>u.username===targetUsername),[users,targetUsername]);
  const managingMainAdmin=managedSelected?.role==='admin';
  const branchNeedsAdminPassword=Boolean(selected&&!selected.passwordSet&&selected.branchScope);
  const firstLogin=Boolean(selected&&!selected.passwordSet&&!branchNeedsAdminPassword);
  const managedUsers=useMemo(()=>users.filter(u=>u.username).sort((a,b)=>a.displayName.localeCompare(b.displayName)),[users]);

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
        if(data.authenticated&&data.session){
          // Preserve the signed-in user's last saved snapshot on a normal reload.
          // DashboardClient paints it immediately while the server list loads.
          // An explicit new login still clears any previous user's local cache.
          setSession(data.session);
          if(data.session.role==='haryana_admin')setSelectedDashboard('HARYANA');
          else if(data.session.branchScope)setSelectedDashboard('BRANCH_LOADS');
        }
        if(!data.ok&&data.error)setNote(data.error);
      }catch{if(active)setNote('Login service is temporarily unavailable.')}finally{if(active)setLoading(false)}
    })();
    return()=>{active=false};
  },[]);

  // Security poll: an Admin Force Logout invalidates the signed token on the
  // server. Drop the live page once auth reports revocation, even on an idle tab.
  useEffect(()=>{
    if(!session)return;
    let active=true;
    async function verify(){
      try{
        const res=await fetch('/api/auth',{credentials:'include',cache:'no-store'});
        const data=await res.json();
        if(!active)return;
        if(res.ok&&data.ok&&!data.authenticated){
          setSession(null);setSelectedDashboard('AIR_CARGO');setNote('Your session was ended by Admin. Please log in again.');
          setPassword('');setUsername('');
        }
      }catch{}
    }
    const check=()=>{if(document.visibilityState!=='hidden')void verify();};
    const timer=setInterval(check,15000);
    window.addEventListener('focus',check);
    document.addEventListener('visibilitychange',check);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)};
  },[session?.username,session?.sessionVersion]);

  async function login(){
    if(!username){setNote('Please select your name.');return}
    if(password.length<4){setNote('Password must be at least 4 characters.');return}
    setBusy(true);setNote('');
    try{
      const res=await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
      const data=await res.json();
      if(!data.ok)throw new Error(data.error||'Login failed.');
      clearStaleShipmentBackup();setSession(data.session);setSelectedDashboard(data.session.role==='haryana_admin'?'HARYANA':data.session.branchScope?'BRANCH_LOADS':'AIR_CARGO');setPassword('');setShowPassword(false);
      await loadUsers().catch(()=>{});
    }catch(e){setNote(e.message||'Login failed.')}finally{setBusy(false)}
  }

  async function logout(){
    try{await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'logout'})})}catch{}
    setSession(null);setSelectedDashboard('AIR_CARGO');setUsername('');setPassword('');setShowPassword(false);setNote('Logged out.');
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
  useEffect(()=>{
    if(!manageOpen&&!changeOpen)return;
    const onEscape=e=>{
      if(e.key==='Escape'){
        e.preventDefault();
        if(manageOpen)closeManage();
        if(changeOpen)closeChange();
      }
    };
    window.addEventListener('keydown',onEscape);
    return()=>window.removeEventListener('keydown',onEscape);
  },[manageOpen,changeOpen]);

  async function adminPasswordAction(action){
    if(!targetUsername){setManageNote('Select a user first.');return}
    if(managingMainAdmin){setManageNote('Use Change My Password for the main Admin account.');return}
    if(action==='admin_set_password'&&adminNewPassword.length<8){setManageNote('Password must contain at least 8 characters.');return}
    setManageBusy(true);setManageNote('');
    try{
      const res=await fetch('/api/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,targetUsername,newPassword:adminNewPassword})});
      const data=await res.json();
      if(!data.ok)throw new Error(data.error||'Password update failed.');
      setAdminNewPassword('');setShowAdminPassword(false);setManageNote(data.message||'Password updated.');
      await loadUsers().catch(()=>{});
    }catch(e){setManageNote(e.message||'Password update failed.')}finally{setManageBusy(false)}
  }

  const speedPostAllowed=Boolean(session&&(session.role==='admin'||String(session.username||'').toLowerCase()==='sonu'));
  const branchLogin=Boolean(session?.role==='employee'&&['JIND','KARNAL'].includes(session.branchScope));
  const haryanaLogin=Boolean(session?.role==='haryana_admin'&&session.branchScope==='HARYANA');
  // Keep the view switch separate from the account-bar JSX. Each branch
  // employee gets only its own dedicated page; Admin can switch back freely.
  const branchSelected=Boolean(branchLogin||(session?.role==='admin'&&selectedDashboard==='BRANCH_LOADS'));
  const dashboardView=haryanaLogin
    ?<HaryanaAdminDashboard/>
    :branchSelected
    ?<BranchLoadsDashboard currentUser={session}/>
    :session?.role==='admin'&&selectedDashboard==='IMPORT_PROFIT'
      ?<ImportFinanceSection/>
    :session?.role==='admin'&&selectedDashboard==='EXPORT_PROFIT'
      ?<ExportProfitSheet/>
    :session?.role==='admin'&&selectedDashboard==='NOTES'
      ?<AdminNotesDashboard currentUser={session}/>
    :speedPostAllowed&&selectedDashboard==='SPEED_POST'
      ?<SpeedPostDashboard currentUser={session}/>
    :<DashboardClient isAdmin={session?.role==='admin'} currentUser={session}
        onLogout={logout}
        onOpenSpeedPost={speedPostAllowed?()=>setSelectedDashboard('SPEED_POST'):null}
        onOpenAdminNotes={session?.role==='admin'?()=>setSelectedDashboard('NOTES'):null}/>;
  if(loading)return <main className="loginShell"><section className="loginCard"><div className="eyebrow">MAYAVI CARGO</div><h1>Opening secure dashboard…</h1></section></main>;

  if(session)return <>
    <div style={topAccountBar}>
      {!branchLogin&&!haryanaLogin&&<SaudiaAssist/>}
      {!branchLogin&&!haryanaLogin&&selectedDashboard!=='AIR_CARGO'&&<button style={{...topAccountButton,background:'#dbeafe',color:'#17419b'}} onClick={()=>setSelectedDashboard('AIR_CARGO')}>← BACK TO AIR CARGO</button>}
      {session.role==='admin'&&<button onClick={()=>setSelectedDashboard('IMPORT_PROFIT')} style={{...topAccountButton,background:selectedDashboard==='IMPORT_PROFIT'?'#dbeafe':'#fff',color:'#17419b'}}>IMPORT PROFIT SHEET</button>}
      {session.role==='admin'&&<button onClick={()=>setSelectedDashboard('EXPORT_PROFIT')} style={{...topAccountButton,background:selectedDashboard==='EXPORT_PROFIT'?'#dbeafe':'#fff',color:'#17419b'}}>EXPORT PROFIT SHEET</button>}
      {session.role==='admin'&&<button onClick={()=>setSelectedDashboard('BRANCH_LOADS')} style={{...topAccountButton,background:selectedDashboard==='BRANCH_LOADS'?'#dbeafe':'#fff',color:'#17419b'}}>JIND / KARNAL LOADS</button>}
      {session.role==='admin'&&<button onClick={()=>{setManageOpen(true);setManageNote('')}} style={topAccountButton}>MANAGE USER PASSWORDS</button>}
      <button onClick={()=>{setChangeOpen(true);setChangeNote('')}} style={topAccountButton}>CHANGE MY PASSWORD</button>
      {(branchLogin||haryanaLogin||selectedDashboard!=='AIR_CARGO')&&<button style={topAccountButton} onClick={logout}>LOGOUT</button>}
    </div>
    {dashboardView}

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

    {session.role==='admin'&&manageOpen&&<div style={modalBack} role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)closeManage()}}>
      <section style={modalCard} role="dialog" aria-modal="true" aria-label="Branch and Haryana Admin password management" onMouseDown={e=>e.stopPropagation()}>
        <button type="button" onClick={closeManage} aria-label="Close password manager" title="Close" style={{position:'absolute',right:12,top:12,width:36,height:36,display:'grid',placeItems:'center',fontSize:25,fontWeight:700,lineHeight:1,border:'1px solid #cbd5e1',borderRadius:9,background:'#f8fafc',color:'#1e293b',cursor:'pointer',zIndex:2}}>×</button>
        <div className="eyebrow">MAYAVI CARGO • ADMIN</div>
        <h2 style={{margin:'8px 38px 8px 0'}}>Manage User Passwords</h2>
        <p style={{marginTop:0}}>Manage passwords and sessions for all active user IDs. Main Admin uses Change My Password.</p>
        <label>ACCOUNT</label>
        <select style={fullInput} value={targetUsername} onChange={e=>{setTargetUsername(e.target.value);setAdminNewPassword('');setManageNote('')}}>
          <option value="">Select user</option>
          {managedUsers.map(u=><option key={u.username} value={u.username}>{u.displayName} ({u.username}) {u.passwordSet?'• Password set':'• Password pending'}</option>)}
        </select>
        {managingMainAdmin&&<p style={{color:'#92400e',fontWeight:700}}>Main Admin: use Change My Password above. Password reset is disabled for this account.</p>}
        <label>NEW PASSWORD</label>
        <div style={{display:'flex',gap:8,alignItems:'stretch'}}>
          <input style={{flex:1,minWidth:0}} disabled={managingMainAdmin} type={showAdminPassword?'text':'password'} value={adminNewPassword} onChange={e=>setAdminNewPassword(e.target.value)} placeholder="Admin can assign a new password" autoComplete="new-password"/>
          <button type="button" onClick={()=>setShowAdminPassword(v=>!v)} style={{width:84,padding:'0 10px'}}>{showAdminPassword?'HIDE':'SHOW'}</button>
        </div>
        {manageNote&&<div className="loginNote" style={{marginTop:12}}>{manageNote}</div>}
        <div style={{display:'grid',gap:10,marginTop:16}}>
          <button disabled={manageBusy||!targetUsername||managingMainAdmin} onClick={()=>adminPasswordAction('admin_set_password')}>{manageBusy?'WORKING…':'SET NEW PASSWORD'}</button>
          <button disabled={manageBusy||!targetUsername||managingMainAdmin} onClick={()=>adminPasswordAction('admin_reset_password')}>RESET USER PASSWORD</button>
          <button disabled={manageBusy||!targetUsername||managingMainAdmin} style={{background:'#7f1d1d',color:'#fff'}} onClick={()=>{if(window.confirm('Force logout this user on all devices?'))void adminPasswordAction('admin_force_logout')}}>FORCE LOGOUT USER</button>
          <button type="button" onClick={closeManage} style={{background:'#e2e8f0',color:'#0f172a',fontWeight:800}}>CLOSE WINDOW</button>
        </div>
        <small style={{display:'block',marginTop:12}}>Changing the password also ends old sessions. This window can be closed using ×, Close Window, Esc, or by clicking outside.</small>

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
        {users.map(u=><option key={u.username} value={u.username}>{u.displayName}{u.role==='admin'?' (Admin)':u.role==='haryana_admin'?' (Read-only)':''}</option>)}
      </select>
      <label>{firstLogin?'SET YOUR PASSWORD':'PASSWORD'}</label>
      <div style={{display:'flex',gap:8,alignItems:'stretch'}}>
        <input style={{flex:1,minWidth:0}} type={showPassword?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} placeholder={firstLogin?'Choose password on first login':'Enter password'} autoComplete={firstLogin?'new-password':'current-password'}/>
        <button type="button" onClick={()=>setShowPassword(v=>!v)} style={{width:84,padding:'0 10px'}}>{showPassword?'HIDE':'SHOW'}</button>
      </div>
      {firstLogin&&<div className="firstLogin">First login: this password will become your permanent Mayavi password.</div>}
      {branchNeedsAdminPassword&&<div className="firstLogin">For branch employees, Admin must assign a password in Manage User Passwords.</div>}
      {note&&<div className="loginNote">{note}</div>}
      <button disabled={busy} onClick={login}>{busy?'CHECKING…':firstLogin?'SET PASSWORD & LOGIN':'LOGIN'}</button>
      {!firstLogin&&<button type="button" onClick={forgotPassword} style={{marginTop:8,background:'transparent',color:'#174f96',border:'none',textDecoration:'underline',cursor:'pointer'}}>FORGOT PASSWORD?</button>}
      <small>Saved passwords are never displayed from the database. You can show what you are typing, change your own password after login, and Admin can reset employee passwords.</small>
    </section>
  </main>;
}

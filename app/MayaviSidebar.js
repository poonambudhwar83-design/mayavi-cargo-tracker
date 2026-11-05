'use client';
import { useState } from 'react';

// One navigation rail for the existing Mayavi pages. Permissions mirror the
// signed-in dashboard routes; the sidebar never grants API access by itself.
const cargo = (id,label,tab,view='ACTIVE')=>({id,label,dashboard:'AIR_CARGO',tab,view});
const page = (id,label,dashboard)=>({id,label,dashboard});
export default function MayaviSidebar({session,selectedDashboard,cargoNav,onSelect,onManagePasswords,onChangePassword,onLogout,speedPostAllowed}){
  const [mobileOpen,setMobileOpen]=useState(false);
  const admin=session?.role==='admin';
  const branch=['JIND','KARNAL'].includes(session?.branchScope);
  const haryana=session?.role==='haryana_admin';
  const accounts=session?.branchScope==='ACCOUNTS';
  const sections=[];
  if(accounts){
    sections.push({title:'ACCOUNTS',items:[page('account','Accounts & Summary','ACCOUNT')]});
  }else if(haryana){
    sections.push({title:'HARYANA',items:[page('haryana','Haryana Admin','HARYANA')]});
  }else if(branch){
    sections.push({title:'BRANCH',items:[page('branch','Branch Loads','BRANCH_LOADS')]});
  }else{
    sections.push({title:'CARGO TRACKING',items:[
      cargo('active-import','Active Import','IMPORT'),
      cargo('active-export','Active Export','EXPORT'),
      ...(admin?[
        cargo('cleared-import','Customs Cleared · Import','IMPORT','CLEARED'),
        cargo('cleared-export','Customs Cleared · Export','EXPORT','CLEARED'),
        cargo('other-import','Other Countries · Import','OTHER_COUNTRIES_IMPORT'),
        cargo('other-export','Other Countries · Export','OTHER_COUNTRIES'),
        cargo('other-cleared-import','Other Countries · Cleared Import','OTHER_COUNTRIES_IMPORT','CLEARED'),
        cargo('other-cleared-export','Other Countries · Cleared Export','OTHER_COUNTRIES','CLEARED'),
        page('monthly','Monthly Records','MONTHLY')
      ]:[])
    ]});
    if(admin){
      sections.push({title:'FINANCE',items:[
        page('import-profit','Import Profit Sheet','IMPORT_PROFIT'),
        page('export-profit','Export Profit Sheet','EXPORT_PROFIT'),
        page('salary','Salary','SALARY'),
        page('monthly-expenses','Monthly Expenses','MONTHLY_EXPENSES'),
        page('account','Accounts & Summary','ACCOUNT')
      ]});
    }
    const operations=[
      ...(speedPostAllowed?[page('speed-post','Speed Post','SPEED_POST')]:[]),
      ...(admin?[
        page('branch','Jind / Karnal Loads','BRANCH_LOADS'),
        page('other-couriers','Other Courier Summary','OTHER_COUNTRIES'),
        page('analysis','Data Analysis','DATA_ANALYSIS'),
        page('meetings','Meetings & Daily Updates','ADMIN_NOTES'),
        page('notes','Study Notes','NOTES')
      ]:[])
    ];
    if(operations.length)sections.push({title:'OPERATIONS',items:operations});
  }
  function choose(item){onSelect(item);setMobileOpen(false)}
  function current(item){
    return item.dashboard==='AIR_CARGO'
      ? selectedDashboard==='AIR_CARGO'&&cargoNav?.id===item.id
      : selectedDashboard===item.dashboard;
  }
  return <>
    <button type="button" className="mayavi-mobile-toggle" onClick={()=>setMobileOpen(v=>!v)} aria-expanded={mobileOpen} aria-controls="mayavi-sidebar-navigation">☰ Menu</button>
    {mobileOpen&&<button className="mayavi-sidebar-scrim" type="button" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>}
    <aside className={'mayavi-sidebar'+(mobileOpen?' is-open':'')} id="mayavi-sidebar-navigation">
      <div className="mayavi-sidebar-brand"><span className="mayavi-brand-mark">M</span><div><strong>MAYAVI CARGO</strong><small>CONTROL CENTER</small></div></div>
      <nav aria-label="Mayavi sections" className="mayavi-sidebar-links">
        {sections.map(section=><div className="mayavi-sidebar-group" key={section.title}>
          <div className="mayavi-sidebar-heading">{section.title}</div>
          {section.items.map(item=><button key={item.id} type="button" className={'mayavi-sidebar-item'+(current(item)?' is-active':'')} aria-current={current(item)?'page':undefined} onClick={()=>choose(item)}><span className="mayavi-sidebar-dot" aria-hidden="true"/><span>{item.label}</span></button>)}
        </div>)}
        <div className="mayavi-sidebar-group">
          <div className="mayavi-sidebar-heading">SETTINGS</div>
          {admin&&<button type="button" className="mayavi-sidebar-item" onClick={()=>{onManagePasswords();setMobileOpen(false)}}>Manage User Passwords</button>}
          <button type="button" className="mayavi-sidebar-item" onClick={()=>{onChangePassword();setMobileOpen(false)}}>Change My Password</button>
          <button type="button" className="mayavi-sidebar-item mayavi-sidebar-logout" onClick={onLogout}>Log Out</button>
        </div>
      </nav>
      <div className="mayavi-sidebar-user"><span className="mayavi-sidebar-avatar">{String(session?.displayName||session?.username||'U').slice(0,1).toUpperCase()}</span><div><strong>{session?.displayName||session?.username||'User'}</strong><small>{admin?'ADMIN':haryana?'HARYANA ADMIN':accounts?'ACCOUNTS':branch?'BRANCH':'EMPLOYEE'}</small></div></div>
    </aside>
  </>;
}

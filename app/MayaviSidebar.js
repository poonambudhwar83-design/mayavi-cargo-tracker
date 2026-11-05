'use client';
import { useRef } from 'react';

// One navigation rail for the existing Mayavi pages. Permissions mirror the
// signed-in dashboard routes; the sidebar never grants API access by itself.
const cargo = (id,label,tab,view='ACTIVE')=>({id,label,dashboard:'AIR_CARGO',tab,view});
const page = (id,label,dashboard)=>({id,label,dashboard});
export default function MayaviSidebar({session,selectedDashboard,cargoNav,onSelect,onManagePasswords,onChangePassword,onLogout,speedPostAllowed}){
  const settingsRef=useRef(null);
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
  function choose(item){onSelect(item)}
  function current(item){
    return item.dashboard==='AIR_CARGO'
      ? selectedDashboard==='AIR_CARGO'&&cargoNav?.id===item.id
      : selectedDashboard===item.dashboard;
  }
  function settingsAction(action){
    if(settingsRef.current)settingsRef.current.open=false;
    action();
  }
  return <header className="mayavi-sidebar" id="mayavi-sidebar-navigation">
    <div className="mayavi-header-top">
      <div className="mayavi-sidebar-brand"><span className="mayavi-brand-mark">M</span><strong>MAYAVI CARGO</strong><span className="mayavi-brand-subtitle">TRACKER</span></div>
      <div className="mayavi-header-account">
        <span className="mayavi-sidebar-user" title={session?.displayName||session?.username||'User'}>
          <span className="mayavi-sidebar-avatar">{String(session?.displayName||session?.username||'U').slice(0,1).toUpperCase()}</span>
          <strong>{session?.displayName||session?.username||'User'}</strong>
        </span>
        <details className="mayavi-settings" ref={settingsRef}>
          <summary>Settings <span aria-hidden="true">⌄</span></summary>
          <div className="mayavi-settings-menu">
            {admin&&<button type="button" onClick={()=>settingsAction(onManagePasswords)}>Manage User Passwords</button>}
            <button type="button" onClick={()=>settingsAction(onChangePassword)}>Change My Password</button>
            <button type="button" className="mayavi-sidebar-logout" onClick={()=>settingsAction(onLogout)}>Log Out</button>
          </div>
        </details>
      </div>
    </div>
    <nav aria-label="Mayavi sections — scroll sideways to see every tab" className="mayavi-sidebar-links">
      {sections.map(section=><div className="mayavi-sidebar-group" key={section.title}>
        <span className="mayavi-sidebar-heading">{section.title}</span>
        {section.items.map(item=><button key={item.id} type="button" className={'mayavi-sidebar-item'+(current(item)?' is-active':'')} aria-current={current(item)?'page':undefined} onClick={()=>choose(item)}>{item.label}</button>)}
      </div>)}
    </nav>
  </header>;
}

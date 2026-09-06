import DashboardClient from '../DashboardClient.js';

export const metadata={title:'Mayavi Cargo Admin Dashboard'};

export default function AdminPage(){
  return <DashboardClient isAdmin={true}/>;
}

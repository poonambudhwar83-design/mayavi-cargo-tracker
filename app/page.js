import UnifiedDashboard from './UnifiedDashboard.js';
import ActiveMasterFilters from './ActiveMasterFilters.js';
import MasterTotals from './MasterTotals.js';

export default function Page(){
  return <><UnifiedDashboard/><ActiveMasterFilters/><MasterTotals/></>;
}

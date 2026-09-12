import UnifiedDashboard from './UnifiedDashboard.js';
import ActiveMasterFilters from './ActiveMasterFilters.js';
import MasterTotals from './MasterTotals.js';
import CustomsClearedEnhancements from './CustomsClearedEnhancements.js';

export default function Page(){
  return <><UnifiedDashboard/><ActiveMasterFilters/><MasterTotals/><CustomsClearedEnhancements/></>;
}

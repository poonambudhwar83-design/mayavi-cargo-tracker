import UnifiedDashboard from './UnifiedDashboard.js';
import ActiveMasterFilters from './ActiveMasterFilters.js';
import MasterTotals from './MasterTotals.js';
import CustomsClearedEnhancements from './CustomsClearedEnhancements.js';
import IndigoAutoSync from './IndigoAutoSync.js';
import EntryDateColumn from './EntryDateColumn.js';

export default function Page(){
  return <><IndigoAutoSync/><UnifiedDashboard/><EntryDateColumn/><ActiveMasterFilters/><MasterTotals/><CustomsClearedEnhancements/></>;
}

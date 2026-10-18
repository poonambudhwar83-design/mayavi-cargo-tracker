import UnifiedDashboard from './UnifiedDashboard.js';
import MasterTotals from './MasterTotals.js';
import CustomsClearedEnhancements from './CustomsClearedEnhancements.js';
import IndigoAutoSync from './IndigoAutoSync.js';

export default function Page(){
  return <><IndigoAutoSync/><UnifiedDashboard/><MasterTotals/><CustomsClearedEnhancements/></>;
}

import { useUIStore } from '../../stores/useUIStore';
import { Outlet } from 'react-router-dom';
import { InfoPanel } from './InfoPanel';

export const MainContent: React.FC = () => {
  const isInfoPanelOpen = useUIStore((state) => state.isInfoPanelOpen);

  return (
    <div className="flex flex-1 h-full overflow-hidden bg-surface">
      <main className="flex-1 bg-white rounded-xl m-2 shadow-sm overflow-y-auto">
        <Outlet />
      </main>
      
      {isInfoPanelOpen && <InfoPanel />}
    </div>
  );
};

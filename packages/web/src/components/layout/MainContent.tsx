import { Outlet } from 'react-router-dom';
import { InfoPanel } from './InfoPanel';

export const MainContent: React.FC = () => {
  // InfoPanel is always mounted so the width transition can play;
  // the panel internally reads isInfoPanelOpen to animate open/closed.
  return (
    <div className="flex flex-1 h-full overflow-hidden bg-surface">
      <main className="flex-1 bg-background rounded-xl m-2 shadow-sm overflow-y-auto">
        <Outlet />
      </main>

      <InfoPanel />
    </div>
  );
};

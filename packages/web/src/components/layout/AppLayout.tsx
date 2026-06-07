import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';

export const AppLayout = () => {
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-surface">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <MainContent />
      </div>
    </div>
  );
};

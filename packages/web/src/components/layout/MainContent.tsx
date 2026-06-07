import { useUIStore } from '../../stores/useUIStore';

export const MainContent: React.FC = () => {
  const isInfoPanelOpen = useUIStore((state) => state.isInfoPanelOpen);

  return (
    <div className="flex flex-1 h-full overflow-hidden bg-surface">
      <main className="flex-1 bg-white rounded-xl m-2 p-4 shadow-sm overflow-y-auto">
        <h1 className="text-2xl mb-4">My Drive</h1>
        <div className="text-gray-500">File grid will go here...</div>
      </main>
      
      {isInfoPanelOpen && (
        <aside className="w-80 bg-white border-l border-gray-200 p-4">
          <h2 className="text-lg">Details</h2>
        </aside>
      )}
    </div>
  );
};

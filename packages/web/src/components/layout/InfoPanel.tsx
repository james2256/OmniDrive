import React from 'react';

export const InfoPanel: React.FC = () => {
  return (
    <aside className="w-80 bg-white border-l border-gray-200 p-4 flex flex-col">
      <h2 className="text-lg font-semibold mb-4">Details</h2>
      <div className="flex-1 overflow-y-auto">
        <p className="text-sm text-gray-500">Select a file or folder to see its details here.</p>
      </div>
    </aside>
  );
};

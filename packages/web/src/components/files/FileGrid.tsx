import React, { useState } from 'react';
import { useUIStore } from '../../stores/useUIStore';

const mockFiles = [
  { id: '1', name: 'Project Proposal.pdf', type: 'pdf', size: '2.5 MB' },
  { id: '2', name: 'Q3 Financials.xlsx', type: 'excel', size: '1.2 MB' },
  { id: '3', name: 'Presentation.pptx', type: 'powerpoint', size: '5.4 MB' },
];

export const FileGrid: React.FC = () => {
  const toggleInfoPanel = useUIStore((state) => state.toggleInfoPanel);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    toggleInfoPanel();
  };

  return (
    <div className="p-4">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {mockFiles.map((file) => (
          <div
            key={file.id}
            onClick={() => handleSelect(file.id)}
            className={`p-4 border rounded-lg cursor-pointer hover:bg-gray-50 flex flex-col items-center justify-center h-32 relative ${
              selectedId === file.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
            }`}
          >
            <div className="text-3xl mb-2">📄</div>
            <div className="text-sm font-medium text-center truncate w-full">{file.name}</div>
            <div className="text-xs text-gray-500">{file.size}</div>
            
            {/* Context Menu Placeholder */}
            {selectedId === file.id && (
              <div className="absolute top-2 right-2 p-1 hover:bg-gray-200 rounded">
                ⋮
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

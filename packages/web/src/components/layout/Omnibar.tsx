import React, { useState, useEffect, useRef } from 'react';
import { Search, SlidersHorizontal, File, Folder } from 'lucide-react';
import { api } from '../../lib/api';
import type { FileEntry } from '../../types';

export const Omnibar: React.FC = () => {
  const [query, setQuery] = useState('');
  const [metadataKey, setMetadataKey] = useState('');
  const [metadataValue, setMetadataValue] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [results, setResults] = useState<FileEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (!query.trim() && !metadataKey.trim()) {
        setResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const metadata = metadataKey && metadataValue ? { [metadataKey]: metadataValue } : undefined;
        const res = await api.globalSearch(query, undefined, metadata);
        setResults(res.files);
        setIsOpen(true);
      } catch (err) {
        console.error('Search failed', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query, metadataKey, metadataValue]);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="bg-surface border border-stone-300/60 hover:bg-card hover:shadow-md hover:border-stone-300 focus-within:bg-card focus-within:shadow-md focus-within:border-stone-300 rounded-full h-12 flex items-center px-4 transition-all">
        <Search size={20} className="text-stone-600 mr-3" />
        <input 
          type="text" 
          placeholder="Search OmniDrive" 
          className="bg-transparent outline-none w-full text-stone-800 placeholder-gray-600" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
        />
        <button 
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`p-1.5 rounded-full hover:bg-stone-100 ${showAdvanced ? 'text-blue-600' : 'text-stone-600'}`}
        >
          <SlidersHorizontal size={20} />
        </button>
      </div>

      {showAdvanced && (
        <div className="absolute top-14 left-0 right-0 bg-card shadow-lg border border-stone-200 rounded-lg p-4 z-50 flex gap-2 animate-in fade-in-0 slide-in-from-top-2 duration-200">
          <input 
            type="text" 
            placeholder="Metadata Key (e.g. Status)" 
            className="border border-stone-300 rounded px-3 py-1.5 text-sm flex-1"
            value={metadataKey}
            onChange={(e) => setMetadataKey(e.target.value)}
          />
          <input 
            type="text" 
            placeholder="Metadata Value (e.g. Approved)" 
            className="border border-stone-300 rounded px-3 py-1.5 text-sm flex-1"
            value={metadataValue}
            onChange={(e) => setMetadataValue(e.target.value)}
          />
        </div>
      )}

      {isOpen && (query || metadataKey) && (
        <div className="absolute top-14 left-0 right-0 bg-card shadow-lg border border-stone-200 rounded-lg max-h-96 overflow-y-auto z-40 animate-in fade-in-0 slide-in-from-top-2 duration-200">
          {isSearching ? (
            <div className="p-4 text-center text-sm text-stone-500">Searching...</div>
          ) : results.length > 0 ? (
            <div className="py-2">
              {results.map((file) => (
                <div key={file.id} className="px-4 py-2 hover:bg-stone-50 flex items-center gap-3 cursor-pointer">
                  {file.workspaceId ? <Folder size={18} className="text-blue-500" /> : <File size={18} className="text-stone-500" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">{file.name}</p>
                    <p className="text-xs text-stone-500 truncate">
                      {file.workspaceId ? 'Workspace' : 'Personal'} • {file.metadata ? 'Has Tags' : 'No Tags'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-stone-500">No results found</div>
          )}
        </div>
      )}
    </div>
  );
};

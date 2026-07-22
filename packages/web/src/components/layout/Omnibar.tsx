import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, SlidersHorizontal, File, Folder } from 'lucide-react';
import { api } from '../../lib/api';
import type { FileEntry, WorkspaceFolder, DriveFolder } from '../../types';

export const Omnibar: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [metadataKey, setMetadataKey] = useState('');
  const [metadataValue, setMetadataValue] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fileResults, setFileResults] = useState<FileEntry[]>([]);
  const [folderResults, setFolderResults] = useState<WorkspaceFolder[]>([]);
  const [driveFolderResults, setDriveFolderResults] = useState<DriveFolder[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const hasResults = fileResults.length > 0 || folderResults.length > 0 || driveFolderResults.length > 0;

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
        setFileResults([]);
        setFolderResults([]);
        setDriveFolderResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const metadata = metadataKey && metadataValue ? { [metadataKey]: metadataValue } : undefined;
        const res = await api.globalSearch(query, undefined, metadata);
        setFileResults(res.files);
        setFolderResults(res.folders ?? []);
        setDriveFolderResults(res.driveFolders ?? []);
        setIsOpen(true);
      } catch (err) {
        console.error('Search failed', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query, metadataKey, metadataValue]);

  const handleFileClick = (file: FileEntry) => {
    setIsOpen(false);
    // Navigate to the file's parent folder so the user sees it in context
    if (file.workspaceId) {
      navigate(`/files/${file.workspaceId}`);
    } else if (file.googleParentId) {
      navigate(`/files/${file.googleParentId}?driveId=${file.driveAccountId}`);
    } else {
      navigate('/files/root');
    }
  };

  const handleDriveFolderClick = (folder: DriveFolder) => {
    setIsOpen(false);
    navigate(`/files/${folder.googleFolderId}?driveId=${folder.driveAccountId || folder.driveId}`);
  };

  const handleWorkspaceFolderClick = (folder: WorkspaceFolder) => {
    setIsOpen(false);
    navigate(`/files/${folder.id}`);
  };

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
          onFocus={() => { if (hasResults) setIsOpen(true); }}
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
          ) : hasResults ? (
            <div className="py-2">
              {(folderResults.length > 0 || driveFolderResults.length > 0) && (
                <>
                  <div className="px-4 py-1.5 text-xs font-semibold text-stone-400 uppercase tracking-wide">Folders</div>
                  {driveFolderResults.map((folder) => (
                    <button
                      key={`df-${folder.googleFolderId}`}
                      onClick={() => handleDriveFolderClick(folder)}
                      className="w-full px-4 py-2 hover:bg-stone-50 flex items-center gap-3 text-left"
                    >
                      <Folder size={18} className="text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-800 truncate">{folder.name}</p>
                        <p className="text-xs text-stone-500 truncate">{folder.driveEmail ?? 'Drive folder'}</p>
                      </div>
                    </button>
                  ))}
                  {folderResults.map((folder) => (
                    <button
                      key={`wf-${folder.id}`}
                      onClick={() => handleWorkspaceFolderClick(folder)}
                      className="w-full px-4 py-2 hover:bg-stone-50 flex items-center gap-3 text-left"
                    >
                      <Folder size={18} className="text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-800 truncate">{folder.name}</p>
                        <p className="text-xs text-stone-500 truncate">Workspace folder</p>
                      </div>
                    </button>
                  ))}
                </>
              )}
              {fileResults.length > 0 && (
                <>
                  <div className="px-4 py-1.5 text-xs font-semibold text-stone-400 uppercase tracking-wide">Files</div>
                  {fileResults.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => handleFileClick(file)}
                      className="w-full px-4 py-2 hover:bg-stone-50 flex items-center gap-3 text-left"
                    >
                      <File size={18} className="text-stone-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-800 truncate">{file.name}</p>
                        <p className="text-xs text-stone-500 truncate">
                          {file.driveEmail ?? (file.workspaceId ? 'Workspace' : 'Personal')}
                        </p>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-stone-500">No results found</div>
          )}
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, SlidersHorizontal, File, Folder } from 'lucide-react';
import { filesApi } from '../../lib/api/files';
import type { FileEntry, WorkspaceFolder, DriveFolder } from '../../types';
import { Button } from '../ui/Button';
import { isDriveFolder, isWorkspaceFolder } from '../files/utils';

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

  const hasResults =
    fileResults.length > 0 || folderResults.length > 0 || driveFolderResults.length > 0;

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
    // One controller per effect run — cleanup aborts the in-flight request so
    // a slow earlier query can't overwrite results from a newer one.
    const controller = new AbortController();
    const delayDebounceFn = setTimeout(async () => {
      if (!query.trim() && !metadataKey.trim()) {
        setFileResults([]);
        setFolderResults([]);
        setDriveFolderResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const metadata =
          metadataKey && metadataValue ? { [metadataKey]: metadataValue } : undefined;
        const res = await filesApi.globalSearch(query, undefined, metadata, controller.signal);
        setFileResults(res.files);
        const subfolders = res.subfolders ?? [];
        setFolderResults(subfolders.filter(isWorkspaceFolder));
        setDriveFolderResults(subfolders.filter(isDriveFolder));
        setIsOpen(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('Search failed', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(delayDebounceFn);
    };
  }, [query, metadataKey, metadataValue]);

  const handleFileClick = (file: FileEntry) => {
    setIsOpen(false);
    // Navigate to the file's parent folder so the user sees it in context.
    // workspaceId is a workspace UUID (not a folder ID) — don't use it as a route param.
    if (file.googleParentId) {
      navigate(`/files/${file.googleParentId}?driveId=${file.driveAccountId}`);
    } else {
      navigate('/files/root');
    }
  };

  const handleDriveFolderClick = (folder: DriveFolder) => {
    setIsOpen(false);
    navigate(`/files/${folder.googleFolderId}?driveId=${folder.driveAccountId || folder.driveId}`);
  };

  const handleWorkspaceFolderClick = (_folder: WorkspaceFolder) => {
    setIsOpen(false);
    // Workspace folders are browsed via the Workspaces page, not /files
    // (folder.id is a workspace_folders UUID, not a Google Drive folder ID).
    navigate('/workspaces');
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="bg-surface border border-slate-400/60 hover:bg-card hover:shadow-md hover:border-slate-400 focus-within:bg-card focus-within:shadow-md focus-within:border-slate-400 rounded-full h-12 flex items-center px-4 transition-all">
        <Search size={20} className="text-slate-600 mr-3" />
        <input
          type="text"
          placeholder="Search OmniDrive"
          className="bg-transparent outline-none w-full text-slate-800 placeholder-slate-600"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (hasResults) setIsOpen(true);
          }}
        />
        <Button
          onClick={() => setShowAdvanced(!showAdvanced)}
          variant="ghost"
          className={`p-1.5 rounded-full ${showAdvanced ? 'text-primary' : 'text-slate-600'}`}
          aria-label="Toggle advanced search"
        >
          <SlidersHorizontal size={20} />
        </Button>
      </div>

      {showAdvanced && (
        <div className="absolute top-14 left-0 right-0 bg-card shadow-lg border border-slate-200 rounded-lg p-4 z-50 flex gap-2 animate-in fade-in-0 slide-in-from-top-2 duration-200">
          <input
            type="text"
            placeholder="Metadata Key (e.g. Status)"
            className="border border-slate-400 rounded px-3 py-1.5 text-sm flex-1"
            value={metadataKey}
            onChange={(e) => setMetadataKey(e.target.value)}
          />
          <input
            type="text"
            placeholder="Metadata Value (e.g. Approved)"
            className="border border-slate-400 rounded px-3 py-1.5 text-sm flex-1"
            value={metadataValue}
            onChange={(e) => setMetadataValue(e.target.value)}
          />
        </div>
      )}

      {isOpen && (query || metadataKey) && (
        <div className="absolute top-14 left-0 right-0 bg-card shadow-lg border border-slate-200 rounded-lg max-h-96 overflow-y-auto z-40 animate-in fade-in-0 slide-in-from-top-2 duration-200">
          {isSearching ? (
            <div className="p-4 text-center text-sm text-slate-500">Searching...</div>
          ) : hasResults ? (
            <div className="py-2">
              {(folderResults.length > 0 || driveFolderResults.length > 0) && (
                <>
                  <div className="px-4 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Folders
                  </div>
                  {driveFolderResults.map((folder) => (
                    <button
                      key={`df-${folder.googleFolderId}`}
                      onClick={() => handleDriveFolderClick(folder)}
                      className="w-full px-4 py-2 hover:bg-slate-50 flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <Folder size={18} className="text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{folder.name}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {folder.driveEmail ?? 'Drive folder'}
                        </p>
                      </div>
                    </button>
                  ))}
                  {folderResults.map((folder) => (
                    <button
                      key={`wf-${folder.id}`}
                      onClick={() => handleWorkspaceFolderClick(folder)}
                      className="w-full px-4 py-2 hover:bg-slate-50 flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <Folder size={18} className="text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{folder.name}</p>
                        <p className="text-xs text-slate-500 truncate">Workspace folder</p>
                      </div>
                    </button>
                  ))}
                </>
              )}
              {fileResults.length > 0 && (
                <>
                  <div className="px-4 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Files
                  </div>
                  {fileResults.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => handleFileClick(file)}
                      className="w-full px-4 py-2 hover:bg-slate-50 flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <File size={18} className="text-slate-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{file.name}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {file.driveEmail ?? (file.workspaceId ? 'Workspace' : 'Personal')}
                        </p>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-slate-500">No results found</div>
          )}
          <div className="border-t border-slate-200 p-2">
            <button
              onClick={() => {
                const params = new URLSearchParams();
                if (query) params.set('q', query);
                if (metadataKey) params.set('metadataKey', metadataKey);
                if (metadataValue) params.set('metadataValue', metadataValue);
                navigate(`/search?${params.toString()}`);
                setIsOpen(false);
              }}
              className="w-full text-center text-sm text-primary hover:underline py-1"
            >
              View all results
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

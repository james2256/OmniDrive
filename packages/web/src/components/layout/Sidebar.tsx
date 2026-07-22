import React, { useEffect } from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { NavLink, useLocation } from 'react-router-dom';
import {
  HardDrive,
  Users,
  Trash2,
  Settings,
  Star,
  FolderTree,
  UserCog,
  Home,
  FolderInput,
} from 'lucide-react';
import { SidebarStorage } from './SidebarStorage';
import pkg from '../../../../../package.json';

export const Sidebar: React.FC = () => {
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const mobileSidebarOpen = useUIStore((state) => state.mobileSidebarOpen);
  const setMobileSidebarOpen = useUIStore((state) => state.setMobileSidebarOpen);
  const { user } = useAuthStore();
  const location = useLocation();

  // Auto-close mobile drawer on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname, setMobileSidebarOpen]);

  // Padding stays identical in both states so icons never shift position;
  // the aside just clips/reveals the fixed-width content like a curtain.
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-full cursor-pointer transition-colors text-sm ${
      isActive ? 'bg-blue-100 text-slate-900 font-medium' : 'hover:bg-slate-100 text-slate-700'
    }`;

  const navContent = (
    <div className="w-64 h-full flex flex-col p-3 gap-1 overflow-y-auto">
      {/* Navigation */}
      <nav className="flex flex-col gap-0.5">
        <NavLink to="/" end className={navLinkClass}>
          <Home size={20} />
          {isSidebarOpen && <span>Home</span>}
        </NavLink>
        <NavLink to="/files/root" className={navLinkClass}>
          <HardDrive size={20} />
          {isSidebarOpen && <span>My Drive</span>}
        </NavLink>
        <NavLink to="/shared-with-me" className={navLinkClass}>
          <FolderInput size={20} />
          {isSidebarOpen && <span>Shared with me</span>}
        </NavLink>
        <NavLink to="/starred" className={navLinkClass}>
          <Star size={20} />
          {isSidebarOpen && <span>Starred</span>}
        </NavLink>
        <NavLink to="/shared" className={navLinkClass}>
          <Users size={20} />
          {isSidebarOpen && <span>Shared links</span>}
        </NavLink>
        <NavLink to="/workspaces" className={navLinkClass}>
          <FolderTree size={20} />
          {isSidebarOpen && <span>Workspaces</span>}
        </NavLink>
        <NavLink to="/trash" className={navLinkClass}>
          <Trash2 size={20} />
          {isSidebarOpen && <span>Trash</span>}
        </NavLink>
        {user?.role === 'super_admin' && (
          <NavLink to="/admin/users" className={navLinkClass}>
            <UserCog size={20} />
            {isSidebarOpen && <span>Users</span>}
          </NavLink>
        )}
        <NavLink to="/settings" className={navLinkClass}>
          <Settings size={20} />
          {isSidebarOpen && <span>Settings</span>}
        </NavLink>
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Storage quota — hidden in collapsed rail */}
      {isSidebarOpen && <SidebarStorage />}

      {/* Version and Links */}
      <div className="mt-4 px-3 flex items-center justify-between text-xs text-slate-500">
        <a
          href={pkg.repository.url.replace('.git', '')}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-slate-600 transition-colors"
        >
          <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          {isSidebarOpen && <span>GitHub</span>}
        </a>
        {isSidebarOpen && <span>v{pkg.version}</span>}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay — always mounted, fade via opacity so it animates */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ease-in-out ${
          mobileSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileSidebarOpen(false)}
        aria-hidden
      />
      <aside
        className={`bg-surface h-full flex-shrink-0 overflow-hidden z-50 fixed left-0 top-16 bottom-0 w-64 shadow-xl transition-transform duration-300 ease-in-out md:relative md:top-0 md:bottom-0 md:left-0 md:shadow-none md:transition-[width] md:translate-x-0 ${
          // Mobile: slide via translate-x; Desktop: inline width collapse (md overrides)
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isSidebarOpen ? 'md:w-64' : 'md:w-16'}`}
        aria-label="Main navigation"
      >
        {navContent}
      </aside>
    </>
  );
};

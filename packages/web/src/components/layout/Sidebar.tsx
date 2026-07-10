import React, { useEffect } from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/authStore';
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
  Github,
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
      isActive ? 'bg-blue-100 text-stone-900 font-medium' : 'hover:bg-stone-100 text-stone-700'
    }`;

  const navContent = (
    <div className="w-64 h-full flex flex-col p-3 gap-1">
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
        <NavLink to="/starred" className={navLinkClass}>
          <Star size={20} />
          {isSidebarOpen && <span>Starred</span>}
        </NavLink>
        <NavLink to="/shared" className={navLinkClass}>
          <Users size={20} />
          {isSidebarOpen && <span>Shared</span>}
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
      <div className="mt-4 px-3 flex items-center justify-between text-xs text-stone-400">
        <a
          href={pkg.repository.url.replace('.git', '')}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-stone-600 transition-colors"
        >
          <Github size={14} />
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

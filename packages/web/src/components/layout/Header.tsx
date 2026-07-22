import React from 'react';
import { Menu, LogOut } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Omnibar } from './Omnibar';

export const Header: React.FC = () => {
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const toggleMobileSidebar = useUIStore((state) => state.toggleMobileSidebar);
  const { user, logout } = useAuthStore();

  const getInitials = (name: string) => name ? name.charAt(0).toUpperCase() : 'U';

  return (
    <header className="flex items-center justify-between px-2 py-2 bg-surface h-16 w-full gap-2 sm:gap-4">
      <div className="flex items-center min-w-0 px-2 gap-3 sm:gap-4">
        {/* Mobile: drawer toggle; Desktop: collapse rail */}
        <button
          onClick={toggleMobileSidebar}
          className="md:hidden p-2 hover:bg-slate-200 rounded-full text-slate-700 transition-colors flex-shrink-0"
          aria-label="Open menu"
        >
          <Menu size={24} />
        </button>
        <button
          onClick={toggleSidebar}
          className="hidden md:flex p-2 hover:bg-slate-200 rounded-full text-slate-700 transition-colors flex-shrink-0"
          aria-label="Toggle sidebar"
        >
          <Menu size={24} />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo.png?v=2" alt="OmniDrive" className="w-8 h-8 object-contain flex-shrink-0" />
          <span className="text-xl text-slate-700 font-medium tracking-wide hidden sm:inline">OmniDrive</span>
        </div>
      </div>

      {/* Omnibar: flex-1 fills remaining; hidden on very small screens to avoid overflow */}
      <div className="hidden sm:block flex-1 min-w-0 max-w-[720px]">
        <Omnibar />
      </div>

      <div className="flex items-center gap-2 px-1 sm:px-2 text-slate-600 flex-shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-medium cursor-pointer hover:bg-blue-700 select-none overflow-hidden flex-shrink-0"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span aria-hidden="true">{getInitials(user?.name || 'User')}</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-card shadow-xl rounded-xl border border-slate-200">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1 py-1">
                <p className="text-sm font-medium leading-none text-slate-800">{user?.name || 'User'}</p>
                <p className="text-xs leading-none text-slate-500">{user?.email || 'user@example.com'}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-slate-200" />
            <DropdownMenuItem
              className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50"
              onClick={() => logout()}
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, Settings, HelpCircle, Grid3X3, LogOut } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { useToastStore } from '../../stores/toastStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export const Header: React.FC = () => {
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { addToast } = useToastStore();

  const handlePlaceholderClick = () => {
    addToast('info', 'Coming soon!');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim()).replace(/%20/g, '+')}`);
    }
  };

  return (
    <header className="flex items-center justify-between px-2 py-2 bg-surface h-16 w-full gap-4">
      <div className="flex items-center min-w-[240px] px-2 gap-4">
        <button 
          onClick={toggleSidebar}
          className="p-2 hover:bg-gray-200 rounded-full text-gray-700 transition-colors"
        >
          <Menu size={24} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-sm bg-gradient-to-br from-blue-500 to-green-500 flex-shrink-0 opacity-90" />
          <span className="text-xl text-gray-700 font-medium tracking-wide">OmniDrive</span>
        </div>
      </div>
      
      <div className="flex-1 max-w-[720px]">
        <div className="bg-[#e9eef6] hover:bg-white hover:shadow-md focus-within:bg-white focus-within:shadow-md rounded-full h-12 flex items-center px-4 transition-all">
          <Search size={20} className="text-gray-600 mr-3" />
          <input 
            type="text" 
            placeholder="Search in Drive" 
            className="bg-transparent outline-none w-full text-gray-800 placeholder-gray-600" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
      
      <div className="flex items-center gap-2 px-2 text-gray-600">
        <button onClick={handlePlaceholderClick} className="p-2 hover:bg-gray-200 rounded-full transition-colors hidden sm:block">
          <HelpCircle size={24} />
        </button>
        <button onClick={handlePlaceholderClick} className="p-2 hover:bg-gray-200 rounded-full transition-colors hidden sm:block">
          <Settings size={24} />
        </button>
        <button onClick={handlePlaceholderClick} className="p-2 hover:bg-gray-200 rounded-full transition-colors hidden sm:block mr-2">
          <Grid3X3 size={24} />
        </button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-medium cursor-pointer hover:bg-blue-700 select-none">
              U
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-white shadow-xl rounded-xl border border-gray-200">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1 py-1">
                <p className="text-sm font-medium leading-none text-gray-800">User</p>
                <p className="text-xs leading-none text-gray-500">user@example.com</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-gray-200" />
            <DropdownMenuItem className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

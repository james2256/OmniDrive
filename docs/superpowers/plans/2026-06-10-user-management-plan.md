# User & Team Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement global Admin User Management and fix the Header avatar/dropdown.

**Architecture:** We will extend the `User` type, update the global `Header` component to render the authenticated user's profile, conditionally display an "Admin Users" link in `Sidebar`, and create a new `AdminUsersPage` alongside an `InviteUserModal` to manage users. This new page will reside within the existing `AppLayout`.

**Tech Stack:** React, Zustand (`useAuthStore`), React Router, Tailwind CSS, Lucide React icons.

---

### Task 1: Update Data Model and Header Component

**Files:**
- Modify: `packages/web/src/types/index.ts:1-10`
- Modify: `packages/web/src/components/layout/Header.tsx`

- [ ] **Step 1: Add role and status to User interface**
Modify `packages/web/src/types/index.ts` to add `role` and `status` to the `User` interface.

```typescript
export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role?: 'admin' | 'user';
  status?: 'active' | 'blocked';
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Update Header to use AuthStore**
Modify `packages/web/src/components/layout/Header.tsx`. Replace the hardcoded "U" and "User" / "user@example.com" with data from `user`.

```tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, LogOut } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/authStore';
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
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
      navigate(`/search?q=${encodeURIComponent(e.currentTarget.value.trim()).replace(/%20/g, '+')}`);
    }
  };

  const getInitials = (name: string) => name ? name.charAt(0).toUpperCase() : 'U';

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
      
      <Omnibar />
      
      <div className="flex items-center gap-2 px-2 text-gray-600">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-medium cursor-pointer hover:bg-blue-700 select-none overflow-hidden">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <span>{getInitials(user?.name || 'User')}</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-white shadow-xl rounded-xl border border-gray-200">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1 py-1">
                <p className="text-sm font-medium leading-none text-gray-800">{user?.name || 'User'}</p>
                <p className="text-xs leading-none text-gray-500">{user?.email || 'user@example.com'}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-gray-200" />
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
```

- [ ] **Step 3: Commit**

```bash
rtk git add packages/web/src/types/index.ts packages/web/src/components/layout/Header.tsx
rtk git commit -m "feat: add user role and status, fix header avatar"
```

### Task 2: Create Invite User Modal Component

**Files:**
- Create: `packages/web/src/components/admin/InviteUserModal.tsx`

- [ ] **Step 1: Create the Modal Component**
Create `packages/web/src/components/admin/InviteUserModal.tsx` to handle user invitations.

```tsx
import React, { useState } from 'react';
import { X } from 'lucide-react';

interface InviteUserModalProps {
  onClose: () => void;
  onSubmit: (email: string, role: 'admin' | 'user') => void;
}

export const InviteUserModal: React.FC<InviteUserModalProps> = ({ onClose, onSubmit }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      onSubmit(email.trim(), role);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-medium text-gray-900">Invite User</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-500">
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="user@example.com"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
            >
              Send Invite
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
rtk git add packages/web/src/components/admin/InviteUserModal.tsx
rtk git commit -m "feat: create invite user modal"
```

### Task 3: Create Admin Users Page

**Files:**
- Create: `packages/web/src/pages/AdminUsersPage.tsx`

- [ ] **Step 1: Create AdminUsersPage.tsx**
Create the page component to display the users table and use the modal.

```tsx
import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Navigate } from 'react-router-dom';
import { ShieldAlert, Plus, MoreVertical } from 'lucide-react';
import type { User } from '../types';
import { InviteUserModal } from '../components/admin/InviteUserModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

export const AdminUsersPage: React.FC = () => {
  const { user } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  // In a real app, this would be an API call. For now, we mock some users.
  useEffect(() => {
    setUsers([
      {
        id: '1', googleId: 'g1', email: 'admin@omnidrive.com', name: 'Admin One', 
        avatarUrl: null, role: 'admin', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      },
      {
        id: '2', googleId: 'g2', email: 'user@omnidrive.com', name: 'User Two', 
        avatarUrl: null, role: 'user', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
    ]);
  }, []);

  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <ShieldAlert size={48} className="text-red-400 mb-4" />
        <h2 className="text-xl font-medium text-gray-800">Access Denied</h2>
        <p className="mt-2">You do not have permission to view this page.</p>
      </div>
    );
  }

  const handleInvite = (email: string, role: 'admin' | 'user') => {
    console.log('Inviting', email, role);
    setIsInviteModalOpen(false);
  };

  const handleToggleStatus = (id: string, currentStatus: 'active' | 'blocked' | undefined) => {
    const newStatus = currentStatus === 'blocked' ? 'active' : 'blocked';
    setUsers(users.map(u => u.id === id ? { ...u, status: newStatus } : u));
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this user?')) {
      setUsers(users.filter(u => u.id !== id));
    }
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-800">User Management</h1>
        <button
          onClick={() => setIsInviteModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} />
          <span>Invite User</span>
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Role</th>
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium overflow-hidden">
                      {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" /> : u.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-gray-900">{u.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{u.email}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
                    {u.role || 'user'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${u.status === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                    {u.status || 'active'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 hover:bg-gray-200 rounded text-gray-500">
                        <MoreVertical size={16} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-white shadow-xl rounded-xl border border-gray-200 w-40">
                      <DropdownMenuItem className="cursor-pointer" onClick={() => handleToggleStatus(u.id, u.status)}>
                        {u.status === 'blocked' ? 'Unblock User' : 'Block User'}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50" onClick={() => handleDelete(u.id)}>
                        Delete User
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isInviteModalOpen && (
        <InviteUserModal onClose={() => setIsInviteModalOpen(false)} onSubmit={handleInvite} />
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
rtk git add packages/web/src/pages/AdminUsersPage.tsx
rtk git commit -m "feat: create admin users page"
```

### Task 4: Configure Routing and Navigation

**Files:**
- Modify: `packages/web/src/components/layout/Sidebar.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Add Link to Sidebar**
Modify `packages/web/src/components/layout/Sidebar.tsx`. Add a `Shield` icon import and the conditionally rendered navigation link.

```tsx
import React from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { useUploadStore } from '../../stores/uploadStore';
import { useDriveStore } from '../../stores/driveStore';
import { useAuthStore } from '../../stores/authStore';
import { NavLink } from 'react-router-dom';
import {
  HardDrive,
  Monitor,
  Users,
  Trash2,
  Plus,
  Settings,
  Clock,
  Star,
  FolderTree,
  Shield,
} from 'lucide-react';
import { formatFileSize } from '../../lib/utils';

export const Sidebar: React.FC = () => {
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const setShowModal = useUploadStore((state) => state.setShowModal);
  const { aggregate } = useDriveStore();
  const { user } = useAuthStore();

  if (!isSidebarOpen) return null;

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2 rounded-full cursor-pointer transition-colors text-sm ${
      isActive ? 'bg-[#c2e7ff] text-gray-900 font-medium' : 'hover:bg-gray-100 text-gray-700'
    }`;

  const pct = aggregate.totalQuota > 0
    ? Math.min((aggregate.totalUsed / aggregate.totalQuota) * 100, 100)
    : 0;

  return (
    <aside className="w-64 bg-surface h-full flex flex-col p-3 gap-1 flex-shrink-0">
      {/* New button */}
      <div className="px-1 py-2 mb-1">
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-3 bg-white text-gray-700 rounded-2xl px-5 py-3.5 shadow-sm w-max hover:shadow-md hover:bg-gray-50 transition-all font-medium ml-1 text-sm"
        >
          <Plus size={20} className="text-primary" />
          New
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5">
        <NavLink to="/files/root" className={navLinkClass}>
          <HardDrive size={20} />
          <span>My Drive</span>
        </NavLink>
        <NavLink to="/" end className={navLinkClass}>
          <Clock size={20} />
          <span>Recent</span>
        </NavLink>
        <NavLink to="/starred" className={navLinkClass}>
          <Star size={20} />
          <span>Starred</span>
        </NavLink>
        <NavLink to="/shared" className={navLinkClass}>
          <Users size={20} />
          <span>Shared</span>
        </NavLink>
        <div className="flex items-center gap-3 px-4 py-2 hover:bg-gray-100 rounded-full cursor-pointer text-gray-700 text-sm">
          <Monitor size={20} />
          <span>Computers</span>
        </div>
        <NavLink to="/workspaces" className={navLinkClass}>
          <FolderTree size={20} />
          <span>Workspaces</span>
        </NavLink>
        <NavLink to="/trash" className={navLinkClass}>
          <Trash2 size={20} />
          <span>Trash</span>
        </NavLink>
        {user?.role === 'admin' && (
          <NavLink to="/admin/users" className={navLinkClass}>
            <Shield size={20} />
            <span>User Management</span>
          </NavLink>
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings link */}
      <NavLink to="/settings" className={navLinkClass}>
        <Settings size={20} />
        <span>Settings</span>
      </NavLink>

      {/* Storage quota */}
      {aggregate.totalQuota > 0 && (
        <div className="px-4 py-3 mt-1">
          <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden mb-2">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">
            {formatFileSize(aggregate.totalUsed)} of {formatFileSize(aggregate.totalQuota)} used
          </p>
          <NavLink
            to="/settings"
            className="text-xs text-blue-600 hover:underline mt-1 block"
          >
            Manage storage
          </NavLink>
        </div>
      )}
    </aside>
  );
};
```

- [ ] **Step 2: Add Route to App.tsx**
Modify `packages/web/src/App.tsx`. Import `AdminUsersPage` and add it to the `<Routes>`.

```tsx
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from './components/AuthGuard';
import { AppLayout } from './components/layout/AppLayout';
import { ToastContainer } from './components/Toast';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { FilesPage } from './pages/FilesPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharedLinksPage } from './pages/SharedLinksPage';
import { PublicSharedPage } from './pages/PublicSharedPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { SearchPage } from './pages/SearchPage';
import { TrashPage } from './pages/TrashPage';
import { StarredPage } from './pages/StarredPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { SetupPage } from './pages/SetupPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { api } from './lib/api';

export const App = () => {
  const [isSetup, setIsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    api.getSetupStatus().then(res => setIsSetup(res.isSetup)).catch(() => setIsSetup(true));
  }, []);

  if (isSetup === null) return null; // loading state

  if (isSetup === false && window.location.pathname !== '/setup') {
    window.location.href = '/setup';
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/setup" element={isSetup ? <Navigate to="/login" /> : <SetupPage />} />
        <Route path="/login" element={!isSetup ? <Navigate to="/setup" /> : <LoginPage />} />
        <Route path="/shared/:id" element={<PublicSharedPage />} />
        <Route
          element={
            <AuthGuard>
              <AppLayout />
              <ToastContainer />
            </AuthGuard>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/files/:folderId" element={<FilesPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/settings/drives" element={<SettingsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/shared" element={<SharedLinksPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/starred" element={<StarredPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
```

- [ ] **Step 3: Commit**

```bash
rtk git add packages/web/src/components/layout/Sidebar.tsx packages/web/src/App.tsx
rtk git commit -m "feat: add admin users route and sidebar link"
```

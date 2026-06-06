import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, FolderOpen, Settings, Plus } from 'lucide-react';
import { useDriveStore } from '../stores/driveStore';
import { useAuthStore } from '../stores/authStore';
import { QuotaBar } from './QuotaBar';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { useEffect } from 'react';

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const { drives, aggregate, fetchDrives } = useDriveStore();
  const location = useLocation();

  useEffect(() => {
    fetchDrives();
  }, [fetchDrives]);

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <span className="sidebar-logo-icon">🔷</span>
        <span className="sidebar-logo-text">Omnidrive</span>
      </div>

      {/* Nav Links */}
      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/files" className={() => `sidebar-link ${location.pathname.startsWith('/files') ? 'active' : ''}`}>
          <FolderOpen size={18} />
          <span>Files</span>
        </NavLink>
        <NavLink to="/settings/drives" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
      </nav>

      {/* Aggregate Quota */}
      {aggregate.driveCount > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-title">Total Storage</div>
          <QuotaBar used={aggregate.totalUsed} total={aggregate.totalQuota} />
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginTop: 4 }}>
            {formatFileSize(aggregate.totalFree)} free across {aggregate.driveCount} drive{aggregate.driveCount > 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Connected Drives */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Drives</div>
        <div className="sidebar-drives">
          {drives.map((drive, i) => (
            <div key={drive.id} className="sidebar-drive-item">
              <div className="drive-dot" style={{ backgroundColor: getDriveColor(i) }} />
              <span className="truncate" style={{ fontSize: 'var(--font-size-sm)' }}>{drive.email}</span>
            </div>
          ))}
          <a href="/api/drives/connect" className="sidebar-link add-drive">
            <Plus size={16} />
            <span>Add Drive</span>
          </a>
        </div>
      </div>

      {/* User */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name} className="sidebar-avatar" referrerPolicy="no-referrer" />
          ) : (
            <div className="sidebar-avatar-placeholder">{user?.name?.[0] ?? '?'}</div>
          )}
          <div className="truncate" style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{user?.name}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{user?.email}</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
      </div>

      <style>{sidebarStyles}</style>
    </aside>
  );
}

const sidebarStyles = `
  .sidebar {
    width: var(--sidebar-width);
    height: 100vh;
    position: fixed;
    left: 0;
    top: 0;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    padding: var(--space-md);
    overflow-y: auto;
  }

  .sidebar-logo {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-sm);
    margin-bottom: var(--space-lg);
  }

  .sidebar-logo-icon { font-size: 1.5rem; }
  .sidebar-logo-text { font-size: var(--font-size-lg); font-weight: 700; }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: var(--space-lg);
  }

  .sidebar-link {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: var(--font-size-base);
    transition: all var(--transition-fast);
    text-decoration: none;
  }

  .sidebar-link:hover { background: var(--bg-hover); color: var(--text-primary); }
  .sidebar-link.active { background: var(--accent-primary-subtle); color: var(--accent-primary-hover); }

  .sidebar-section {
    padding: var(--space-md) var(--space-sm);
    border-top: 1px solid var(--border-subtle);
  }

  .sidebar-section-title {
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-tertiary);
    letter-spacing: 0.05em;
    margin-bottom: var(--space-sm);
  }

  .sidebar-drives { display: flex; flex-direction: column; gap: 4px; }

  .sidebar-drive-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-xs) var(--space-sm);
    color: var(--text-secondary);
  }

  .add-drive { margin-top: var(--space-xs); }

  .sidebar-footer {
    margin-top: auto;
    padding-top: var(--space-md);
    border-top: 1px solid var(--border-subtle);
  }

  .sidebar-user {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm);
    margin-bottom: var(--space-sm);
  }

  .sidebar-avatar {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
  }

  .sidebar-avatar-placeholder {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--accent-primary-subtle);
    color: var(--accent-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: var(--font-size-sm);
  }
`;

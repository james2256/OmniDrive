import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useToastStore } from '../stores/useToastStore';
import { ShieldAlert, Plus, EllipsisVertical, UserPlus, UserCog } from 'lucide-react';
import type { AdminUser } from '../types';
import { adminApi } from '../lib/api/admin';
import type { Invitation } from '../types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../components/ui/dropdown-menu';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ListSkeleton } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';

const AddUserModal: React.FC<{ open: boolean; onClose: () => void; onSuccess: () => void }> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'super_admin' | 'member'>('member');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await adminApi.adminCreateUser({
        username: username.trim(),
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        password,
        role,
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader icon={<UserPlus size={20} className="text-primary" />}>
          <DialogTitle>Add User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <DialogBody>
            {error && (
              <div className="mb-3 text-sm text-red-600 bg-red-50 p-2 rounded-lg border border-red-100">
                {error}
              </div>
            )}
            <div className="space-y-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Username *</label>
                <Input required value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Password *</label>
                <Input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'super_admin' | 'member')}
                  className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-xl text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus:border-primary transition-shadow"
                >
                  <option value="member">Member</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const AdminUsersPage: React.FC = () => {
  const { user } = useAuthStore();
  const { addToast } = useToastStore();
  const [activeTab, setActiveTab] = useState<'users' | 'invitations'>('users');

  // Users Tab State
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [invitationToDelete, setInvitationToDelete] = useState<string | null>(null);
  const [isDeletingInvitation, setIsDeletingInvitation] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // User management action state (role / status / delete)
  const [roleTarget, setRoleTarget] = useState<{
    id: string;
    role: 'super_admin' | 'member';
    name: string;
  } | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    id: string;
    status: 'active' | 'blocked';
    name: string;
  } | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [isChangingRole, setIsChangingRole] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Invitations Tab State
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteMaxUses, setInviteMaxUses] = useState(1);

  const loadUsers = useCallback(async () => {
    setIsLoadingUsers(true);
    setUsersError(false);
    try {
      const res = await adminApi.getAdminUsers();
      setUsers(res.users);
    } catch (e: unknown) {
      setUsersError(true);
      addToast('error', 'Failed to load users');
      console.error(e);
    } finally {
      setIsLoadingUsers(false);
    }
  }, [addToast]);

  const loadInvitations = useCallback(async () => {
    try {
      const res = await adminApi.getInvitations();
      setInvitations(res.invitations);
    } catch (e: unknown) {
      addToast('error', 'Failed to load invitations');
      console.error(e);
    }
  }, [addToast]);

  useEffect(() => {
    if (user?.role === 'super_admin') {
      if (activeTab === 'users') {
        loadUsers();
      } else {
        loadInvitations();
      }
    }
  }, [user, activeTab, loadUsers, loadInvitations]);

  if (user?.role !== 'super_admin') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500">
        <ShieldAlert size={48} className="text-red-400 mb-4" />
        <h2 className="text-xl font-medium text-slate-800">Access Denied</h2>
        <p className="mt-2">You do not have permission to view this page.</p>
      </div>
    );
  }

  // Invitations Actions
  const handleCreateInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      await adminApi.createInvitation(inviteCode, inviteMaxUses);
      setInviteCode('');
      setInviteMaxUses(1);
      loadInvitations();
    } catch (e: unknown) {
      addToast(
        'error',
        e instanceof Error ? e.message : 'An error occurred while creating invitation',
      );
      console.error(e);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteInvitation = async (id: string) => {
    try {
      await adminApi.deleteInvitation(id);
      loadInvitations();
    } catch (e: unknown) {
      addToast(
        'error',
        e instanceof Error ? e.message : 'An error occurred while deleting invitation',
      );
      console.error(e);
      throw e;
    }
  };

  // ─── User management actions (role / status / delete) ───

  const handleConfirmRoleChange = async () => {
    if (!roleTarget) return;
    setIsChangingRole(true);
    try {
      await adminApi.updateUserRole(roleTarget.id, roleTarget.role);
      setRoleTarget(null);
      loadUsers();
      addToast(
        'success',
        `User ${roleTarget.role === 'super_admin' ? 'promoted to Super Admin' : 'demoted to Member'}`,
      );
    } catch (e: unknown) {
      addToast('error', e instanceof Error ? e.message : 'Failed to update role');
      setRoleTarget(null);
    } finally {
      setIsChangingRole(false);
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!statusTarget) return;
    setIsChangingStatus(true);
    try {
      await adminApi.updateUserStatus(statusTarget.id, statusTarget.status);
      setStatusTarget(null);
      loadUsers();
      addToast('success', `User ${statusTarget.status === 'blocked' ? 'blocked' : 'unblocked'}`);
    } catch (e: unknown) {
      addToast('error', e instanceof Error ? e.message : 'Failed to update status');
      setStatusTarget(null);
    } finally {
      setIsChangingStatus(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteUserTarget) return;
    setIsDeletingUser(true);
    try {
      await adminApi.deleteUser(deleteUserTarget.id);
      setDeleteUserTarget(null);
      loadUsers();
      addToast('success', 'User deleted');
    } catch (e: unknown) {
      addToast('error', e instanceof Error ? e.message : 'Failed to delete user');
      setDeleteUserTarget(null);
    } finally {
      setIsDeletingUser(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Users"
        icon={UserCog}
        description="Manage admin users and invitation codes"
        actions={
          activeTab === 'users' && (
            <Button
              variant="primary"
              size="md"
              className="rounded-md gap-1"
              onClick={() => setIsAddUserModalOpen(true)}
            >
              <Plus size={18} />
              <span className="hidden sm:inline">Add User</span>
            </Button>
          )
        }
      />

      <div className="flex border-b border-slate-200 mb-4 sm:mb-6 gap-4 sm:gap-6">
        <Button
          variant="ghost"
          className={`pb-3 px-0 rounded-none border-b-2 ${activeTab === 'users' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'} hover:bg-transparent`}
          onClick={() => setActiveTab('users')}
        >
          Active Users
        </Button>
        <Button
          variant="ghost"
          className={`pb-3 px-0 rounded-none border-b-2 ${activeTab === 'invitations' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'} hover:bg-transparent`}
          onClick={() => setActiveTab('invitations')}
        >
          Invitation Codes
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'users' && (
          <div>
            <div className="bg-card border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
              {isLoadingUsers ? (
                <div className="p-4 sm:p-6">
                  <ListSkeleton rows={6} />
                </div>
              ) : usersError ? (
                <ErrorState onRetry={() => loadUsers()} />
              ) : (
                <table className="w-full text-left border-collapse min-w-[500px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-2 sm:px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                        Name
                      </th>
                      <th className="px-2 sm:px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                        Email
                      </th>
                      <th className="px-2 sm:px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                        Role
                      </th>
                      <th className="px-2 sm:px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                        Status
                      </th>
                      <th className="px-2 sm:px-6 py-3 text-xs font-medium text-slate-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {users.map((userItem) => (
                      <tr key={userItem.id} className="hover:bg-slate-50">
                        <td className="px-2 sm:px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium overflow-hidden"
                              role="img"
                              aria-label={userItem.name || userItem.username || 'User avatar'}
                            >
                              {userItem.avatarUrl ? (
                                <img
                                  src={userItem.avatarUrl}
                                  alt={userItem.name || userItem.username || 'User avatar'}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                (userItem.name || userItem.email || '?').charAt(0).toUpperCase()
                              )}
                            </div>
                            <span className="text-sm font-medium text-slate-900">
                              {userItem.name || userItem.username || 'Unknown'}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 sm:px-6 py-4 text-sm text-slate-500">
                          {userItem.email || '-'}
                        </td>
                        <td className="px-2 sm:px-6 py-4 text-sm">
                          <span
                            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${userItem.role === 'super_admin' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-800'}`}
                          >
                            {userItem.role || 'member'}
                          </span>
                        </td>
                        <td className="px-2 sm:px-6 py-4 text-sm">
                          <span
                            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${userItem.status === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}
                          >
                            {userItem.status || 'active'}
                          </span>
                        </td>
                        <td className="px-2 sm:px-6 py-4 text-sm text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 disabled:opacity-30"
                                aria-label={`Actions for ${userItem.name || userItem.username}`}
                                disabled={userItem.id === user?.userId}
                              >
                                <EllipsisVertical size={16} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  setRoleTarget({
                                    id: userItem.id,
                                    role:
                                      userItem.role === 'super_admin' ? 'member' : 'super_admin',
                                    name: userItem.name || userItem.username || 'this user',
                                  })
                                }
                              >
                                {userItem.role === 'super_admin'
                                  ? 'Demote to Member'
                                  : 'Promote to Admin'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setStatusTarget({
                                    id: userItem.id,
                                    status: userItem.status === 'blocked' ? 'active' : 'blocked',
                                    name: userItem.name || userItem.username || 'this user',
                                  })
                                }
                              >
                                {userItem.status === 'blocked' ? 'Unblock User' : 'Block User'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                onClick={() =>
                                  setDeleteUserTarget({
                                    id: userItem.id,
                                    name: userItem.name || userItem.username || 'this user',
                                  })
                                }
                              >
                                Delete User
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'invitations' && (
          <div>
            <form onSubmit={handleCreateInvitation} className="flex flex-wrap gap-2 sm:gap-4 mb-6">
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Code (e.g. TEAM-2026)"
                className="border border-slate-400 px-3 py-2 rounded focus-visible:ring-2 focus-visible:ring-primary outline-none"
                required
              />
              <input
                type="number"
                value={inviteMaxUses}
                onChange={(e) => setInviteMaxUses(Number(e.target.value))}
                placeholder="Max Uses"
                className="border border-slate-400 w-24 px-3 py-2 rounded focus-visible:ring-2 focus-visible:ring-primary outline-none"
                required
                min="0"
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
                className="rounded"
                loading={isCreating}
                disabled={isCreating}
              >
                <span>Create Code</span>
              </Button>
            </form>

            <div className="bg-card border border-slate-200 rounded-lg overflow-hidden">
              <ul className="divide-y divide-slate-200">
                {invitations.length === 0 ? (
                  <li className="p-4 text-slate-500 text-center">No invitation codes found.</li>
                ) : (
                  invitations.map((inv: Invitation) => (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between gap-2 p-4 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-800">{inv.code}</span>
                        <span className="text-sm text-slate-500 ml-2 sm:ml-4">
                          Used: {inv.used_count} / {inv.max_uses === 0 ? 'Unlimited' : inv.max_uses}
                        </span>
                      </div>
                      <Button
                        variant="ghostDanger"
                        className="text-red-600 hover:text-red-800 hover:bg-transparent text-sm px-0 py-0"
                        onClick={() => setInvitationToDelete(inv.id)}
                      >
                        Delete
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        )}
      </div>

      <AddUserModal
        open={isAddUserModalOpen}
        onClose={() => setIsAddUserModalOpen(false)}
        onSuccess={() => {
          setIsAddUserModalOpen(false);
          loadUsers();
        }}
      />

      <ConfirmDialog
        open={invitationToDelete !== null}
        title="Delete Invitation Code"
        message="Are you sure you want to delete this invitation code? Users who already received it will no longer be able to register."
        confirmText="Delete"
        variant="danger"
        loading={isDeletingInvitation}
        onConfirm={async () => {
          if (!invitationToDelete) return;
          setIsDeletingInvitation(true);
          try {
            await handleDeleteInvitation(invitationToDelete);
            setInvitationToDelete(null);
          } catch {
            // toast already shown by handler; keep dialog open for retry
          } finally {
            setIsDeletingInvitation(false);
          }
        }}
        onClose={() => !isDeletingInvitation && setInvitationToDelete(null)}
      />

      {/* Role change confirmation */}
      <ConfirmDialog
        open={roleTarget !== null}
        title={`${roleTarget?.role === 'super_admin' ? 'Promote' : 'Demote'} User`}
        message={`Are you sure you want to ${roleTarget?.role === 'super_admin' ? 'promote' : 'demote'} "${roleTarget?.name}" ${roleTarget?.role === 'super_admin' ? 'to Super Admin' : 'to Member'}?`}
        confirmText={roleTarget?.role === 'super_admin' ? 'Promote' : 'Demote'}
        variant={roleTarget?.role === 'member' ? 'danger' : 'info'}
        loading={isChangingRole}
        onConfirm={handleConfirmRoleChange}
        onClose={() => !isChangingRole && setRoleTarget(null)}
      />

      {/* Status change confirmation */}
      <ConfirmDialog
        open={statusTarget !== null}
        title={statusTarget?.status === 'blocked' ? 'Block User' : 'Unblock User'}
        message={
          statusTarget?.status === 'blocked'
            ? `Block "${statusTarget?.name}"? They will be immediately signed out and cannot log in until unblocked.`
            : `Unblock "${statusTarget?.name}"? They will be able to log in again.`
        }
        confirmText={statusTarget?.status === 'blocked' ? 'Block' : 'Unblock'}
        variant={statusTarget?.status === 'blocked' ? 'danger' : 'info'}
        loading={isChangingStatus}
        onConfirm={handleConfirmStatusChange}
        onClose={() => !isChangingStatus && setStatusTarget(null)}
      />

      {/* Delete user confirmation */}
      <ConfirmDialog
        open={deleteUserTarget !== null}
        title="Delete User"
        message={`Are you sure you want to delete "${deleteUserTarget?.name}"? This permanently deletes all their drives, workspaces, files, and shared links. This action CANNOT be undone.`}
        confirmText="Delete User"
        variant="danger"
        loading={isDeletingUser}
        onConfirm={handleConfirmDeleteUser}
        onClose={() => !isDeletingUser && setDeleteUserTarget(null)}
      />
    </div>
  );
};

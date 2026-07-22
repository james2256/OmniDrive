// packages/web/src/pages/SetupPage.tsx
import { useState } from 'react';
import { api } from '../lib/api';

export function SetupPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.register({ username, password });
      window.location.href = '/';
    } catch (err: unknown) {
      setErrorMsg((err instanceof Error ? err.message : 'Setup failed'));
    }
  };

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome to OmniDrive</h1>
          <p className="text-slate-600 text-sm mb-6">Create the first Super Admin account to get started.</p>
          {errorMsg && (
            <div role="alert" className="mb-4 text-red-700 text-sm">
              {errorMsg}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
            <div>
              <label htmlFor="setup-username" className="block text-sm font-medium text-slate-700 mb-1">
                Admin Username
              </label>
              <input
                id="setup-username"
                name="username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-slate-400 rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="setup-password" className="block text-sm font-medium text-slate-700 mb-1">
                Admin Password
              </label>
              <input
                id="setup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-slate-400 rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors mt-4"
            >
              Complete Setup
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

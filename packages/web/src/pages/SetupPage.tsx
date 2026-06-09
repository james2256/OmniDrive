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
    } catch (err: any) {
      setErrorMsg(err.message || 'Setup failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-900 via-blue-900 to-slate-900 px-4">
      <div className="relative w-full max-w-sm">
        <div className="bg-white rounded-3xl shadow-2xl p-10 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to OmniDrive</h1>
          <p className="text-gray-500 text-sm mb-6">Create the first Super Admin account to get started.</p>
          {errorMsg && <div className="mb-4 text-red-600 text-sm">{errorMsg}</div>}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
            <div>
              <label className="block text-sm font-medium mb-1">Admin Username</label>
              <input type="text" required value={username} onChange={e => setUsername(e.target.value)} className="w-full px-4 py-2 border rounded-xl" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Admin Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-2 border rounded-xl" />
            </div>
            <button type="submit" className="w-full py-3 bg-blue-600 text-white rounded-xl mt-4">Complete Setup</button>
          </form>
        </div>
      </div>
    </div>
  );
}

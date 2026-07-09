// packages/web/src/pages/LoginPage.tsx
import { useState } from 'react';
import { api } from '../lib/api';

// Link styles for cream card (#efe9de): primary #2563EB is 4.28:1 (fails AA);
// blue-700 + permanent underline pass contrast and "links rely on color".
const linkClass = 'text-blue-700 underline hover:text-blue-800';

export function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      if (isRegister) {
        await api.register({ name, username, password, email, invitation_code: invitationCode });
      } else {
        await api.login({ username, password });
      }
      window.location.href = '/';
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed');
    }
  };

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-stone-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="flex flex-col items-center justify-center mb-1">
            <img
              src="/logo.png?v=2"
              alt="AzaDrive"
              width={64}
              height={64}
              fetchPriority="high"
              decoding="async"
              className="w-16 h-16 object-contain mb-3"
            />
            <h1 className="text-3xl font-bold text-stone-900">AzaDrive</h1>
          </div>
          <p className="text-stone-600 text-sm mb-8">
            Sign in to your account
          </p>

          {errorMsg && (
            <div
              role="alert"
              className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm"
            >
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
            <div>
              <label htmlFor="login-username" className="block text-sm font-medium text-stone-700 mb-1">
                Username
              </label>
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-stone-300 rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {isRegister && (
              <>
                <div>
                  <label htmlFor="login-name" className="block text-sm font-medium text-stone-700 mb-1">
                    Name
                  </label>
                  <input
                    id="login-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor="login-email" className="block text-sm font-medium text-stone-700 mb-1">
                    Email (Optional)
                  </label>
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor="login-invitation" className="block text-sm font-medium text-stone-700 mb-1">
                    Invitation Code (Required)
                  </label>
                  <input
                    id="login-invitation"
                    name="invitation_code"
                    type="text"
                    autoComplete="off"
                    required
                    value={invitationCode}
                    onChange={e => setInvitationCode(e.target.value)}
                    className="w-full px-4 py-2 border border-stone-300 rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-stone-700 mb-1">
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-stone-300 rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors mt-2"
            >
              {isRegister ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => setIsRegister(!isRegister)}
              className={`text-sm ${linkClass}`}
            >
              {isRegister ? 'Already have an account? Sign in' : 'Need an account? Register'}
            </button>
          </div>

          <p className="mt-8 text-xs text-stone-600">
            By signing in, you agree to our{' '}
            <a href="/terms" className={linkClass}>Terms of Service</a>
            {' '}and{' '}
            <a href="/privacy" className={linkClass}>Privacy Policy</a>.
          </p>
        </div>
      </div>
    </main>
  );
}

import { LogIn } from 'lucide-react';

export function LoginPage() {
  const error = new URLSearchParams(window.location.search).get('error');

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🔷</div>
        <h1 className="login-title">Omnidrive</h1>
        <p className="login-subtitle">Unified multi-Google-Drive storage gateway</p>

        {error && (
          <div className="login-error">
            Authentication failed. Please try again.
          </div>
        )}

        <a href="/api/auth/login" className="btn btn-primary btn-lg login-btn">
          <LogIn size={20} />
          Sign in with Google
        </a>

        <p className="login-footer">
          Your first Google Drive will be connected automatically.
        </p>
      </div>

      <style>{loginStyles}</style>
    </div>
  );
}

const loginStyles = `
  .login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    padding: var(--space-lg);
  }

  .login-card {
    text-align: center;
    max-width: 400px;
    width: 100%;
  }

  .login-logo {
    font-size: 4rem;
    margin-bottom: var(--space-md);
    animation: slideUp var(--transition-slow) ease;
  }

  .login-title {
    font-size: var(--font-size-3xl);
    font-weight: 700;
    margin-bottom: var(--space-sm);
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-primary-hover));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .login-subtitle {
    color: var(--text-secondary);
    margin-bottom: var(--space-xl);
    font-size: var(--font-size-md);
  }

  .login-error {
    background: var(--accent-danger-subtle);
    color: var(--accent-danger);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-lg);
    font-size: var(--font-size-sm);
  }

  .login-btn {
    width: 100%;
    text-decoration: none;
    margin-bottom: var(--space-lg);
  }

  .login-footer {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
`;

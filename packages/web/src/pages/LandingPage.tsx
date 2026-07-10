import { Link } from 'react-router-dom';
import { Cloud, FolderSync, Link2, Shield, Users } from 'lucide-react';

const features = [
  {
    icon: Cloud,
    title: 'Multi-Drive Gateway',
    description: 'Connect multiple Google Drive accounts and browse all files from one dashboard.',
  },
  {
    icon: Users,
    title: 'Team Workspaces',
    description: 'Organize files in workspaces with role-based access control for your team.',
  },
  {
    icon: Link2,
    title: 'Shared Links',
    description: 'Share files with password protection, expiration dates, and download limits.',
  },
  {
    icon: FolderSync,
    title: 'Background Sync',
    description: 'Automatic sync keeps your file index up to date across connected drives.',
  },
  {
    icon: Shield,
    title: 'Security First',
    description: 'OAuth tokens encrypted at rest, CSRF protection, and PKCE authentication flow.',
  },
];

export function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-surface">
      <header className="border-b border-stone-200 bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png?v=2" alt="OmniDrive" className="h-8 w-8 object-contain" />
            <span className="text-lg font-semibold text-stone-900">OmniDrive</span>
          </div>
          <Link
            to="/login"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <img src="/logo.png?v=2" alt="OmniDrive" className="mx-auto mb-6 h-20 w-20 object-contain" />
            <h1 className="text-4xl font-bold tracking-tight text-stone-900 sm:text-5xl">
              Unified multi-Google Drive storage gateway
            </h1>
            <p className="mt-6 text-lg text-stone-600">
              OmniDrive lets you connect multiple Google Drive accounts, manage files in team
              workspaces, share links securely, and access storage via an S3-compatible API —
              all from a single dashboard.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                to="/login"
                className="rounded-lg bg-primary px-6 py-3 text-base font-medium text-white hover:bg-primary/90"
              >
                Get started
              </Link>
              <a
                href="https://github.com/james2256/OmniDrive"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-stone-300 bg-card px-6 py-3 text-base font-medium text-stone-700 hover:bg-stone-50"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </section>

        <section className="border-t border-stone-200 bg-card">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
            <h2 className="mb-10 text-center text-2xl font-semibold text-stone-900">Features</h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-stone-200 bg-surface p-6"
                >
                  <Icon className="mb-4 h-8 w-8 text-primary" aria-hidden />
                  <h3 className="mb-2 text-lg font-semibold text-stone-900">{title}</h3>
                  <p className="text-sm text-stone-600">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-stone-200">
          <div className="mx-auto max-w-5xl px-4 py-12 text-center sm:px-6">
            <p className="text-sm text-stone-600">
              OmniDrive uses Google OAuth to connect your Google Drive accounts.
              By signing in and connecting a drive, you agree to our{' '}
              <Link to="/terms" className="text-blue-700 underline hover:text-blue-800">Terms of Service</Link>
              {' '}and{' '}
              <Link to="/privacy" className="text-blue-700 underline hover:text-blue-800">Privacy Policy</Link>.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200 bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-stone-500 sm:px-6">
          <p>© {new Date().getFullYear()} OmniDrive</p>
          <nav className="flex flex-wrap gap-4">
            <Link to="/privacy" className="hover:text-primary">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-primary">Terms of Service</Link>
            <a href="mailto:admin@example.com" className="hover:text-primary">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
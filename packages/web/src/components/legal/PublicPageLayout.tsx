import { Link } from 'react-router-dom';

interface PublicPageLayoutProps {
  title: string;
  children: React.ReactNode;
}

export function PublicPageLayout({ title, children }: PublicPageLayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-surface">
      <header className="border-b border-slate-200 bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/home" className="flex items-center gap-2.5 text-slate-900 hover:opacity-80">
            <img src="/logo.png?v=2" alt="OmniDrive" className="h-8 w-8 object-contain" />
            <span className="text-lg font-semibold">OmniDrive</span>
          </Link>
          <Link
            to="/login"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="mb-8 text-3xl font-bold text-slate-900">{title}</h1>
        <div className="prose-legal space-y-6 text-slate-700">{children}</div>
      </main>

      <footer className="border-t border-slate-200 bg-card">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-slate-600 sm:px-6">
          <p>© {new Date().getFullYear()} OmniDrive</p>
          <nav className="flex flex-wrap gap-4" aria-label="Legal">
            <Link to="/home" className="underline hover:text-slate-900">Home</Link>
            <Link to="/privacy" className="underline hover:text-slate-900">Privacy Policy</Link>
            <Link to="/terms" className="underline hover:text-slate-900">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
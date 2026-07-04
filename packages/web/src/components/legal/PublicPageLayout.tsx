import { Link } from 'react-router-dom';

interface PublicPageLayoutProps {
  title: string;
  children: React.ReactNode;
}

export function PublicPageLayout({ title, children }: PublicPageLayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-surface">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/home" className="flex items-center gap-2.5 text-gray-900 hover:opacity-80">
            <img src="/logo.png?v=2" alt="AzaDrive" className="h-8 w-8 object-contain" />
            <span className="text-lg font-semibold">AzaDrive</span>
          </Link>
          <Link
            to="/login"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="mb-8 text-3xl font-bold text-gray-900">{title}</h1>
        <div className="prose-legal space-y-6 text-gray-700">{children}</div>
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-gray-500 sm:px-6">
          <p>© {new Date().getFullYear()} AzaDrive</p>
          <nav className="flex flex-wrap gap-4">
            <Link to="/home" className="hover:text-primary">Home</Link>
            <Link to="/privacy" className="hover:text-primary">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-primary">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
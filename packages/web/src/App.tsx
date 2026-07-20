import { Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from './components/AuthGuard';
import { AppLayout } from './components/layout/AppLayout';
import { ToastContainer } from './components/Toast';
import { api } from './lib/api';
import { lazyWithRetry } from './lib/lazyWithRetry';

// ponytail: lazy-load pages so login/public shells don't pull recharts + file UI (~900KB) into LCP path
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const FilesPage = lazyWithRetry(() => import('./pages/FilesPage').then((m) => ({ default: m.FilesPage })));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SharedLinksPage = lazyWithRetry(() => import('./pages/SharedLinksPage').then((m) => ({ default: m.SharedLinksPage })));
const SharedWithMePage = lazyWithRetry(() => import('./pages/SharedWithMePage').then((m) => ({ default: m.SharedWithMePage })));
const PublicSharedPage = lazyWithRetry(() => import('./pages/PublicSharedPage').then((m) => ({ default: m.PublicSharedPage })));
const AutomationsPage = lazyWithRetry(() => import('./pages/AutomationsPage').then((m) => ({ default: m.AutomationsPage })));
const SearchPage = lazyWithRetry(() => import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })));
const TrashPage = lazyWithRetry(() => import('./pages/TrashPage').then((m) => ({ default: m.TrashPage })));
const StarredPage = lazyWithRetry(() => import('./pages/StarredPage').then((m) => ({ default: m.StarredPage })));
const WorkspacesPage = lazyWithRetry(() => import('./pages/WorkspacesPage').then((m) => ({ default: m.WorkspacesPage })));
const SetupPage = lazyWithRetry(() => import('./pages/SetupPage').then((m) => ({ default: m.SetupPage })));
const AdminUsersPage = lazyWithRetry(() => import('./pages/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })));
const LandingPage = lazyWithRetry(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const PrivacyPolicyPage = lazyWithRetry(() => import('./pages/PrivacyPolicyPage').then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsOfServicePage = lazyWithRetry(() => import('./pages/TermsOfServicePage').then((m) => ({ default: m.TermsOfServicePage })));

function PageFallback() {
  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center bg-surface text-stone-600 text-sm"
      role="status"
      aria-live="polite"
    >
      Loading…
    </div>
  );
}

export const SetupGuard = ({ children, isSetup }: { children: React.ReactNode; isSetup: boolean }) => {
  if (isSetup === false) return <Navigate to="/setup" replace />;
  return <>{children}</>;
};

export const App = () => {
  const [isSetup, setIsSetup] = useState<boolean | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const checkSetupStatus = () => {
    setSetupError(null);
    setIsSetup(null);
    api.getSetupStatus()
      .then((res) => setIsSetup(res.isSetup))
      .catch((err) => setSetupError((err instanceof Error ? err.message : 'Failed to connect to server')));
  };

  useEffect(() => {
    checkSetupStatus();
  }, []);

  if (setupError) {
    return (
      <main className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-surface px-4">
        <h1 className="text-lg font-semibold text-stone-900">Connection Error</h1>
        <p className="text-sm text-stone-600 text-center max-w-sm" role="alert">
          {setupError}
        </p>
        <button
          type="button"
          onClick={checkSetupStatus}
          className="px-4 py-2 rounded-lg border border-stone-300 bg-card text-stone-800 text-sm font-medium hover:bg-stone-50"
        >
          Retry
        </button>
      </main>
    );
  }

  if (isSetup === null) {
    return <PageFallback />;
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/home" element={<LandingPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/terms" element={<TermsOfServicePage />} />
          <Route path="/setup" element={isSetup ? <Navigate to="/login" /> : <SetupPage />} />
          <Route path="/login" element={!isSetup ? <Navigate to="/setup" /> : <LoginPage />} />
          <Route path="/shared/:id" element={<PublicSharedPage />} />
          <Route
            element={
              <SetupGuard isSetup={isSetup}>
                <AuthGuard>
                  <AppLayout />
                  <ToastContainer />
                </AuthGuard>
              </SetupGuard>
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
            <Route path="/shared-with-me" element={<SharedWithMePage />} />
            <Route path="/shared-with-me/:folderId" element={<SharedWithMePage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/starred" element={<StarredPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

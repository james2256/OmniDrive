import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthGuard } from './components/AuthGuard';
import { AppLayout } from './components/layout/AppLayout';
import { ToastContainer } from './components/Toast';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { FilesPage } from './pages/FilesPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharedLinksPage } from './pages/SharedLinksPage';
import { PublicSharedPage } from './pages/PublicSharedPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { SearchPage } from './pages/SearchPage';
import { TrashPage } from './pages/TrashPage';
import { StarredPage } from './pages/StarredPage';
import { VirtualFoldersPage } from './pages/VirtualFoldersPage';

export const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/shared/:id" element={<PublicSharedPage />} />
        <Route
          element={
            <AuthGuard>
              <AppLayout />
              <ToastContainer />
            </AuthGuard>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/files/:folderId" element={<FilesPage />} />
          <Route path="/virtual-folders" element={<VirtualFoldersPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/settings/drives" element={<SettingsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/shared" element={<SharedLinksPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/starred" element={<StarredPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

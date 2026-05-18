import { AccessDenied } from './components/AccessDenied/AccessDenied';
import { AdminLayout } from './components/AdminLayout/AdminLayout';
import { DraftEventsPage } from './components/DraftEventsPage/DraftEventsPage';
import { LoginPage } from './components/LoginPage/LoginPage';
import { NotificationToast } from './components/NotificationToast/NotificationToast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import styles from './App.module.css';

function AppContent() {
  const { state } = useAuth();

  if (state === 'loading') {
    return <p className={styles.loading}>Loading…</p>;
  }

  if (state === 'unauthenticated') {
    return <LoginPage />;
  }

  if (state === 'access_denied') {
    return <AccessDenied />;
  }

  return (
    <AdminLayout>
      <DraftEventsPage />
    </AdminLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <AppContent />
        <NotificationToast />
      </NotificationProvider>
    </AuthProvider>
  );
}

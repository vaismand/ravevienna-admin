import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type NotificationType = 'success' | 'error' | 'info';

export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
}

interface NotificationContextValue {
  notifications: Notification[];
  notify: (message: string, type?: NotificationType) => void;
  dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, type: NotificationType = 'info') => {
      const id = crypto.randomUUID();
      setNotifications((prev) => [...prev, { id, message, type }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({ notifications, notify, dismiss }),
    [notifications, notify, dismiss],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return ctx;
}

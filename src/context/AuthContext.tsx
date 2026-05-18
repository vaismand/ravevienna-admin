import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

type AuthState =
  | 'loading'
  | 'unauthenticated'
  | 'authenticated'
  | 'access_denied';

function isAdminRole(role: string | null | undefined): boolean {
  return role?.trim().toLowerCase() === 'admin';
}

interface AuthContextValue {
  state: AuthState;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  authError: string | null;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, email')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data as Profile | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const resolveAuth = useCallback(async (nextSession: Session | null) => {
    if (!nextSession?.user) {
      setSession(null);
      setUser(null);
      setProfile(null);
      setAuthError(null);
      setState('unauthenticated');
      return;
    }

    setSession(nextSession);
    setUser(nextSession.user);

    try {
      const nextProfile = await fetchProfile(nextSession.user.id);
      setProfile(nextProfile);
      setAuthError(null);

      if (isAdminRole(nextProfile?.role)) {
        setState('authenticated');
        return;
      }

      if (!nextProfile) {
        setAuthError(
          'No profile row found for your user ID. Ensure profiles.id matches auth.users.id.',
        );
      }

      setState('access_denied');
    } catch (err) {
      setProfile(null);
      setAuthError(
        err instanceof Error ? err.message : 'Failed to load profile',
      );
      setState('access_denied');
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    try {
      const nextProfile = await fetchProfile(user.id);
      setProfile(nextProfile);
      setAuthError(null);
      setState(isAdminRole(nextProfile?.role) ? 'authenticated' : 'access_denied');
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Failed to load profile',
      );
      setState('access_denied');
    }
  }, [user]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) void resolveAuth(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void resolveAuth(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [resolveAuth]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    },
    [],
  );

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const isAdmin = isAdminRole(profile?.role);

  const value = useMemo(
    () => ({
      state,
      session,
      user,
      profile,
      authError,
      isAdmin,
      signIn,
      signOut,
      refreshProfile,
    }),
    [
      state,
      session,
      user,
      profile,
      authError,
      isAdmin,
      signIn,
      signOut,
      refreshProfile,
    ],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { actAs, supabase } from './lib/supabase';

export type Role = 'admin' | 'azienda' | 'corsista';

export type Profile = {
  id: string;
  role: Role;
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
};

type Who = { profile: Profile; impersonating: boolean; force_password_change: boolean };

type Auth = {
  session: Session | null;
  who: Who | null;
  loading: boolean;
  actionError: string;
  profileError: boolean;
  refresh: () => Promise<void>;
  startImpersonation: (targetId: string) => Promise<void>;
  stopImpersonation: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [who, setWho] = useState<Who | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [profileError, setProfileError] = useState(false);
  const profileRequest = useRef(0);

  const loadWho = useCallback(async (s: Session | null) => {
    const request = ++profileRequest.current;
    if (!s) {
      setProfileError(false);
      setWho(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc('whoami');
    if (request !== profileRequest.current) return;
    setProfileError(!!error);
    setWho((data as Who | null) ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Fuori dal callback: supabase-js sconsiglia chiamate await dentro onAuthStateChange.
      setTimeout(() => loadWho(s), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [loadWho]);

  const refresh = useCallback(() => loadWho(session), [loadWho, session]);

  const startImpersonation = async (targetId: string) => {
    const { error } = await supabase.functions.invoke('learning-impersonate', {
      body: { action: 'start', target_id: targetId },
    });
    if (error) throw error;
    actAs.set(targetId);
    await refresh();
  };

  const stopImpersonation = async () => {
    setActionError('');
    const { error } = await supabase.functions.invoke('learning-impersonate', { body: { action: 'stop' } });
    if (error) {
      setActionError('Impossibile chiudere la sessione «Entra come». Riprova.');
      return;
    }
    actAs.set(null);
    await refresh();
  };

  const signOut = async () => {
    if (actAs.get()) {
      await stopImpersonation();
      if (actAs.get()) return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) setActionError('Impossibile uscire. Riprova.');
  };

  return (
    <AuthContext.Provider
      value={{ session, who, loading, actionError, profileError, refresh, startImpersonation, stopImpersonation, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuori da AuthProvider');
  return ctx;
}

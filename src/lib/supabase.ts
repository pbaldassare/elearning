import { createClient } from '@supabase/supabase-js';

const ACT_AS_KEY = 'd-academy:act-as';

// Utente impersonato con "Entra come". Il DB lo rispetta solo se chi chiama è
// un Admin con una sessione aperta dalla Edge Function "impersonate".
export const actAs = {
  get: () => sessionStorage.getItem(ACT_AS_KEY),
  set: (id: string | null) =>
    id ? sessionStorage.setItem(ACT_AS_KEY, id) : sessionStorage.removeItem(ACT_AS_KEY),
};

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    global: {
      fetch: (input, init) => {
        const target = actAs.get();
        if (!target) return fetch(input, init);
        const headers = new Headers(init?.headers);
        headers.set('x-act-as', target);
        return fetch(input, { ...init, headers });
      },
    },
  },
);

// Chiama una Edge Function e restituisce il messaggio d'errore leggibile che manda.
export async function callFn<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data as T;
}

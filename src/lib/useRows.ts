import { useCallback, useEffect, useState } from 'react';

type Result = { data: unknown; error: { message: string } | null };

// Carica dati da Supabase (RLS decide cosa si vede) e permette di ricaricarli.
export function useRows<T>(query: () => PromiseLike<Result>, deps: unknown[] = []) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await query();
    setError(error?.message ?? '');
    setRows((data as T[] | null) ?? []);
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { rows, error, reload: load };
}

import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Button, Field, Message } from '../ui';

export default function PasswordForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));
    if (password !== form.get('confirm')) return setError('Le due password non coincidono.');
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message.includes('should be different')
        ? 'La nuova password deve essere diversa da quella attuale.'
        : 'Password non valida: usa almeno 8 caratteri.');
      setBusy(false);
      return;
    }
    await supabase.rpc('mark_password_changed');
    setBusy(false);
    onDone();
  };

  return (
    <form onSubmit={submit}>
      {error && <Message kind="error">{error}</Message>}
      <Field label="Nuova password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      <Field label="Conferma password" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      <Button disabled={busy}>{busy ? 'Salvataggio…' : 'Salva password'}</Button>
    </form>
  );
}

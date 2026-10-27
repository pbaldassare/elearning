import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth';
import { Button, Card, Field, Message } from '../ui';

export default function Login() {
  const { session } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (error) {
      setError('Email o password non corretti.');
      setBusy(false);
      return;
    }
    await supabase.rpc('log_access');
  };

  return (
    <Card title="Accedi a D-Academy">
      <form onSubmit={submit}>
        {error && <Message kind="error">{error}</Message>}
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <Button disabled={busy}>{busy ? 'Accesso in corso…' : 'Accedi'}</Button>
      </form>
      <Link to="/password-dimenticata" className="mt-4 block text-center text-sm underline">
        Password dimenticata?
      </Link>
    </Card>
  );
}

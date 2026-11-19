import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Message } from '../ui';

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email'));
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/reimposta-password`,
    });
    setBusy(false);
    if (error && (error.name === 'AuthRetryableFetchError' || error.code === 'over_request_rate_limit')) {
      setError('Invio temporaneamente non disponibile. Riprova tra poco.');
    } else {
      // Risposta neutra anche per gli errori legati al singolo indirizzo.
      setSent(true);
    }
  };

  return (
    <Card title="Recupera password">
      {sent ? (
        <Message kind="success">
          Se l'indirizzo è registrato, riceverai un'email con il link per impostare una nuova password.
        </Message>
      ) : (
        <form onSubmit={submit}>
          {error && <Message kind="error">{error}</Message>}
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Button disabled={busy}>{busy ? 'Invio in corso…' : 'Invia link'}</Button>
        </form>
      )}
      <Link to="/accedi" className="mt-4 block text-center text-sm underline">Torna all'accesso</Link>
    </Card>
  );
}

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Message } from '../ui';

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email'));
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/reimposta-password`,
    });
    // Stesso messaggio in ogni caso: non riveliamo quali email sono registrate.
    setSent(true);
  };

  return (
    <Card title="Recupera password">
      {sent ? (
        <Message kind="success">
          Se l'indirizzo è registrato, riceverai un'email con il link per impostare una nuova password.
        </Message>
      ) : (
        <form onSubmit={submit}>
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Button>Invia link</Button>
        </form>
      )}
      <Link to="/accedi" className="mt-4 block text-center text-sm underline">Torna all'accesso</Link>
    </Card>
  );
}

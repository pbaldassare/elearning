import { useState } from 'react';
import { useAuth } from '../auth';
import { Message } from '../ui';
import PasswordForm from './PasswordForm';

export default function Profile() {
  const { who, refresh } = useAuth();
  const [saved, setSaved] = useState(false);
  if (!who) return null;
  const { profile } = who;

  return (
    <section className="mx-auto max-w-md">
      <h1 className="mb-4 text-2xl font-semibold">Profilo</h1>
      <dl className="mb-8 rounded-2xl border border-line bg-white p-6 shadow-sm">
        <dt className="text-sm text-ink-muted">Nome</dt>
        <dd className="mb-3">{profile.first_name} {profile.last_name}</dd>
        <dt className="text-sm text-ink-muted">Email</dt>
        <dd>{profile.email}</dd>
      </dl>
      {/* In "Entra come" la sessione è dell'Admin: cambiare password toccherebbe il suo account. */}
      {!who.impersonating && (
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Cambia password</h2>
          {who.force_password_change && (
            <Message kind="error">Per continuare imposta una nuova password.</Message>
          )}
          {saved && <Message kind="success">Password aggiornata.</Message>}
          <PasswordForm onDone={() => { setSaved(true); refresh(); }} />
        </div>
      )}
    </section>
  );
}

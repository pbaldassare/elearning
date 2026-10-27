import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Card, Message } from '../ui';
import PasswordForm from './PasswordForm';

// Il link email di recupero apre questa pagina con una sessione temporanea.
export default function ResetPassword() {
  const { session, loading, refresh } = useAuth();
  const navigate = useNavigate();

  return (
    <Card title="Imposta una nuova password">
      {loading ? null : session ? (
        <PasswordForm onDone={() => refresh().then(() => navigate('/', { replace: true }))} />
      ) : (
        <Message kind="error">Il link non è valido o è scaduto. Richiedine uno nuovo.</Message>
      )}
    </Card>
  );
}

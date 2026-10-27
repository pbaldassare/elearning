import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export const inputCls =
  'w-full rounded-lg border border-line bg-white px-3 py-2 focus:border-brand-strong focus:outline-none focus:ring-2 focus:ring-brand/30';

// Pulsanti piccoli dentro tabelle e pannelli.
export const btn = {
  primary: 'rounded-lg bg-brand-strong px-3 py-1.5 text-sm font-medium text-white hover:bg-ink disabled:opacity-60',
  ghost: 'rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium hover:border-ink disabled:opacity-60',
};

export function Logo({ className = 'h-9' }: { className?: string }) {
  return <img src="/logo.png" alt="D-Academy" className={className} />;
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Logo className="mx-auto mb-6 h-14" />
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function PageTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {sub && <p className="mt-1 text-ink-muted">{sub}</p>}
    </div>
  );
}

export function Panel({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-6">
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input className={inputCls} {...props} />
    </label>
  );
}

export function Select({ label, children, ...props }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <select className={inputCls} {...props}>{children}</select>
    </label>
  );
}

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="w-full rounded-lg bg-brand-strong px-4 py-2 font-medium text-white hover:bg-ink disabled:opacity-60"
      {...props}
    />
  );
}

export function Message({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  return (
    <p role={kind === 'error' ? 'alert' : 'status'}
       className={`mb-4 text-sm ${kind === 'error' ? 'text-danger' : 'text-success'}`}>
      {children}
    </p>
  );
}

const tones = {
  ok: 'bg-success/10 text-success',
  warn: 'bg-warn/10 text-warn',
  bad: 'bg-danger/10 text-danger',
  brand: 'bg-brand-soft text-brand-strong',
  muted: 'bg-surface text-ink-muted',
};

export function Badge({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-ink-muted">{children}</p>;
}

export const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('it-IT') : '—');
export const fmtHours = (seconds: number) => (seconds / 3600).toLocaleString('it-IT', { maximumFractionDigits: 1 });

export type Enrollment = {
  id: string;
  user_id: string;
  course_id: string;
  status: 'assegnato' | 'in_corso' | 'completato';
  assigned_at: string;
  expires_at: string;
  active_seconds: number;
  courses: { title: string; required_hours: number } | null;
};

// Stessa regola di public.is_expired: scaduto se non completato e oltre la data.
export function EnrollmentBadge({ e }: { e: Pick<Enrollment, 'status' | 'expires_at'> }) {
  if (e.status === 'completato') return <Badge tone="ok">Completato</Badge>;
  if (new Date(e.expires_at) < new Date()) return <Badge tone="bad">Scaduto</Badge>;
  return e.status === 'in_corso' ? <Badge tone="brand">In corso</Badge> : <Badge tone="muted">Da iniziare</Badge>;
}

export function Progress({ e }: { e: Pick<Enrollment, 'active_seconds' | 'courses'> }) {
  const req = Number(e.courses?.required_hours ?? 0) * 3600;
  const pct = req ? Math.min(100, (e.active_seconds / req) * 100) : 0;
  return (
    <div className="min-w-32">
      <div className="h-2 rounded-full bg-surface" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-muted">{fmtHours(e.active_seconds)} h di {e.courses?.required_hours} h</p>
    </div>
  );
}

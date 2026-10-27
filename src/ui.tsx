import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        {...props}
      />
    </label>
  );
}

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="w-full rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
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

import { Link } from 'react-router-dom';
import type { Enrollment } from '../ui';

const key = (userId: string) => `d-academy:last-course:${userId}`;

export function rememberCourse(userId: string, enrollmentId: string) {
  try { localStorage.setItem(key(userId), enrollmentId); } catch { /* preferenza facoltativa */ }
}

export function CourseResume({ rows, userId, className }: { rows: Enrollment[]; userId: string; className: string }) {
  let lastOpened = null;
  try { lastOpened = localStorage.getItem(key(userId)); } catch { /* preferenza facoltativa */ }
  const now = Date.now();
  const available = rows.filter((row) => row.status !== 'completato' && new Date(row.expires_at).getTime() >= now)
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const course = available.find((row) => row.id === lastOpened)
    ?? available.find((row) => row.status === 'in_corso') ?? available[0];
  if (!course) return null;
  return (
    <Link to={`/corso/${course.id}`}
          className={`rounded-xl bg-brand-strong px-4 py-3 text-on-brand shadow-lift hover:brightness-110 ${className}`}>
      <span className="block text-xs font-semibold">{course.status === 'in_corso' ? 'Riprendi da dove eri rimasto' : 'Inizia il corso'}</span>
      <span className="mt-1 block font-bold">{course.courses?.title}</span>
    </Link>
  );
}

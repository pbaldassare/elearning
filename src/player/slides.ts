// Rendering delle slide: stesso markup dell'anteprima approvata (stile in slides.css).
// Tutto il testo passa da esc(), quindi l'HTML prodotto è sicuro da inserire.
export type Slide = { layout: string; [k: string]: any };
export type SlideCtx = { topic: string; total: number; minutes: number; course: string };

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const li = (a: unknown[] = []) => a.map((x) => `<li>${esc(x)}</li>`).join('');

const IC: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gavel: '<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6M8 8l6-6M9 7l8 8M21 11l-8-8"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  check2: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
};
const ic = (n: string) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;
const bub = (n: string) => `<span class="bubble">${ic(n)}</span>`;
const FACT_IC: Record<string, string> = { Prima: 'file', Entro: 'cal', Come: 'globe', Limiti: 'scale', Tempi: 'clock', Esito: 'gavel' };
const SRC_IC = ['book', 'file', 'scale'];
const PIX = '1101111101100010'.split('').map((c) => `<i class="${c === '1' ? '' : 'o'}"></i>`).join('');

export function slideHTML(s: Slide, n: number, ctx: SlideCtx) {
  const dark = ['cover', 'recap'].includes(s.layout);
  const hd = (lead?: string) =>
    `<div class="hd">${s.eyebrow && s.layout !== 'cover' ? `<div class="eb">${esc(s.eyebrow)}</div>` : ''}<h2 class="ti">${esc(s.title)}</h2>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</div>`;
  let body = '';
  switch (s.layout) {
    case 'cover':
      body = `<div class="hd"><div class="eb">${esc(s.eyebrow)}</div><h2 class="ti">${esc(s.title)}</h2></div>
        <div class="meta"><span>${ctx.total} slide</span><span>${ctx.minutes} min</span><span>${esc(ctx.course)}</span></div>
        <p class="lead">Al termine della lezione saprai:</p>
        <ol class="goals">${(s.goals ?? []).map((g: string, i: number) => `<li><b>0${i + 1}</b><span>${esc(g)}</span></li>`).join('')}</ol>`; break;
    case 'definition':
      body = `${hd()}<div class="keyc">${esc(s.key)}</div>
        <div class="cards c2"><div class="card ok"><h3>${bub('check')}È un reclamo</h3><ul class="dots">${li(s.yes)}</ul></div>
        <div class="card ko"><h3>${bub('x')}Non è un reclamo</h3><ul class="dots">${li(s.no)}</ul></div></div>
        <div class="note">${bub('users')}<span>${esc(s.note)}</span></div>`; break;
    case 'sources':
      body = `${hd()}<div class="cards c3">${s.items.map((x: any, i: number) => `<div class="card"><h3>${bub(SRC_IC[i % 3])}${esc(x.label)}</h3><p>${esc(x.detail)}</p></div>`).join('')}</div>`; break;
    case 'steps':
      body = `${hd()}<ol class="flow">${s.steps.map((x: any, i: number) => `<li><span class="n">${i + 1}</span><div><b>${esc(x.label)}</b><span>${esc(x.text)}</span></div></li>`).join('')}</ol>`; break;
    case 'table':
      if (s.head.length === 3 && s.rows.every((r: string[]) => r[0].includes(' · ')))
        body = `${hd(s.lead)}<div class="rows">${s.rows.map((r: string[]) => `<div class="row"><span class="sec">${esc(r[0].split(' · ')[0])}</span><div class="rc"><b>${esc(r[0].split(' · ')[1] || r[0])}</b><p>${esc(r[1])}</p><span class="tm">${ic('clock')}${esc(r[2])}</span></div></div>`).join('')}</div>`;
      else
        body = `${hd(s.lead)}<div class="cards">${s.rows.map((r: string[]) => `<div class="card"><h3>${bub('info')}${esc(r[0])}</h3><p>${esc(r[1])}</p>${r[2] ? `<span class="tm">${esc(s.head[2])}: ${esc(r[2])}</span>` : ''}</div>`).join('')}</div>`;
      break;
    case 'checklist':
      body = `${hd()}<ul class="ticks">${s.items.map((x: any) => `<li>${ic('check2')}<span>${esc(x.text)}${x.ref ? `<br><small>${esc(x.ref)}</small>` : ''}</span></li>`).join('')}</ul>`; break;
    case 'split': {
      const col = (c: any, n: string) => `<div class="card"><h3>${bub(n)}${esc(c.title)}</h3><ul class="dots">${li(c.items)}</ul></div>`;
      body = `${hd()}<div class="cards c2">${col(s.left, 'inbox')}${col(s.right, 'file')}</div>${s.note ? `<div class="note">${bub('info')}<span>${esc(s.note)}<small>${esc(s.noteRef)}</small></span></div>` : ''}`; break;
    }
    case 'timeline':
      body = `${hd()}<div class="nums">${s.items.map((x: any) => { const [v, ...u] = String(x.value).split(' '); return `<div class="num"><div class="v">${esc(v)}<small>${esc(u.join(' '))}</small></div><span>${esc(x.text)}</span><em>${esc(x.ref)}</em></div>`; }).join('')}</div>`; break;
    case 'quiz':
      body = `${hd()}<p class="qq">${esc(s.question)}</p><div class="quiz" data-answer="${Number(s.answer)}">${s.options.map((o: string, i: number) => `<button type="button" data-i="${i}"><b>${'ABCD'[i]}</b><span>${esc(o)}</span></button>`).join('')}<div class="why" hidden>${esc(s.explanation)}</div></div>`; break;
    case 'case':
      body = `${hd()}<div class="scen"><b>Scenario</b><span>${esc(s.scenario)}</span></div><ol class="plain">${li(s.questions)}</ol><details class="sol"><summary>Mostra la soluzione</summary><p>${esc(s.solution)}</p></details>`; break;
    case 'concept':
      body = `${hd()}<div class="keyc">${esc(s.key)}</div><p class="lead">${esc(s.body)}</p>`; break;
    case 'facts':
      body = `${hd(s.lead)}<div class="tiles">${s.facts.map((x: any) => `<div class="tile">${bub(FACT_IC[x.label] || 'info')}<div><b>${esc(x.label)}</b><span>${esc(x.text)}</span></div></div>`).join('')}</div>`; break;
    case 'compare':
      body = `${hd()}<div class="vs">${s.cols.map((c: any, i: number) => `<div><h3>${bub(i ? 'gavel' : 'shield')}${esc(c.title)}</h3><ul class="dots">${li(c.items)}</ul></div>`).join('')}</div>`; break;
    case 'recap':
      body = `${hd()}<div class="recap">${s.items.map((x: any) => `<div><b>${esc(x.value)}</b><span>${esc(x.text)}</span></div>`).join('')}</div>`; break;
    default:
      body = hd();
  }
  const foot = s.ref ? `<div class="sl-foot"><b>Fonte</b><span>${esc(s.ref)}</span></div>` : '';
  return `<div class="sl ${dark ? 'dark' : ''} ${s.layout === 'cover' ? 'cover' : ''}">
    ${s.layout === 'cover' ? `<div class="pix" aria-hidden="true">${PIX}</div>` : ''}
    <div class="sl-head"><span class="mk">D</span><span class="ls">${esc(ctx.topic)}</span><span class="no">${String(n).padStart(2, '0')} / ${ctx.total}</span></div>
    <div class="sl-body">${body}</div>${foot}</div>`;
}

// Click sulle verifiche di autoapprendimento (delegato dal contenitore della slide).
export function handleQuizClick(target: EventTarget | null) {
  const btn = (target as HTMLElement | null)?.closest?.('.quiz button') as HTMLButtonElement | null;
  if (!btn) return;
  const quiz = btn.closest('.quiz') as HTMLElement;
  const answer = Number(quiz.dataset.answer);
  quiz.querySelectorAll('button').forEach((b) => {
    const i = Number(b.dataset.i);
    b.classList.toggle('right', i === answer);
    b.classList.toggle('wrong', b === btn && i !== answer);
  });
  (quiz.querySelector('.why') as HTMLElement).hidden = false;
}

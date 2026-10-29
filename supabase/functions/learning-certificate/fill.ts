// Compila il modello PDF dell'attestato (pagina 1: nome e CF; pagina 2: verbale del test).
// I modelli sono gli attestati originali senza dati personali, nel bucket privato "learning-attestati".
import { degrees, PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1';

export type CertData = {
  name: string; cf: string; date: string; hours: number;
  serial: number; code: string; demo: boolean; template: string;
};

type Pos = { x: number; y: number; size: number };
const verbaleIvass = (d: CertData) => [
  `Il giorno ${d.date} il candidato ${d.name} - CF ${d.cf}, ha terminato di frequentare le ${d.hours} ore di aggiornamento con modalità di e-learning sulla piattaforma didattica, ha svolto e superato il test di verifica finale relativo al corso di aggiornamento ai fini IVASS. Il corso fornito da LEG Srl, con sede legale in viale Michelangelo 71 - 25015 Desenzano del Garda (BS), PI 04231050982, è rispondente ai dettati normativi contenuti nel Regolamento IVASS n. 40/2018. Il test di verifica, somministrato in modalità e-learning, è articolato in un questionario a scelta multipla e risposta singola.`,
  'Il candidato ha superato il test ed ha ricevuto l’attestato in formato digitale ai sensi dell’art. 90 del Regolamento IVASS n. 40/2018.',
];
// Testo del modello Word dell'utente, invariato.
const verbalePrivacy = (d: CertData) => [
  `Il giorno ${d.date} il candidato ${d.name} - CF ${d.cf}, ha terminato di frequentare le ${d.hours} ore di corso di formazione GDPR con modalità di e-learning sulla piattaforma didattica, ha svolto e superato il test di verifica finale relativo al corso. Il corso fornito da LEG Srl, con sede legale in viale Michelangelo 71 - 25015 Desenzano del Garda (BS), PI 04231050982 , è rispondente ai dettati normativi contenuti nel Regolamento GDPR d.lgs 196/03 Il test di verifica, somministrato in modalità e-learning, è articolato in un questionario a scelta multipla e risposta singola.`,
  'Il candidato ha superato il test ed ha ricevuto l’attestato in formato digitale.',
];

// Posizioni misurate sui modelli (punti PDF, origine in basso a sinistra).
// ivass-*: attestati Canva originali; privacy: generato da D-Academy dal Word dell'utente.
const layout: Record<string, { name: Pos; cf: Pos; verbale: (d: CertData) => string[] }> = {
  'ivass-30.pdf': { name: { x: 314, y: 672.5, size: 13 }, cf: { x: 307.4, y: 648, size: 20.5 }, verbale: verbaleIvass },
  'ivass-60.pdf': { name: { x: 300.3, y: 640.5, size: 12 }, cf: { x: 291.7, y: 601, size: 20 }, verbale: verbaleIvass },
  'privacy.pdf': { name: { x: 297.75, y: 640, size: 15 }, cf: { x: 297.75, y: 612, size: 19 }, verbale: verbalePrivacy },
};

export async function fillCertificate(template: Uint8Array, d: CertData): Promise<Uint8Array> {
  const pos = layout[d.template];
  if (!pos) throw new Error(`Modello sconosciuto: ${d.template}`);
  const doc = await PDFDocument.load(template);
  const [p1, p2] = doc.getPages();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const black = rgb(0, 0, 0);

  const centered = (text: string, at: Pos) => {
    // Restringe il corpo se il testo è più largo della pagina utile (nomi molto lunghi).
    const size = Math.min(at.size, at.size * 500 / italic.widthOfTextAtSize(text, at.size));
    p1.drawText(text, { x: at.x - italic.widthOfTextAtSize(text, size) / 2, y: at.y, size, font: italic, color: black });
  };
  centered(d.name, pos.name);
  centered(`CF: ${d.cf}`, pos.cf);

  // Verbale: testo giustificato come nell'originale.
  const paragraphs = pos.verbale(d);
  const size = 11.5, lead = 14.25, left = 30.1, width = 537;
  let y = 700.5;
  for (const para of paragraphs) {
    const words = para.split(' ');
    let line: string[] = [];
    const flush = (last: boolean) => {
      const w = line.map((t) => regular.widthOfTextAtSize(t, size));
      const gap = last || line.length < 2 ? regular.widthOfTextAtSize(' ', size) : (width - w.reduce((a, b) => a + b, 0)) / (line.length - 1);
      let x = left;
      line.forEach((t, i) => { p2.drawText(t, { x, y, size, font: regular, color: black }); x += w[i] + gap; });
      y -= lead;
      line = [];
    };
    for (const word of words) {
      if (line.length && regular.widthOfTextAtSize([...line, word].join(' '), size) > width) flush(false);
      line.push(word);
    }
    flush(true);
  }
  p2.drawText(`Lì ${d.date}, Desenzano del Garda`, { x: 35.6, y: 529, size, font: regular, color: black });
  p2.drawText(`Attestato n. ${d.serial} · codice di verifica ${d.code}`, { x: left, y: 40, size: 8, font: regular, color: rgb(0.4, 0.4, 0.4) });

  if (d.demo) {
    for (const p of doc.getPages()) {
      p.drawText('ATTESTATO DI PROVA - NON VALIDO', {
        x: 95, y: 250, size: 34, font: regular, color: rgb(0.85, 0.2, 0.15), opacity: 0.25, rotate: degrees(45),
      });
    }
  }
  doc.setTitle(`Attestato ${d.name}`);
  doc.setAuthor('D-Academy');
  return doc.save();
}

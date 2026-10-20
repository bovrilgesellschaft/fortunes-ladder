// The Library (Step 9, Ruling 6): where finished Memoirs are kept, shared and exported.
//
// Memoirs are kept in the page's private database, one shelf per reader, when the page is
// granted it; otherwise in the browser. A shared Memoir goes on a shelf every reader of the page
// can see, and is opened by a plain anchor: #m-<id>. Export offers a bound HTML book (which prints
// to PDF from any browser) and an EPUB, saved only when the reader confirms.

import type { Memoir } from './campaign';
import { store } from './view';

const LOCAL = 'picaresque-library';

interface Doc { exists?: boolean; data(): Record<string, unknown> | undefined }
interface DocRef { get(): Promise<Doc>; set(d: Record<string, unknown>): Promise<void>; collection(p: string): ColRef }
interface ColRef { doc(id?: string): DocRef; get(): Promise<{ docs: (Doc & { id: string })[] }> }
interface Db { doc(p: string): DocRef; collection(p: string): ColRef }

/** What the Library lists: everything but the text. */
export interface MemoirMeta { id: string; finished: number; how: string; hero: string; title: Memoir['title']; total: number }
const meta = (m: Memoir): MemoirMeta => ({ id: m.id, finished: m.finished, how: m.how, hero: m.hero, title: m.title, total: m.subscribers.total });

type ClaudeUse = { use(name: string): Promise<unknown> };
const claude = () => (globalThis as unknown as { claude?: ClaudeUse }).claude;
async function use<T>(name: string): Promise<T | null> {
  try { const c = claude(); return c ? ((await c.use(name)) as T | null) : null; } catch { return null; }
}

export class Library {
  private db: Db | null = null;
  private uid: string | null = null;
  ready: Promise<void>;
  /** Where Memoirs are kept: "database" or "browser". */
  where: 'database' | 'browser' = 'browser';

  constructor() {
    this.ready = (async () => {
      const db = await use<Db>('db'), user = await use<{ id(): Promise<string | null> }>('user');
      const uid = user ? await user.id().catch(() => null) : null;
      if (db && uid) { this.db = db; this.uid = uid; this.where = 'database'; }
    })();
  }

  private local(): Memoir[] { try { return JSON.parse(store.get(LOCAL) ?? '[]') as Memoir[]; } catch { return []; } }
  private shelf() { return this.db!.collection(`data/users/${this.uid}/lib/memoirs`); }

  async list(): Promise<MemoirMeta[]> {
    await this.ready;
    if (!this.db) return this.local().map(meta).sort((a, b) => b.finished - a.finished);
    try {
      const q = await this.shelf().get();
      return q.docs.map(d => d.data() as unknown as MemoirMeta).filter(Boolean).sort((a, b) => b.finished - a.finished);
    } catch { return this.local().map(meta); }
  }

  /** A Memoir is kept as its meta document and one document per volume (each under the store's size limit). */
  private async write(ref: DocRef, m: Memoir) {
    const { volumes, ...rest } = m;
    await ref.set({ ...rest, ...meta(m), vols: volumes.length });
    for (const [i, v] of volumes.entries()) await ref.collection('vols').doc(String(i)).set(v as unknown as Record<string, unknown>);
  }
  private async read(ref: DocRef): Promise<Memoir | null> {
    const d = await ref.get(); const x = d.data() as (Omit<Memoir, 'volumes'> & { vols: number }) | undefined;
    if (!x) return null;
    const volumes: Memoir['volumes'] = [];
    for (let i = 0; i < x.vols; i++) { const v = (await ref.collection('vols').doc(String(i)).get()).data(); if (v) volumes.push(v as unknown as Memoir['volumes'][number]); }
    return { ...x, volumes } as Memoir;
  }

  async put(m: Memoir): Promise<void> {
    await this.ready;
    const all = this.local().filter(x => x.id !== m.id); all.push(m);
    if (!this.db) { store.set(LOCAL, JSON.stringify(all)); return; }
    try { await this.write(this.shelf().doc(m.id), m); } catch { store.set(LOCAL, JSON.stringify(all)); }
  }

  async get(id: string): Promise<Memoir | null> {
    await this.ready;
    const loc = this.local().find(x => x.id === id) ?? null;
    if (!this.db) return loc;
    try { return (await this.read(this.shelf().doc(id))) ?? loc; } catch { return loc; }
  }

  /** On the shelf every reader of the page can see; returns the anchor, or null if it cannot be shared here. */
  async share(m: Memoir): Promise<string | null> {
    await this.ready;
    if (!this.db) return null;
    try { await this.write(this.db.doc(`shelf/${m.id}`), m); return `#m-${m.id}`; } catch { return null; }
  }
  async shared(id: string): Promise<Memoir | null> {
    await this.ready;
    if (!this.db) return null;
    try { return await this.read(this.db.doc(`shelf/${id}`)); } catch { return null; }
  }

  /** Offer a file to save; false if this view cannot. */
  static async save(filename: string, data: string | Uint8Array, type: string): Promise<'saved' | 'declined' | 'unavailable'> {
    const dl = await use<{ save(r: { filename: string; data: string | Blob }): Promise<unknown> }>('downloads');
    if (!dl) return 'unavailable';
    try { await dl.save({ filename, data: new Blob([data as BlobPart], { type }) }); return 'saved'; } catch { return 'declined'; }
  }
}

// ---------- the Memoir as text ----------

/** The title on one line: "A Narrative of the Misfortunes of Mr X", or "Memoirs of a Gentleman, Written by Himself — Mr X". */
export const titleLine = (t: Memoir['title']) => `${t.framing}${/ of$/.test(t.framing) ? ' ' : ' — '}${t.name}`;

const SYM = ['*', '†', '‡', '§'];
/** Passages carry glossary spans and the odd tag; a book wants plain, well-formed text. */
export const plain = (h: string) => h.replace(/<span class="cant"[^>]*>([^<]*)<\/span>/g, '$1').replace(/<(?!\/?(i|b|em|sup)\b)[^>]+>/g, '');
const xml = (h: string) => plain(h).replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;').replace(/<(\/?)(i|b|em|sup)>/g, '<$1$2>');

/** The Memoir's body, as HTML: title page, dedication, volumes, subscribers. */
export function memoirBody(m: Memoir, x = (h: string) => h): string {
  const t = m.title;
  const title = `<section class="mtitle"><p class="mframing">${x(t.framing)}</p><h1 class="mname">${x(t.name)}</h1><p class="msub">${x(t.subtitle)}</p><p class="mvols">${x(t.volumes)}</p><div class="fleuron" aria-hidden="true">❧</div><p class="mimprint">${x(t.imprint)}</p></section>`;
  const ded = `<section class="mded"><p class="mdedhead">The Dedication</p><p>${x(m.dedication)}</p></section>`;
  const vols = m.volumes.map(v => `<section class="mvol"><p class="mvolno">Book ${v.book}</p><h2 class="mvolt">${x(v.title)}</h2><p class="mvolopen">${x(v.opening)}</p>${v.chapters.map(c => `<div class="mchap"><p class="mchapno">Chap. ${toRoman(c.no)}.</p><p class="mchapin">${x(c.heading.replace(/\.*$/, ''))}.</p>${c.passages.map((p, i) => `<p${i === 0 ? ' class="first"' : ''}>${x(p)}${i === c.passages.length - 1 ? c.notes.map((_, k) => `<sup>${SYM[k] ?? k + 1}</sup>`).join('') : ''}</p>`).join('')}${c.notes.length ? `<div class="mnotes">${c.notes.map((n, k) => `<p>${SYM[k] ?? k + 1} ${x(n)}</p>`).join('')}</div>` : ''}</div>`).join('')}</section>`).join('');
  const subs = `<section class="msubs"><h2>A List of the Subscribers</h2><p class="mtotal">${x(words(m.subscribers.total))} Subscribers</p><ul>${m.subscribers.names.map(n => `<li>${x(n)}</li>`).join('')}</ul>${m.subscribers.others ? `<p class="mothers">and ${x(words(m.subscribers.others).toLowerCase())} others.</p>` : ''}<p class="finis">Finis.</p></section>`;
  return title + ded + vols + subs;
}

const BOOK_CSS = `body{margin:0;background:#f4f0e6;color:#1f1b16;font:18px/1.6 'Libre Caslon Text',Georgia,serif}main{max-width:36em;margin:0 auto;padding:48px 20px}section{margin:0 0 64px}.mtitle{text-align:center;padding:48px 0}.mframing{font-variant:small-caps;letter-spacing:.06em}.mname{font-size:1.9em;line-height:1.2;margin:.4em 0}.msub,.mvols{font-style:italic}.mimprint{font-size:.85em;margin-top:2em}.mded{font-style:italic;text-align:center}.mdedhead,.mvolno,.mchapno{font-variant:small-caps;letter-spacing:.08em;text-align:center}.mvolt{text-align:center;font-weight:normal}.mvolopen{font-style:italic}.mchapin{text-align:center;font-style:italic}.mchap p.first::first-letter{font-size:2.6em;float:left;line-height:.9;padding-right:4px}.mnotes{font-size:.85em;border-top:1px solid #a89a80;margin-top:1em}.msubs ul{list-style:none;padding:0;columns:2}.mtotal,.mothers,.finis{text-align:center}.finis{font-variant:small-caps;margin-top:2em}.fleuron{text-align:center;color:#8b2f1f}`;

/** A bound HTML book: one file, opens anywhere, prints to PDF. */
export function htmlBook(m: Memoir): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${plain(titleLine(m.title))}</title><style>${BOOK_CSS}@media print{body{background:#fff}section{page-break-after:always}}</style></head><body><main>${memoirBody(m)}</main></body></html>`;
}

/** An EPUB: a zip, stored without compression, with the mimetype first, as the format requires. */
export function epub(m: Memoir): Uint8Array {
  const page = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en-GB"><head><meta charset="utf-8"/><title>${title}</title><link rel="stylesheet" href="book.css"/></head><body>${body.replace(/<br>/g, '<br/>')}</body></html>`;
  const name = xml(titleLine(m.title));
  const files: [string, string][] = [];
  const body = memoirBody(m, xml);
  const parts = body.split(/(?=<section class="m(?:ded|vol|subs)")/);
  parts.forEach((p, i) => files.push([`OEBPS/p${i}.xhtml`, page(name, p)]));
  const nav = page('Contents', `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>${parts.map((p, i) => `<li><a href="p${i}.xhtml">${i === 0 ? 'Title' : /mded/.test(p) ? 'The Dedication' : /msubs/.test(p) ? 'The Subscribers' : `Book ${i - 1}`}</a></li>`).join('')}</ol></nav>`);
  const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">picaresque-${m.id}</dc:identifier><dc:title>${name}</dc:title><dc:language>en-GB</dc:language><dc:creator>Picaresque</dc:creator><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="book.css" media-type="text/css"/>${parts.map((_, i) => `<item id="p${i}" href="p${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${parts.map((_, i) => `<itemref idref="p${i}"/>`).join('')}</spine></package>`;
  const container = `<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  return zip([['mimetype', 'application/epub+zip'], ['META-INF/container.xml', container], ['OEBPS/content.opf', opf], ['OEBPS/nav.xhtml', nav], ['OEBPS/book.css', BOOK_CSS], ...files]);
}

// ---------- a stored (uncompressed) zip ----------

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder(), chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255], u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)]);
    chunks.push(head, nb, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += head.length + nb.length + data.length;
  }
  const cen = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cen), ...u32(off), ...u16(0)]);
  const out = new Uint8Array(off + cen + end.length); let p = 0;
  for (const c of [...chunks, ...central, end]) { out.set(c, p); p += c.length; }
  return out;
}

// ---------- numbers ----------

export function toRoman(n: number): string {
  const t: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s;
}
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
/** 412 → "Four Hundred and Twelve", as a subscription list would print it. */
export function words(n: number): string {
  if (n === 0) return 'No';
  const under100 = (x: number) => (x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? '-' + ONES[x % 10] : ''));
  const parts: string[] = [];
  if (n >= 1000) { parts.push(`${under100(Math.floor(n / 1000))} Thousand`); n %= 1000; }
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n) parts.push((parts.length ? 'and ' : '') + under100(n));
  return parts.join(' ');
}

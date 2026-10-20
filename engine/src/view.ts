// The parts of the page shared by a Venture's own page and the run: the Ledger, the Story tab,
// the long s, the Editor's dictionaries, the toggles, and the Venture itself (beats, Fortune's
// Wheel, the Reckoning), in the layout and visual identity of the published ball.html.

import { Run, money, odds, sgn, UPGOOD } from './core';
import type { Chip } from './core';
import type { GlossaryEntry, Option, Passage, Segment } from './types';
import { SEGMENTS, SEGMENT_NAMES } from './types';

export const SEG: [Segment, string][] = SEGMENTS.map(s => [s, SEGMENT_NAMES[s]]);
const COLS = ['--w-t', '--w-s', '--w-c', '--w-r', '--w-x'];

export const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, val: string) => { try { localStorage.setItem(k, val); } catch { /* storage unavailable */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};
export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ---------- the page chrome: long s, dictionaries, toggles, tabs ----------

export class Chrome {
  longS = false;
  voice: 'sm' | 'st' = 'sm';
  onStory: () => void = () => {};

  constructor(readonly key: string, readonly glossary: Record<string, GlossaryEntry>) {
    // the Editor's dictionaries
    const HEAD = { cant: 'The Editor’s canting dictionary', town: 'The Editor’s dictionary of the Town' };
    const gl = $('#gloss');
    const show = (t: HTMLElement) => {
      const k = t.dataset.t!; const g = this.glossary[k];
      gl.innerHTML = `<div class="gh">${g ? HEAD[g.dictionary] : ''}</div><div class="gt">${k}</div><div>${g?.definition ?? ''}</div>`;
      gl.hidden = false; const r = t.getBoundingClientRect(); const W = Math.min(272, innerWidth - 32); gl.style.maxWidth = W + 'px';
      let x = r.left + scrollX; x = Math.max(16 + scrollX, Math.min(x, scrollX + innerWidth - W - 16)); gl.style.left = x + 'px'; gl.style.top = (r.bottom + scrollY + 6) + 'px';
    };
    document.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.cant');
      if (t) { show(t); e.stopPropagation(); } else if (!(e.target as HTMLElement).closest('#gloss')) gl.hidden = true;
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') gl.hidden = true;
      const t = e.target as HTMLElement;
      if ((e.key === 'Enter' || e.key === ' ') && t.classList && t.classList.contains('cant')) { e.preventDefault(); show(t); }
    });

    // toggles
    const devBtn = $('#devBtn'), lsBtn = $('#longsBtn');
    devBtn.onclick = () => this.setDev(!document.body.classList.contains('devon'));
    lsBtn.onclick = () => this.setLS(!this.longS);
    this.setDev(store.get(key + '-dev') === '1');

    // tabs
    $('#tabPlay').onclick = () => this.switchTab('play'); $('#tabStory').onclick = () => this.switchTab('story');
    $('.tabs').addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const st = $('#storyPane').hidden; this.switchTab(st ? 'story' : 'play'); (st ? $('#tabStory') : $('#tabPlay')).focus(); }
    });
    $('#vSm').onclick = () => this.setVoice('sm'); $('#vSt').onclick = () => this.setVoice('st');
    if (store.get(key + '-voice') === 'st') this.voice = 'st';
    this.setVoice(this.voice);

    // the Ledger is open on wide screens
    const mq = matchMedia('(min-width: 861px)'); const lb = $<HTMLDetailsElement>('#ledgerBox');
    mq.addEventListener('change', () => { if (mq.matches) lb.open = true; });
    if (!mq.matches) lb.open = false;
  }

  /** Call once the page is drawn. */
  restoreLongS() { if (store.get(this.key + '-ls') === '1') this.setLS(true); }

  setDev(on: boolean) { document.body.classList.toggle('devon', on); $('#devBtn').setAttribute('aria-pressed', String(on)); store.set(this.key + '-dev', on ? '1' : '0'); }
  setLS(on: boolean) { this.longS = on; $('#longsBtn').setAttribute('aria-pressed', String(on)); this.applyLongS(document.querySelector('main')!); store.set(this.key + '-ls', on ? '1' : '0'); }
  setVoice(x: 'sm' | 'st') {
    this.voice = x; $('#vSm').setAttribute('aria-pressed', String(x === 'sm')); $('#vSt').setAttribute('aria-pressed', String(x === 'st'));
    store.set(this.key + '-voice', x); this.onStory();
  }

  applyLongS(root: Node) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement!.closest('.prose,.chap') && !n.parentElement!.closest('.dev') ? 1 : 3) });
    let n: Node | null;
    while ((n = w.nextNode())) n.nodeValue = this.longS ? n.nodeValue!.replace(/s(?=[ac-eg-jl-zA-Z])/g, 'ſ') : n.nodeValue!.replace(/ſ/g, 's');
  }

  markUnread() { if ($('#storyPane').hidden) $('#storyNew').hidden = false; }

  switchTab(t: 'play' | 'story') {
    const st = t === 'story';
    $('#playPane').hidden = st; $('#storyPane').hidden = !st;
    $('#tabPlay').setAttribute('aria-selected', String(!st)); $('#tabStory').setAttribute('aria-selected', String(st));
    $('#tabPlay').tabIndex = st ? -1 : 0; $('#tabStory').tabIndex = st ? 0 : -1;
    if (st) { $('#storyNew').hidden = true; this.onStory(); }
    const top = $('.tabs').getBoundingClientRect().top; if (top < 0) $('.tabs').scrollIntoView({ block: 'start' });
  }

  /** The Story tab: chapters, each a heading and its passages in the chosen voice. */
  renderStory(chapters: { no: string; heading: string; passages: (Passage & { fresh?: boolean })[] }[]) {
    const pane = $('#storyBody');
    const full = chapters.filter(c => c.passages.length);
    if (!full.length) { pane.innerHTML = '<p class="empty">Nothing novel-worthy has happened yet. The Story is written only when Fortune’s Wheel lands on Triumph or Catastrophe, or when a milestone is passed.</p>'; return; }
    pane.innerHTML = full.map(c => `<div class="chap"><div class="no">${c.no}</div><div class="in">${c.heading}</div></div><div class="prose storyprose">${c.passages.map((p, i) => `<p class="${i === 0 ? 'first' : ''}${p.fresh ? ' fresh' : ''}">${p[this.voice]}</p>`).join('')}</div>`).join('');
    this.applyLongS(pane);
    if (!$('#storyPane').hidden) setTimeout(() => full.forEach(c => c.passages.forEach(p => (p.fresh = false))), 100);
  }
}

// ---------- the Ledger ----------

export interface LedgerData {
  who: { name: string; as: string; origin: string };
  purse: number; debts: number;
  /** null outside a Venture: Composure is set afresh at each Approach. */
  composure: number | null;
  attrs: Record<string, number>; hum: Record<string, number>;
  /** null when the hero passes under no Persona. */
  exposure: number | null;
  notoriety: number; celebrity: number; luck: number;
  conditions: string[]; tags: string[]; items: string[]; hooks: string[];
  /** Extra rows under "Circumstances" (a run's date, lodging, rank, Upkeep). */
  circumstances?: [string, string][];
  /** A run's Appearances: one row per slot, the score against the rank's expectation, and Credit. */
  appearance?: { rows: [string, string][]; score: number; expected: number; credit: number };
  /** A run's debts by kind, in place of the single Debts line, and any writs out. */
  debtRows?: [string, string][];
  writs?: string[];
}

export class Ledger {
  private prev: Record<string, unknown> = {};
  reset() { this.prev = {}; }

  render(L: LedgerData) {
    const vals: Record<string, unknown> = {
      purse: money(L.purse), debts: money(L.debts), composure: L.composure, luck: L.luck, exposure: L.exposure, notoriety: L.notoriety, celebrity: L.celebrity,
      ...Object.fromEntries(Object.entries(L.hum).map(([k, x]) => ['h' + k, x])),
      conditions: L.conditions.join('|'), tags: L.tags.join('|'), items: L.items.join('|'), hooks: L.hooks.join('|'),
      circ: (L.circumstances ?? []).map(x => x.join(':')).join('|'),
      app: L.appearance ? L.appearance.rows.map(x => x.join(':')).join('|') + L.appearance.score : '',
      debtRows: (L.debtRows ?? []).map(x => x.join(':')).join('|') + (L.writs ?? []).join('|'),
    };
    const f = (k: string) => (this.prev[k] !== undefined && this.prev[k] !== vals[k] ? ' flash' : '');
    const meter = (k: string, x: number, max: number, cls = '') => `<div class="meter ${cls}${f(cls === 'exp' ? 'exposure' : 'h' + k)}"><span>${k}</span><span class="bar"><b style="width:${x / max * 100}%"></b></span><em>${x}/${max}</em></div>`;
    const list = (arr: string[], none: string) => (arr.length ? arr.map(x => `<li>${x}</li>`).join('') : `<li class="none">${none}</li>`);
    $('#ledger').innerHTML = `
   <div class="who"><div class="nm">${L.who.name}</div><div class="as">${L.who.as}</div><div class="orig">${L.who.origin}</div></div>
   ${L.circumstances?.length ? `<h3>Circumstances</h3><dl class="kv circ${f('circ')}">${L.circumstances.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join('')}</dl>` : ''}
   <h3>Purse &amp; debts</h3>
   <dl class="kv"><dt>Purse</dt><dd class="${f('purse').trim()}">${vals.purse}</dd>${L.debtRows
     ? L.debtRows.map(([k, x]) => `<dt>${k}</dt><dd class="${f('debtRows').trim()}">${x}</dd>`).join('')
     : `<dt>Debts</dt><dd class="${f('debts').trim()}">${vals.debts}</dd>`}</dl>
   ${L.writs?.length ? `<ul class="lst writs">${L.writs.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}
   ${L.appearance ? `<h3>Appearances</h3>
   <dl class="kv app${f('app')}">${L.appearance.rows.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join('')}</dl>
   <div class="appsum${L.appearance.score < L.appearance.expected ? ' short' : ''}"><span>${L.appearance.score} of the ${L.appearance.expected} expected</span><span>Credit ${money(L.appearance.credit)}</span></div>` : ''}
   ${L.composure === null ? '' : `<h3>Composure</h3>
   <div class="pips${f('composure')}" aria-label="Composure ${L.composure} of 8">${Array.from({ length: 8 }, (_, i) => `<i class="${i < L.composure! ? 'on' : ''}"></i>`).join('')}</div>`}
   <h3>Attributes</h3>
   <div class="attrs">${Object.entries(L.attrs).map(([k, x]) => `<div><span>${k.slice(0, 4)}.</span><b>${x}</b></div>`).join('')}</div>
   <h3>Humours</h3>
   ${Object.entries(L.hum).map(([k, x]) => meter(k, x, 5)).join('')}
   <h3>Standing</h3>
   ${L.exposure === null ? '' : meter('Exposure', L.exposure, 10, 'exp')}
   <dl class="kv"><dt>Notoriety</dt><dd class="${f('notoriety').trim()}">${L.notoriety}</dd><dt>Celebrity</dt><dd class="${f('celebrity').trim()}">${L.celebrity}</dd><dt>Luck</dt><dd class="${f('luck').trim()}">${L.luck}</dd></dl>
   ${L.conditions.length ? `<h3>Conditions</h3><ul class="lst${f('conditions')}">${list(L.conditions, 'none')}</ul>` : ''}
   <h3>Tags</h3><ul class="lst${f('tags')}">${list(L.tags, 'none')}</ul>
   <h3>Possessions</h3><ul class="lst${f('items')}">${list(L.items, 'nothing')}</ul>
   <h3>Hooks</h3><ul class="lst${f('hooks')}">${list(L.hooks, 'none')}</ul>`;
    $('#ledSum').textContent = `${vals.purse}${L.composure === null ? '' : ` · Composure ${L.composure}/8`}`;
    this.prev = vals;
  }
}

// ---------- a Venture on the page ----------

export interface Choice { beat: string; opt: number; seg?: Segment; luck?: boolean }

export interface Host {
  chrome: Chrome;
  /** A number in [0, 1) for the Wheel. */
  random(): number;
  /** Something in the run's state changed: redraw the Ledger. */
  changed(): void;
  /** A Story passage was written. */
  storied(): void;
  /** A choice was made and resolved (for saving). */
  chose(c: Choice): void;
  /** The Reckoning's closing button: its label, and what it does. */
  close: { label: string; act: () => void };
  /** How a rumour's delivery week is written. */
  weekLabel(w: number): string;
  /** The Exposure row's label in the Account, given the Persona at the Reckoning. */
  exposureLabel: (persona: string) => string;
}

export class VentureView {
  beatCount = 0;
  chapter = '';

  constructor(readonly run: Run, readonly host: Host, readonly root: HTMLElement) {}

  private stripHTML(p: number[]) {
    return `<span class="strip" aria-hidden="true">${p.map((x, i) => `<i style="width:${(x * 100).toFixed(1)}%;background:var(${COLS[i]})"></i>`).join('')}</span>`;
  }

  private optEl(o: Option, idx: number, beat: string, live: boolean) {
    const run = this.run;
    const b = document.createElement('button'); b.className = 'opt'; b.type = 'button';
    const g = run.gate(o);
    const locked = run.locked(o);
    const badges: string[] = [];
    let why = '';
    if (o.gate) badges.push(`<span class="badge ${g.ok ? 'ok' : 'no'}">${g.ok ? '✓' : '✗'} Requires ${g.need}</span>`);
    if (o.cost) badges.push(`<span class="badge cost">Costs ${run.inline(o.cost)}</span>`);
    if (!run.affordable(o)) badges.push(`<span class="badge no">✗ Needs ${money(run.cost(o))} · you have ${money(Math.max(0, run.S.purse))}</span>`);
    if (run.barred(o)) badges.push(`<span class="badge no">✗ ${run.barred(o)}</span>`);
    if (o.check) {
      const { m, b: bn, why: w, comp } = run.margin(o); why = w;
      badges.push(`<span class="badge">Wheel · ${o.check.attr} ${run.S.attrs[o.check.attr]}${bn ? (bn > 0 ? ' + ' : ' − ') + Math.abs(bn) : ''} vs ${o.check.diff}${comp ? ' · Composure spent' : ''}</span>${this.stripHTML(odds(m))}`);
    }
    if (!o.check && !locked) badges.push(`<span class="badge">Certain</span>`);
    if (o.withdraw) badges.push(`<span class="badge">Withdraw</span>`);
    b.innerHTML = `<span class="hand" aria-hidden="true">☞</span><span class="lbl">${run.inline(o.label)}</span><span class="badges">${badges.join('')}</span><span class="dev">${o.dev || ''}${o.check && why ? '\nmodifier: ' + why : ''}</span>`;
    if (locked) { b.disabled = true; b.classList.add('locked'); b.setAttribute('aria-disabled', 'true'); }
    else if (live) b.addEventListener('click', () => this.choose(o, idx, beat, b));
    return b;
  }

  renderBeat(id: string, live = true) {
    const run = this.run, bt = run.beats[id]; this.beatCount++;
    const sec = document.createElement('section'); sec.className = 'beat';
    sec.innerHTML = `<div class="dev devhead">storylet ${bt.sid} · beat ${this.beatCount} of 5\n${bt.dev ?? ''}</div>
   <h2><span class="phase">${bt.phase}</span><span class="num">${bt.num}.</span> ${bt.title}</h2>
   <div class="prose">${run.prose(bt.text)}</div>
   <p class="ask">${run.inline(bt.ask)}</p>
   <div class="choices" role="group" aria-label="${esc(run.inline(bt.ask).replace(/<[^>]+>/g, ''))}"></div>
   <div class="out"></div>
   ${bt.notes ? `<div class="notes prose">${bt.notes.map(n => `<p>${run.inline(n)}</p>`).join('')}</div>` : ''}`;
    const box = sec.querySelector('.choices')!;
    bt.options.forEach((o, i) => { if (!run.hidden(o)) box.appendChild(this.optEl(o, i, id, live)); });
    if (this.beatCount === 1) {
      // the opening prose carries the drop cap, unruled
      sec.style.borderTop = '0'; sec.style.marginTop = '0'; sec.style.paddingTop = '0';
      sec.querySelector('.prose')!.classList.add('opening');
    }
    this.root.appendChild(sec); this.host.chrome.applyLongS(sec);
    return sec;
  }

  private result(sec: Element, html: string, fx: Chip[], storied: boolean) {
    const out = sec.querySelector('.out')!;
    const r = document.createElement('div'); r.className = 'result';
    r.innerHTML = `<div class="prose">${html}</div><div class="chips">${fx.map(f => `<span class="chip ${f.tone}">${f.t}</span>`).join('')}</div>`;
    if (storied) {
      const b = document.createElement('button'); b.className = 'btn storylink'; b.type = 'button'; b.textContent = 'Read it in the Story ❧';
      b.onclick = () => this.host.chrome.switchTab('story'); r.appendChild(b);
    }
    out.appendChild(r); this.host.chrome.applyLongS(r);
    return r;
  }

  /** Draw a beat already played (after a reload): the choice marked, the result shown, no Wheel. */
  replayed(beat: string, c: Choice, html: string, fx: Chip[]) {
    const sec = this.renderBeat(beat, false);
    const box = sec.querySelector('.choices')!;
    const btns = box.querySelectorAll<HTMLButtonElement>('.opt');
    btns.forEach(x => (x.disabled = true)); box.classList.add('done'); btns[c.opt]?.classList.add('chosen');
    if (c.seg) {
      const w = document.createElement('div'); w.className = 'wheelbox replayed';
      w.innerHTML = `<div class="wheelctl"><span class="verdict">${SEGMENT_NAMES[c.seg]}.</span>${c.luck ? '<span class="dev">(nudged with Luck)</span>' : ''}</div>`;
      sec.querySelector('.out')!.appendChild(w);
    }
    this.result(sec, html, fx, fx.some(f => f.t.startsWith('❧')));
  }

  private choose(o: Option, idx: number, beat: string, btn: HTMLButtonElement) {
    const run = this.run;
    const box = btn.parentElement!, sec = box.parentElement!, out = sec.querySelector('.out')!;
    box.querySelectorAll<HTMLButtonElement>('.opt').forEach(x => (x.disabled = true));
    box.classList.add('done'); btn.classList.add('chosen');
    const finish = (seg?: Segment, luck?: boolean) => {
      const luckFx = run.fx.slice();
      const res = run.resolve(o, seg);
      run.fx = luckFx.concat(run.fx);
      this.host.chose({ beat, opt: idx, seg, luck });
      const storied = run.S.storyAdded; run.S.storyAdded = false;
      const r = this.result(sec, res.html, run.fx, storied);
      if (storied) { this.host.chrome.markUnread(); this.host.storied(); }
      this.host.changed();
      setTimeout(() => {
        if (res.next === 'reckon') this.renderReckon(); else this.renderBeat(res.next);
        r.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      }, 60);
    };
    run.fx = [];
    if (o.check) this.spin(out, run.margin(o).m, o).then(([seg, luck]) => finish(seg, luck));
    else finish();
  }

  private spin(out: Element, m: number, o: Option): Promise<[Segment, boolean]> {
    const run = this.run;
    return new Promise(res => {
      const p = odds(m);
      const cx = 100, cy = 108, r = 86;
      const pt = (a: number) => { const t = a * Math.PI / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
      let a = 0; const arcs: string[] = [], mids: [number, number][] = [];
      p.forEach((x, i) => {
        const a0 = a, a1 = a + x * 360; const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
        arcs.push(`<path d="M${cx} ${cy}L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z" fill="var(${COLS[i]})" stroke="var(--leaf)" stroke-width="1.5"/>`);
        mids.push([a0, a1]); a = a1;
      });
      const c = run.margin(o);
      const wb = document.createElement('div'); wb.className = 'wheelbox';
      wb.innerHTML = `<svg class="wheel" viewBox="0 0 200 200" role="img" aria-label="Fortune's Wheel"><g class="rot">${arcs.join('')}</g>
      <circle cx="${cx}" cy="${cy}" r="10" fill="var(--leaf)" stroke="var(--ink)" stroke-width="1.5"/>
      <path d="M${cx - 9} 4 L${cx + 9} 4 L${cx} 26 Z" fill="var(--ink)"/></svg>
      <ol class="legend">${SEG.map((s, i) => `<li data-i="${i}"><span class="sw" style="background:var(${COLS[i]})"></span><span>${s[1]}</span><span class="pc">${Math.round(p[i] * 100)}%</span></li>`).join('')}</ol>
      <div class="dev" style="flex-basis:100%">margin m = ${o.check!.attr} ${run.S.attrs[o.check!.attr]} ${(c.b ? (c.b > 0 ? '+ ' : '− ') + Math.abs(c.b) + ' ' : '') + (c.comp ? '− 2 (Composure 0) ' : '')}− diff ${o.check!.diff} = ${m}\nweights T,S,C,R,X = 10+5m, 30+5m, 25, 25−5m, 10−5m (floor 3), normalised</div>
      <div class="wheelctl"></div>`;
      out.appendChild(wb);
      const g = wb.querySelector<SVGGElement>('.rot')!, ctl = wb.querySelector<HTMLElement>('.wheelctl')!;
      const x = this.host.random(); let idx = 0, acc = 0;
      for (let i = 0; i < 5; i++) { acc += p[i]; if (x < acc || i === 4) { idx = i; break; } }
      // where in the segment the pointer lands is decoration, not chance
      const land = (i: number) => { const [a0, a1] = mids[i]; return a0 + (a1 - a0) * (0.3 + Math.random() * 0.4); };
      let theta = land(idx), R = 360 * 5 - theta;
      const reduce = reduceMotion();
      requestAnimationFrame(() => requestAnimationFrame(() => { g.style.transform = `rotate(${R}deg)`; }));
      const shown = (i: number) => {
        wb.querySelectorAll<HTMLElement>('.legend li').forEach(li => li.classList.toggle('hit', +li.dataset.i! === i));
        $('#live').textContent = 'The Wheel stops on ' + SEG[i][1] + '.';
      };
      setTimeout(() => {
        shown(idx);
        let nudged = false;
        const accept = () => { ctl.innerHTML = `<span class="verdict">${SEG[idx][1]}.</span>`; res([SEG[idx][0], nudged]); };
        if (idx > 0 && run.S.luck > 0) {
          ctl.innerHTML = `<span class="verdict">${SEG[idx][1]}.</span><button class="btn primary" type="button">Spend Luck · nudge to ${SEG[idx - 1][1]}</button><button class="btn" type="button">Accept the Wheel</button><span class="dev" style="flex-basis:100%">Luck ${run.S.luck}: moves the result one segment up. Earned through narrative irony; rare.</span>`;
          const [nb, ab] = ctl.querySelectorAll<HTMLButtonElement>('button');
          nb.onclick = () => {
            run.spendLuck(); nudged = true; this.host.changed();
            const t2 = land(idx - 1); R = R + (theta - t2); theta = t2; g.style.transform = `rotate(${R}deg)`; idx--;
            ctl.innerHTML = ''; setTimeout(() => { shown(idx); accept(); }, reduce ? 0 : 900);
          };
          ab.onclick = accept;
        } else accept();
      }, reduce ? 50 : 2400);
    });
  }

  renderReckon() {
    const run = this.run, v = run.v, R = v.reckoning;
    const { html, chapter } = run.reckon();
    this.chapter = chapter;
    const S = run.S, START = run.START;
    let lines = html;
    if (v.story && S.story.length) { this.host.chrome.markUnread(); lines += '<p class="storylink-p"><button class="btn storylink" type="button">Read the chapter in the Story ❧</button></p>'; }

    const ci = $('#chapIn'); ci.textContent = chapter; ci.classList.add('fresh'); this.host.chrome.applyLongS(ci.parentElement!);

    const rows: [string, string, number?][] = ([['Purse', 'purse', 1], ['Debts', 'debts', 1], ['Composure', 'composure'], ['Luck', 'luck'], [this.host.exposureLabel(S.persona), 'exposure'], ['Notoriety', 'notoriety'], ['Celebrity', 'celebrity']] as [string, string, number?][])
      .concat(Object.keys(S.hum).map(k => [k, 'hum.' + k] as [string, string]));
    const get = (o: unknown, p: string) => p.split('.').reduce((x: any, k) => x[k], o) as number;
    const tr = rows.map(([n, p, m]) => {
      const a = get(START, p), b = get(S, p); if (a === b && p.startsWith('hum')) return '';
      // a Persona taken up during the Venture starts its own Exposure: there is no before
      if (p === 'exposure' && START.persona !== S.persona) return `<tr><td>${n}</td><td class="n">—</td><td class="n">${b}</td><td class="d">new</td></tr>`;
      const d = b - a; const tone = p.startsWith('hum') ? '' : ((UPGOOD[p] || 0) * d > 0 ? 'good' : d ? 'bad' : '');
      return `<tr><td>${n}</td><td class="n">${m ? money(a) : a}</td><td class="n">${m ? money(b) : b}</td><td class="d ${tone}">${d ? (m ? (d > 0 ? '+' : '−') + money(Math.abs(d)) : sgn(d)) : '—'}</td></tr>`;
    }).join('');
    const diff = (x: string[], y: string[]) => x.filter(i => !y.includes(i));
    const li = (a: string[]) => (a.length ? a.map(x => `<li>${x}</li>`).join('') : '<li class="none">nothing</li>');
    const spent = diff(START.hooks, S.hooks);

    const sec = document.createElement('section'); sec.className = 'beat';
    sec.innerHTML = `<div class="dev devhead">storylet ${R.sid} · closes the Venture\n${R.dev ?? ''}</div>
   <h2><span class="phase">${R.phase}</span><span class="num">${R.num}.</span> ${R.title}</h2>
   <div class="prose">${lines}</div>
   <h3 class="sec">The Account</h3>
   <div class="tablewrap"><table class="account"><thead><tr><th></th><th style="text-align:right">Before</th><th style="text-align:right">After</th><th style="text-align:right">Change</th></tr></thead><tbody>${tr}</tbody></table></div>
   <div class="gained">
     <div><h4>Tags gained</h4><ul class="lst">${li(diff(S.tags, START.tags).concat(diff(S.conditions, START.conditions).map(x => x + ' (condition)')))}</ul></div>
     <div><h4>Possessions</h4><ul class="lst">${li(diff(S.items, START.items).map(x => '+ ' + x).concat(diff(START.items, S.items).map(x => '− ' + x)))}</ul></div>
     <div><h4>Hooks</h4><ul class="lst">${li(diff(S.hooks, START.hooks).map(x => '+ ' + x).concat(spent.map(x => '− ' + x + ' (spent)')))}</ul></div>
   </div>
   <div class="dev" style="margin-top:12px">ledger of causes\n${S.log.map(l => '· ' + l).join('\n')}</div>
   <h3 class="sec">Rumours abroad</h3>
   <p class="ask" style="margin-top:4px">${S.rumours.length ? R.post.some : R.post.none}</p>
   <div class="letters">${S.rumours.map(r => `<div class="letter"><span class="seal" aria-hidden="true">${r.from.replace(/^(The |Mr |Mrs |Lady |A |Sir |Every )/, '')[0]}</span><div class="wk">To be delivered · ${this.host.weekLabel(r.week)}</div><div class="fr">${r.from}</div><div class="prose">${r.text}</div><div class="dev" style="margin-top:6px">on delivery: ${r.effect}</div></div>`).join('')}</div>
   <div class="next"><p>${run.inline(R.upkeep)}</p><button class="btn primary" type="button" id="again">${this.host.close.label}</button></div>
   ${R.notes ? `<div class="notes prose">${R.notes.map(n => `<p>${run.inline(n)}</p>`).join('')}</div>` : ''}
   <div class="finis">${R.finis}</div>`;
    this.root.appendChild(sec); this.host.chrome.applyLongS(sec); this.host.changed();
    sec.querySelector<HTMLButtonElement>('#again')!.onclick = () => this.host.close.act();
    const sl = sec.querySelector<HTMLButtonElement>('.storylink'); if (sl) sl.onclick = () => this.host.chrome.switchTab('story');
    this.host.storied();
    return sec;
  }
}

/** A Run's state as the Ledger shows it, during a Venture. */
export function ledgerFromRun(run: Run, who: LedgerData['who'], showExposure = true, circumstances?: [string, string][]): LedgerData {
  const S = run.S;
  return {
    who, purse: S.purse, debts: S.debts, composure: S.composure, attrs: S.attrs, hum: S.hum,
    exposure: showExposure ? S.exposure : null, notoriety: S.notoriety, celebrity: S.celebrity, luck: S.luck,
    conditions: S.conditions, tags: S.tags, items: S.items, hooks: S.hooks, circumstances,
  };
}

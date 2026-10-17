// The page: renders a Venture from content, in the layout and visual identity of the
// published ball.html (tabs for the Venture and the Story, the Ledger in the margin,
// Fortune's Wheel, the Reckoning). Ported from the prototype; behaviour is unchanged.

import { Run, money, odds, sgn, UPGOOD } from './core';
import type { Content, Option, Segment } from './types';
import { SEGMENTS, SEGMENT_NAMES } from './types';

const SEG: [Segment, string][] = SEGMENTS.map(s => [s, SEGMENT_NAMES[s]]);
const COLS = ['--w-t', '--w-s', '--w-c', '--w-r', '--w-x'];

export function mount(content: Content) {
  const v = content.venture;
  const run = new Run(content);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
  const story = $('#story'), ledger = $('#ledger');
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let prevLedger: Record<string, unknown> = {};
  let beatCount = 0;
  let voice: 'sm' | 'st' = 'sm';
  let longS = false;
  const store = {
    get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k: string, val: string) => { try { localStorage.setItem(k, val); } catch { /* storage unavailable */ } },
  };

  // ---------- options ----------
  const stripHTML = (p: number[]) =>
    `<span class="strip" aria-hidden="true">${p.map((x, i) => `<i style="width:${(x * 100).toFixed(1)}%;background:var(${COLS[i]})"></i>`).join('')}</span>`;

  function optEl(o: Option) {
    const b = document.createElement('button'); b.className = 'opt'; b.type = 'button';
    const g = run.gate(o);
    const locked = run.locked(o);
    const badges: string[] = [];
    let why = '';
    if (o.gate) badges.push(`<span class="badge ${g.ok ? 'ok' : 'no'}">${g.ok ? '✓' : '✗'} Requires ${g.need}</span>`);
    if (o.cost) badges.push(`<span class="badge cost">Costs ${run.inline(o.cost)}</span>`);
    if (o.check) {
      const { m, b: bn, why: w, comp } = run.margin(o); why = w;
      badges.push(`<span class="badge">Wheel · ${o.check.attr} ${run.S.attrs[o.check.attr]}${bn ? (bn > 0 ? ' + ' : ' − ') + Math.abs(bn) : ''} vs ${o.check.diff}${comp ? ' · Composure spent' : ''}</span>${stripHTML(odds(m))}`);
    }
    if (!o.check && !locked) badges.push(`<span class="badge">Certain</span>`);
    if (o.withdraw) badges.push(`<span class="badge">Withdraw</span>`);
    b.innerHTML = `<span class="hand" aria-hidden="true">☞</span><span class="lbl">${run.inline(o.label)}</span><span class="badges">${badges.join('')}</span><span class="dev">${o.dev || ''}${o.check && why ? '\nmodifier: ' + why : ''}</span>`;
    if (locked) { b.disabled = true; b.classList.add('locked'); b.setAttribute('aria-disabled', 'true'); }
    else b.addEventListener('click', () => choose(o, b));
    return b;
  }

  function renderBeat(id: string) {
    const bt = run.beats[id]; beatCount++;
    const sec = document.createElement('section'); sec.className = 'beat';
    sec.innerHTML = `<div class="dev devhead">storylet ${bt.sid} · beat ${beatCount} of 5\n${bt.dev ?? ''}</div>
   <h2><span class="phase">${bt.phase}</span><span class="num">${bt.num}.</span> ${bt.title}</h2>
   <div class="prose">${run.prose(bt.text)}</div>
   <p class="ask">${bt.ask}</p>
   <div class="choices" role="group" aria-label="${bt.ask}"></div>
   <div class="out"></div>
   ${bt.notes ? `<div class="notes prose">${bt.notes.map(n => `<p>${run.inline(n)}</p>`).join('')}</div>` : ''}`;
    const box = sec.querySelector('.choices')!;
    bt.options.forEach(o => box.appendChild(optEl(o)));
    story.appendChild(sec); applyLongS(sec);
    return sec;
  }

  function choose(o: Option, btn: HTMLButtonElement) {
    const box = btn.parentElement!, sec = box.parentElement!, out = sec.querySelector('.out')!;
    box.querySelectorAll<HTMLButtonElement>('.opt').forEach(x => (x.disabled = true));
    box.classList.add('done'); btn.classList.add('chosen');
    const finish = (seg?: Segment) => {
      const luckFx = run.fx.slice();
      const res = run.resolve(o, seg);
      run.fx = luckFx.concat(run.fx);
      const r = document.createElement('div'); r.className = 'result';
      r.innerHTML = `<div class="prose">${res.html}</div><div class="chips">${run.fx.map(f => `<span class="chip ${f.tone}">${f.t}</span>`).join('')}</div>`;
      if (run.S.storyAdded) {
        const b = document.createElement('button'); b.className = 'btn storylink'; b.type = 'button'; b.textContent = 'Read it in the Story ❧';
        b.onclick = () => switchTab('story'); r.appendChild(b); run.S.storyAdded = false;
        markUnread(); renderStory();
      }
      out.appendChild(r); applyLongS(r); renderLedger();
      setTimeout(() => {
        if (res.next === 'reckon') renderReckon(); else renderBeat(res.next);
        r.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      }, 60);
    };
    run.fx = [];
    if (o.check) spin(out, run.margin(o).m, o).then(finish);
    else finish();
  }

  function spin(out: Element, m: number, o: Option): Promise<Segment> {
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
      const x = Math.random(); let idx = 0, acc = 0;
      for (let i = 0; i < 5; i++) { acc += p[i]; if (x < acc || i === 4) { idx = i; break; } }
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
        const accept = () => { ctl.innerHTML = `<span class="verdict">${SEG[idx][1]}.</span>`; res(SEG[idx][0]); };
        if (idx > 0 && run.S.luck > 0) {
          ctl.innerHTML = `<span class="verdict">${SEG[idx][1]}.</span><button class="btn primary" type="button">Spend Luck · nudge to ${SEG[idx - 1][1]}</button><button class="btn" type="button">Accept the Wheel</button><span class="dev" style="flex-basis:100%">Luck ${run.S.luck}: moves the result one segment up. Earned through narrative irony; rare.</span>`;
          const [nb, ab] = ctl.querySelectorAll<HTMLButtonElement>('button');
          nb.onclick = () => {
            run.spendLuck(); renderLedger();
            const t2 = land(idx - 1); R = R + (theta - t2); theta = t2; g.style.transform = `rotate(${R}deg)`; idx--;
            ctl.innerHTML = ''; setTimeout(() => { shown(idx); accept(); }, reduce ? 0 : 900);
          };
          ab.onclick = accept;
        } else accept();
      }, reduce ? 50 : 2400);
    });
  }

  // ---------- the Ledger ----------
  function renderLedger() {
    const S = run.S, h = S.hum, a = S.attrs;
    const vals: Record<string, unknown> = {
      purse: money(S.purse), debts: money(S.debts), composure: S.composure, luck: S.luck, exposure: S.exposure, notoriety: S.notoriety, celebrity: S.celebrity,
      ...Object.fromEntries(Object.entries(h).map(([k, x]) => ['h' + k, x])),
      conditions: S.conditions.join('|'), tags: S.tags.join('|'), items: S.items.join('|'), hooks: S.hooks.join('|'),
    };
    const f = (k: string) => (prevLedger[k] !== undefined && prevLedger[k] !== vals[k] ? ' flash' : '');
    const meter = (k: string, x: number, max: number, cls = '') => `<div class="meter ${cls}${f(cls === 'exp' ? 'exposure' : 'h' + k)}"><span>${k}</span><span class="bar"><b style="width:${x / max * 100}%"></b></span><em>${x}/${max}</em></div>`;
    const list = (arr: string[], none: string) => (arr.length ? arr.map(x => `<li>${x}</li>`).join('') : `<li class="none">${none}</li>`);
    ledger.innerHTML = `
   <div class="who"><div class="nm">${v.who.name}</div><div class="as">${v.who.as}</div><div class="orig">${v.who.origin}</div></div>
   <h3>Purse &amp; debts</h3>
   <dl class="kv"><dt>Purse</dt><dd class="${f('purse').trim()}">${vals.purse}</dd><dt>Debts</dt><dd class="${f('debts').trim()}">${vals.debts}</dd></dl>
   <h3>Composure</h3>
   <div class="pips${f('composure')}" aria-label="Composure ${S.composure} of 8">${Array.from({ length: 8 }, (_, i) => `<i class="${i < S.composure ? 'on' : ''}"></i>`).join('')}</div>
   <h3>Attributes</h3>
   <div class="attrs">${Object.entries(a).map(([k, x]) => `<div><span>${k.slice(0, 4)}.</span><b>${x}</b></div>`).join('')}</div>
   <h3>Humours</h3>
   ${Object.entries(h).map(([k, x]) => meter(k, x, 5)).join('')}
   <h3>Standing</h3>
   ${meter('Exposure', S.exposure, 10, 'exp')}
   <dl class="kv"><dt>Notoriety</dt><dd class="${f('notoriety').trim()}">${S.notoriety}</dd><dt>Celebrity</dt><dd class="${f('celebrity').trim()}">${S.celebrity}</dd><dt>Luck</dt><dd class="${f('luck').trim()}">${S.luck}</dd></dl>
   ${S.conditions.length ? `<h3>Conditions</h3><ul class="lst${f('conditions')}">${list(S.conditions, 'none')}</ul>` : ''}
   <h3>Tags</h3><ul class="lst${f('tags')}">${list(S.tags, 'none')}</ul>
   <h3>Possessions</h3><ul class="lst${f('items')}">${list(S.items, 'nothing')}</ul>
   <h3>Hooks</h3><ul class="lst${f('hooks')}">${list(S.hooks, 'none')}</ul>`;
    $('#ledSum').textContent = `${vals.purse} · Composure ${S.composure}/8`;
    prevLedger = vals;
  }

  // ---------- the Reckoning ----------
  function renderReckon() {
    const R = v.reckoning;
    const { html, chapter } = run.reckon();
    const S = run.S, START = run.START;
    let lines = html;
    if (v.story && S.story.length) { markUnread(); lines += '<p class="storylink-p"><button class="btn storylink" type="button">Read the chapter in the Story ❧</button></p>'; }

    const ci = $('#chapIn'); ci.textContent = chapter; ci.classList.add('fresh'); applyLongS(ci.parentElement!);

    const rows: [string, string, number?][] = ([['Purse', 'purse', 1], ['Debts', 'debts', 1], ['Composure', 'composure'], ['Luck', 'luck'], [`Exposure (${v.persona})`, 'exposure'], ['Notoriety', 'notoriety'], ['Celebrity', 'celebrity']] as [string, string, number?][])
      .concat(Object.keys(S.hum).map(k => [k, 'hum.' + k] as [string, string]));
    const get = (o: unknown, p: string) => p.split('.').reduce((x: any, k) => x[k], o) as number;
    const tr = rows.map(([n, p, m]) => {
      const a = get(START, p), b = get(S, p); if (a === b && p.startsWith('hum')) return '';
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
   <div class="letters">${S.rumours.map(r => `<div class="letter"><span class="seal" aria-hidden="true">${r.from.replace(/^(The |Mr |Mrs |Lady |A |Sir |Every )/, '')[0]}</span><div class="wk">To be delivered · Week ${r.week}</div><div class="fr">${r.from}</div><div class="prose">${r.text}</div><div class="dev" style="margin-top:6px">on delivery: ${r.effect}</div></div>`).join('')}</div>
   <div class="next"><p>${run.inline(R.upkeep)}</p><button class="btn primary" type="button" id="again">${R.again}</button></div>
   ${R.notes ? `<div class="notes prose">${R.notes.map(n => `<p>${run.inline(n)}</p>`).join('')}</div>` : ''}
   <div class="finis">${R.finis}</div>`;
    story.appendChild(sec); applyLongS(sec); renderLedger();
    sec.querySelector<HTMLButtonElement>('#again')!.onclick = start;
    const sl = sec.querySelector<HTMLButtonElement>('.storylink'); if (sl) sl.onclick = () => switchTab('story');
    renderStory();
  }

  // ---------- the Story tab ----------
  function renderStory() {
    const pane = $('#storyBody');
    if (!run.S.story.length) { pane.innerHTML = '<p class="empty">Nothing novel-worthy has happened yet. The Story is written only when Fortune’s Wheel lands on Triumph or Catastrophe, or when a milestone is passed.</p>'; return; }
    const ch = $('#chapIn').textContent;
    pane.innerHTML = `<div class="chap"><div class="no">${v.chapter.no}</div><div class="in">${ch}</div></div><div class="prose storyprose">${run.S.story.map((p, i) => `<p class="${i === 0 ? 'first' : ''}${p.fresh ? ' fresh' : ''}">${p[voice]}</p>`).join('')}</div>`;
    applyLongS(pane);
  }
  function markUnread() { if ($('#storyPane').hidden) $('#storyNew').hidden = false; }
  function switchTab(t: 'play' | 'story') {
    const st = t === 'story';
    $('#playPane').hidden = st; $('#storyPane').hidden = !st;
    $('#tabPlay').setAttribute('aria-selected', String(!st)); $('#tabStory').setAttribute('aria-selected', String(st));
    $('#tabPlay').tabIndex = st ? -1 : 0; $('#tabStory').tabIndex = st ? 0 : -1;
    if (st) { $('#storyNew').hidden = true; renderStory(); setTimeout(() => run.S.story.forEach(p => (p.fresh = false)), 100); }
    const top = $('.tabs').getBoundingClientRect().top; if (top < 0) $('.tabs').scrollIntoView({ block: 'start' });
  }
  function setVoice(x: 'sm' | 'st') {
    voice = x; $('#vSm').setAttribute('aria-pressed', String(x === 'sm')); $('#vSt').setAttribute('aria-pressed', String(x === 'st'));
    store.set(v.id + '-voice', x); renderStory();
  }
  $('#tabPlay').onclick = () => switchTab('play'); $('#tabStory').onclick = () => switchTab('story');
  $('.tabs').addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const st = $('#storyPane').hidden; switchTab(st ? 'story' : 'play'); (st ? $('#tabStory') : $('#tabPlay')).focus(); }
  });
  $('#vSm').onclick = () => setVoice('sm'); $('#vSt').onclick = () => setVoice('st');
  if (store.get(v.id + '-voice') === 'st') voice = 'st';

  // ---------- long s ----------
  function applyLongS(root: Node) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement!.closest('.prose,.chap') && !n.parentElement!.closest('.dev') ? 1 : 3) });
    let n: Node | null;
    while ((n = w.nextNode())) n.nodeValue = longS ? n.nodeValue!.replace(/s(?=[ac-eg-jl-zA-Z])/g, 'ſ') : n.nodeValue!.replace(/ſ/g, 's');
  }

  // ---------- glossary popover ----------
  const HEAD = { cant: 'The Editor’s canting dictionary', town: 'The Editor’s dictionary of the Town' };
  const gl = $('#gloss');
  document.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.cant');
    if (t) { showGloss(t); e.stopPropagation(); } else if (!(e.target as HTMLElement).closest('#gloss')) gl.hidden = true;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') gl.hidden = true;
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.classList && t.classList.contains('cant')) { e.preventDefault(); showGloss(t); }
  });
  function showGloss(t: HTMLElement) {
    const k = t.dataset.t!; const g = content.glossary[k];
    gl.innerHTML = `<div class="gh">${g ? HEAD[g.dictionary] : ''}</div><div class="gt">${k}</div><div>${g?.definition ?? ''}</div>`;
    gl.hidden = false; const r = t.getBoundingClientRect(); const W = Math.min(272, innerWidth - 32); gl.style.maxWidth = W + 'px';
    let x = r.left + scrollX; x = Math.max(16 + scrollX, Math.min(x, scrollX + innerWidth - W - 16)); gl.style.left = x + 'px'; gl.style.top = (r.bottom + scrollY + 6) + 'px';
  }

  // ---------- toggles ----------
  const devBtn = $('#devBtn'), lsBtn = $('#longsBtn');
  function setDev(on: boolean) { document.body.classList.toggle('devon', on); devBtn.setAttribute('aria-pressed', String(on)); store.set(v.id + '-dev', on ? '1' : '0'); }
  function setLS(on: boolean) { longS = on; lsBtn.setAttribute('aria-pressed', String(on)); applyLongS(document.querySelector('main')!); store.set(v.id + '-ls', on ? '1' : '0'); }
  devBtn.onclick = () => setDev(!document.body.classList.contains('devon'));
  lsBtn.onclick = () => setLS(!longS);

  // the Ledger is open on wide screens
  const mq = matchMedia('(min-width: 861px)'); const lb = $<HTMLDetailsElement>('#ledgerBox');
  mq.addEventListener('change', () => { if (mq.matches) lb.open = true; });
  if (!mq.matches) lb.open = false;

  function start() {
    run.start(); prevLedger = {}; beatCount = 0;
    story.innerHTML = `<div class="prose opening" id="opening"></div>`;
    const ci = $('#chapIn'); ci.textContent = v.chapter.opening + '.'; ci.classList.remove('fresh');
    renderLedger(); $('#storyNew').hidden = true; switchTab('play'); renderStory();
    const sec = renderBeat(v.first);
    // move the opening prose to carry the drop cap, unruled
    sec.style.borderTop = '0'; sec.style.marginTop = '0'; sec.style.paddingTop = '0';
    sec.querySelector('.prose')!.classList.add('opening');
    $('#opening').remove();
    applyLongS(document.querySelector('.chap')!);
    if (document.querySelector('.beat') !== sec) return;
    if (story.getBoundingClientRect().top < 0) window.scrollTo({ top: 0 });
  }
  setDev(store.get(v.id + '-dev') === '1');
  setVoice(voice);
  start();
  if (store.get(v.id + '-ls') === '1') setLS(true);
}

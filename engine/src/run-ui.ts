// The run page (dist/index.html): the start, the town between Ventures, the Ventures
// themselves, the bills, and the end. The headless rules live in campaign.ts.

import { money, parseMoney } from './core';
import { Campaign, SAVE_VERSION, dateLabel, type CampaignState, type Letter } from './campaign';
import { seedFrom } from './rng';
import { drawNames, type Names } from './names';
import type { Rank, Room, World } from './types';
import { SLOTS, WEEKLY, condition, rankBelow, type Slot } from './economy';
import { RANKS } from './types';
import { $, Chrome, Ledger, VentureView, esc, ledgerFromRun, store, type LedgerData } from './view';

const KEY = 'picaresque-run';
const OLD_KEY = 'fortunes-ladder-run'; // runs saved before the game was renamed
const ROOMS: Room[] = ['garret', 'room', 'first floor'];

export function roman(n: number): string {
  const t: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s;
}
/** Books follow Claimed Rank (systems spec, Proposed). */
const book = (r: Rank) => (RANKS.indexOf(r) >= RANKS.indexOf('Baronet or Knight') ? 'III' : RANKS.indexOf(r) >= RANKS.indexOf('Gentleman') ? 'II' : 'I');

export function mountRun(world: World) {
  const chrome = new Chrome('fl-run', world.glossary);
  const ledger = new Ledger();
  const root = $('#story');
  let c: Campaign | null = null;
  let view: VentureView | null = null;

  // ---------- saving ----------
  const save = () => { if (c) store.set(KEY, JSON.stringify(c.st)); };
  function loadSaved(): Campaign | null {
    const raw = store.get(KEY) ?? store.get(OLD_KEY); if (!raw) return null;
    try {
      const st = JSON.parse(raw) as CampaignState;
      if (st.v > SAVE_VERSION) return null; // older saves are brought up to date
      return new Campaign(world, st);
    } catch { return null; }
  }

  // ---------- shared pieces ----------
  const H = () => c!.hero;
  const showExposure = (persona: string) => persona !== H().styled;
  const who = (persona = H().persona): LedgerData['who'] => ({
    name: H().name,
    as: showExposure(persona) ? `passing as <i>${persona}</i>` : `under ${H().sex === 'woman' ? 'her' : 'his'} own name`,
    origin: `${c!.origin.name} · Book ${book(H().claimedRank)}`,
  });
  const upkeepLine = () => `${money(c!.weeklyUpkeep())} a week`;
  const TIER = ['none', 'plain', 'good', 'fine'];
  const lodgingLine = () => {
    const h = H();
    if (h.confined) return h.confined.stage === 'sponging-house' ? 'a sponging-house' : `${h.confined.where}, the ${h.confined.side === 'room' ? 'master’s' : 'common'} side`;
    return `a ${h.lodging.room}, ${h.lodging.district}`;
  };
  const circumstances = (): [string, string][] => [
    ['Date', dateLabel(c!.st.at).replace(/^the /, '')],
    ['Turn', String(c!.st.turn)],
    ['Lodging', lodgingLine()],
    ['Living as', H().confined ? 'a prisoner' : c!.inSavoy() ? 'a Savoyard' : `a ${c!.livingRank()}${H().living === 'pinching' ? ' (pinching)' : ''}`],
    ['Upkeep', upkeepLine()],
  ];
  // the hero's possessions, without the clothes, which the Appearances list shows
  const possessions = () => { const worn = new Set(SLOTS.map(sl => H().dress[sl]?.name).filter(Boolean)); return H().items.filter(i => !worn.has(i)); };
  const economy = (): Pick<LedgerData, 'appearance' | 'debtRows' | 'writs'> => {
    const h = H(), e = world.settings.economy;
    const rows: [string, string][] = SLOTS.map(sl => {
      const d = h.dress[sl];
      const cond = d && !WEEKLY.includes(sl) ? condition(d, e) : 'Fine';
      return [sl, d ? `${TIER[d.tier]}${cond === 'Fine' ? '' : `, ${cond.toLowerCase()}`}` : 'none'];
    });
    const debtRows: [string, string][] = [['Tradesmen', money(h.debts)]];
    if (h.notes.length) debtRows.push(['Notes of hand', money(h.notes.reduce((a, n) => a + n.amount, 0))]);
    if (h.loans.length) debtRows.push(['Moneylender', money(h.loans.reduce((a, l) => a + l.owed, 0))]);
    if (h.pledges.length) debtRows.push(['In pawn', `${h.pledges.length} ticket${h.pledges.length === 1 ? '' : 's'}`]);
    return {
      appearance: { rows, score: c!.appearances(), expected: c!.expected(), credit: c!.credit() },
      debtRows, writs: h.writs.map(w => `A writ: ${w.creditor}, ${money(c!.writAmount(w))}`),
    };
  };
  function heroLedger(): LedgerData {
    const h = H();
    return {
      who: who(), purse: h.purse, debts: h.debts, composure: null, attrs: h.attrs, hum: h.hum,
      exposure: showExposure(h.persona) ? (h.personas[h.persona] ?? 0) : null,
      notoriety: h.notoriety, celebrity: h.celebrity, luck: h.luck,
      conditions: h.conditions, tags: h.tags, items: possessions(), hooks: h.hooks, circumstances: circumstances(), ...economy(),
    };
  }
  const chapterNo = () => `Chap. ${roman(c!.st.story.length + 1)}.`;
  function chapters() {
    if (!c) return [];
    const out = c.st.story.map(ch => ({ no: `Chap. ${roman(ch.no)}.`, heading: ch.heading, passages: ch.passages }));
    if (view && view.run.S.story.length) out.push({ no: chapterNo(), heading: $('#chapIn').textContent ?? '', passages: view.run.S.story });
    return out;
  }
  chrome.onStory = () => chrome.renderStory(chapters());

  function chapter(show: boolean, no = '', text = '') {
    $('#chapBox').hidden = !show; $('#chapNo').textContent = no;
    const ci = $('#chapIn'); ci.textContent = text; ci.classList.remove('fresh');
  }
  function top() { const t = $('.tabs').getBoundingClientRect().top; if (t < 0) $('.tabs').scrollIntoView({ block: 'start' }); }
  function letterHTML(r: Letter, delivered: boolean) {
    const seal = r.from.replace(/^(The |Mr |Mrs |Lady |A |Sir |Every )/, '')[0];
    const chips = (r.done ?? []).map(t => `<span class="chip ${/\+/.test(t) && !/Celebrity|Luck|Purse/.test(t) ? 'bad' : 'neu'}">${t}</span>`).join('');
    return `<div class="letter"><span class="seal" aria-hidden="true">${seal}</span><div class="wk">${delivered ? 'Delivered' : 'To be delivered'} · ${dateLabel(r.at)}</div><div class="fr">${r.from}</div><div class="prose">${r.text}</div>${chips ? `<div class="done-chips">${chips}</div>` : ''}<div class="dev" style="margin-top:6px">${r.effect} · from ${r.venture}</div></div>`;
  }
  /** "The History of Mr Dermot Kirwan, otherwise Major Plunkett", once the Persona is taken up. */
  const history = () => {
    const h = H(), n = h.names;
    return h.persona !== h.styled ? `${h.history}, otherwise ${n.title} ${n.alias_surname}` : h.history;
  };
  function header() {
    $('#runheadText').innerHTML = c ? history() : 'Picaresque';
    $('#storyTitle').textContent = c ? history() : 'The History of an Adventurer';
  }

  // ---------- screens ----------
  function render() {
    view = null; header(); chrome.switchTab('play'); ledger.reset();
    if (!c) return renderStart();
    if (c.st.phase === 'venture') return renderVenture();
    if (c.st.phase === 'bills') return renderBills();
    if (c.st.phase === 'ended') return renderEnd();
    return renderTown();
  }

  function renderStart() {
    chapter(false);
    const saved = loadSaved();
    const s = world.settings;
    const origin = world.origins.find(o => o.available)!;
    const pool = origin.hero!.names;
    const titles = pool.alias.title.filter((t, i, a) => a.findIndex(x => x.long === t.long) === i);
    const testStart = s.start ? dateLabel((s.start.year - 1719) * 52 + s.start.week - 1) : null;
    $('#ledger').innerHTML = '<p class="lead" style="margin:0">The Ledger opens when the hero arrives.</p>'; $('#ledSum').textContent = '';
    root.innerHTML = `
      ${saved ? `<section class="screen"><h2><span class="phase">A run in progress</span>${esc(saved.hero.name)}${saved.hero.persona !== saved.hero.styled ? `, otherwise ${esc(saved.hero.persona)}` : ''}, turn ${saved.st.turn}</h2>
        <p class="lead">It is ${dateLabel(saved.st.at)}. ${saved.st.story.length} chapter${saved.st.story.length === 1 ? '' : 's'} written.</p>
        <div class="actions"><button class="btn primary" type="button" id="cont">Continue the run</button></div></section>` : ''}
      <section class="screen">
        <h2><span class="phase">${saved ? 'Or begin again' : 'Begin a run'}</span>Who comes to London?</h2>
        <p class="lead">Eight Origins ship with the game. One is written so far; the rest follow in Step 19.</p>
        <div class="cards">${world.origins.map(o => `
          <div class="card ${o.available ? 'pick' : 'off'}" ${o.available ? '' : 'aria-disabled="true"'}>
            <div class="cd">${o.sex === 'either' ? 'A man or a woman' : o.sex === 'man' ? 'A man' : 'A woman'}</div>
            <div class="ct">${esc(o.name)}</div>
            <div class="cb"><i>Arrives:</i> ${esc(o.arrives)}. <i>Strengths:</i> ${esc(o.strengths)}.</div>
            <div class="cm">${o.available ? 'Playable' : 'Not yet written'}</div>
          </div>`).join('')}</div>
        <h2 style="margin-top:26px"><span class="phase">The hero</span><span id="whoLine"></span></h2>
        <p class="lead">Drawn afresh for each run, so that one History may be told from another. Change any of it, or draw again.</p>
        <div class="actions" style="align-items:flex-end">
          <label class="field">Christian name <input id="nGiven" type="text" autocomplete="off"></label>
          <label class="field">Surname <input id="nSur" type="text" autocomplete="off"></label>
          <label class="field">County <select id="nCounty">${pool.county.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
        </div>
        <div class="actions" style="align-items:flex-end">
          <label class="field">Will pass as <select id="nTitle">${titles.map((t, i) => `<option value="${i}">${esc(t.long)}</option>`).join('')}</select></label>
          <label class="field">Surname <input id="nAlias" type="text" autocomplete="off"></label>
          <label class="field">Claiming to be <select id="nClaim">${pool.alias.claim.map(x => `<option>${esc(x)}</option>`).join('')}</select></label>
          <button class="btn" type="button" id="draw">Draw again</button>
        </div>
        <div class="actions" style="align-items:flex-end">
          <label class="field">Seed <input id="seed" type="text" inputmode="text" placeholder="leave blank for chance" autocomplete="off"></label>
          <div class="field">The date<div class="radio">
            ${testStart ? `<label><input type="radio" name="when" value="test" checked> ${testStart}, as the test runs do</label>` : ''}
            <label><input type="radio" name="when" value="random" ${testStart ? '' : 'checked'}> a random week, ${s.start_range.from}–${s.start_range.to}</label>
          </div></div>
        </div>
        <div class="actions"><button class="btn primary" type="button" id="go">Set out for London</button></div>
        ${saved ? '<div id="confirmBox"></div>' : ''}
      </section>`;
    $('#cont')?.addEventListener('click', () => { c = saved; render(); });
    const val = (id: string) => ($<HTMLInputElement>(id).value || '').trim();
    const show = () => {
      const t = titles[+val('#nTitle')];
      $('#whoLine').textContent = `${val('#nGiven') || '…'} ${val('#nSur') || '…'}, of the county of ${val('#nCounty')}, who will be ${t.long} ${val('#nAlias') || '…'}, ${val('#nClaim')}`;
    };
    const fill = (n: Names) => {
      $<HTMLInputElement>('#nGiven').value = n.given; $<HTMLInputElement>('#nSur').value = n.surname;
      $<HTMLSelectElement>('#nCounty').value = n.county; $<HTMLInputElement>('#nAlias').value = n.alias_surname;
      $<HTMLSelectElement>('#nTitle').value = String(titles.findIndex(t => t.long === n.title)); $<HTMLSelectElement>('#nClaim').value = n.claim;
      show();
    };
    const drawn = drawNames(pool, Math.random, origin.sex === 'woman' ? 'woman' : 'man');
    fill(drawn);
    $('#draw').onclick = () => fill(drawNames(pool, Math.random, origin.sex === 'woman' ? 'woman' : 'man'));
    ['#nGiven', '#nSur', '#nCounty', '#nTitle', '#nAlias', '#nClaim'].forEach(id => $(id).addEventListener('input', show));
    const chosen = (): Names => {
      const t = titles[+val('#nTitle')];
      return {
        given: val('#nGiven') || drawn.given, surname: val('#nSur') || drawn.surname, county: val('#nCounty'),
        title: t.long, short_title: t.short, alias_surname: val('#nAlias') || drawn.alias_surname, claim: val('#nClaim'),
        sex: origin.sex === 'woman' ? 'woman' : 'man',
      };
    };
    const begin = () => {
      const typed = ($<HTMLInputElement>('#seed').value || '').trim();
      const seed = typed ? seedFrom(typed) : (Math.random() * 2 ** 32) >>> 0;
      const w = (document.querySelector<HTMLInputElement>('input[name=when]:checked')?.value) ?? 'random';
      c = Campaign.begin(world, origin.id, seed, w === 'test' ? world.settings.start : null, chosen());
      save(); render(); top();
    };
    $('#go').onclick = () => {
      if (!saved) return begin();
      $('#confirmBox').innerHTML = `<div class="confirm"><p>Beginning again abandons ${esc(saved.hero.name)}’s run for good.</p><button class="btn primary" type="button" id="yes">Abandon it</button><button class="btn" type="button" id="no">Keep it</button></div>`;
      $('#yes').onclick = begin;
      $('#no').onclick = () => { $('#confirmBox').innerHTML = ''; };
    };
  }

  let notice = '';
  const act = (f: () => string | null | void) => { const r = f(); notice = r || ''; save(); render(); };

  /** The hero's affairs: Appearances and the shops, the pawnbroker, the debts, the moneylender. */
  function affairsHTML(): string {
    const h = H(), e = world.settings.economy, inside = !!h.confined;
    const shop = SLOTS.map(sl => {
      const d = h.dress[sl], weekly = WEEKLY.includes(sl);
      const opts = e.catalogue[sl].map((it, i) => `<option value="${i + 1}">${esc(it.name)}, ${money(typeof it.price === 'number' ? it.price : priceOf(it.price))}${weekly ? ' a week' : ''}</option>`).join('');
      const cond = d && !weekly ? ({ Fine: 'new', Worn: 'worn', Shabby: 'shabby' } as const)[condition(d, e)] : '';
      const acts = weekly
        ? `<button class="btn" type="button" data-buy="${sl}">Hire</button>${d ? `<button class="btn" type="button" data-dismiss="${sl}">Dismiss</button>` : ''}`
        : `<button class="btn" type="button" data-buy="${sl}">Buy</button><button class="btn" type="button" data-acct="${sl}">On account</button>`;
      const shopCells = inside ? '' : `<td><select data-tier="${sl}" aria-label="${sl} to buy">${opts}</select></td><td><div class="rowacts">${acts}</div></td>`;
      return `<tr><td>${sl}</td><td class="small">${d ? `${esc(d.name)}${cond ? ` · ${cond}` : ''}` : 'none'}</td>${shopCells}</tr>`;
    }).join('');
    const pawn = c!.pawnable().map(p => `<tr><td>${esc(p.item)}</td><td class="n">${money(p.loan)}</td><td><div class="rowacts"><button class="btn" type="button" data-pawn="${esc(p.item)}">Pledge</button></div></td></tr>`).join('');
    const tickets = h.pledges.map((p, i) => `<tr><td>${esc(p.item)}</td><td class="small">until ${dateLabel(p.at + e.pawn.weeks).replace(/^the /, '')}</td><td><div class="rowacts"><button class="btn" type="button" data-redeem="${i}">Redeem, ${money(c!.redeemCost(p))}</button></div></td></tr>`).join('');
    const notes = h.notes.map((n, i) => `<tr><td>A note of hand to ${esc(n.to)}</td><td class="n">${money(n.amount)}</td><td><div class="rowacts"><button class="btn" type="button" data-note="${i}">Pay it</button></div></td></tr>`).join('');
    const loans = h.loans.map((l, i) => `<tr><td>${esc(l.from)}, due ${dateLabel(l.due).replace(/^the /, '')}</td><td class="n">${money(l.owed)}</td><td><div class="rowacts"><button class="btn" type="button" data-repay="${i}">Repay</button></div></td></tr>`).join('');
    const can = c!.canBorrow();
    const offers = e.lender.offers.map(a => typeof a === 'number' ? a : priceOf(a)).filter(a => a <= can);
    return `
      <section class="screen affairs">
        <h2><span class="phase">Your affairs</span>Appearances, the pawnbroker and the debts</h2>
        <p class="lead">Appearances ${c!.appearances()} against the ${c!.expected()} a ${h.claimedRank} is expected to show${c!.appearances() < c!.expected() ? ', so every Exposure gain is one worse' : ''}. Credit ${money(c!.credit())}${c!.inSavoy() || inside ? ' (nothing, while you are where you are)' : ''}.</p>
        ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
        <div class="tablewrap"><table class="account"><thead><tr><th>Slot</th><th>Now</th>${inside ? '' : '<th>The shops</th><th></th>'}</tr></thead><tbody>${shop}</tbody></table></div>
        <h3 class="sec">The pawnbroker</h3>
        <p class="small">He lends a third of an item’s worth, holds it twelve weeks, and wants a fifth more to give it back.</p>
        ${pawn || tickets ? `<div class="tablewrap"><table class="account"><tbody>${pawn}${tickets}</tbody></table></div>` : '<p class="small">You have nothing he will take.</p>'}
        <h3 class="sec">The debts</h3>
        <div class="tablewrap"><table class="account"><tbody>
          <tr><td>The tradesmen’s books</td><td class="n">${money(h.debts)}</td><td><div class="rowacts">${h.debts && h.purse ? `<button class="btn" type="button" data-trade="${Math.min(h.debts, h.purse)}">Pay ${money(Math.min(h.debts, h.purse))}</button>` : ''}</div></td></tr>
          ${notes}${loans}
        </tbody></table></div>
        ${inside ? '' : `<p class="small" style="margin-top:8px">${esc(e.lender.name)} lends against your Appearances, up to your Credit. He keeps a tenth back, charges one in the hundred a week, and wants it again in ${e.lender.term} weeks. ${offers.length ? '' : 'He will lend you nothing more at present.'}</p>
        ${offers.length ? `<div class="actions" style="margin-top:4px">${offers.map(a => `<button class="btn" type="button" data-borrow="${a}">Borrow ${money(a)}</button>`).join('')}</div>` : ''}`}
      </section>`;
  }
  const priceOf = (a: string | number) => (typeof a === 'number' ? a : parseMoney(a));

  function wireAffairs() {
    root.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach(b => (b.onclick = () => { const sl = b.dataset.buy as Slot; act(() => c!.buy(sl, +$<HTMLSelectElement>(`[data-tier="${sl}"]`).value)); }));
    root.querySelectorAll<HTMLButtonElement>('[data-acct]').forEach(b => (b.onclick = () => { const sl = b.dataset.acct as Slot; act(() => c!.buy(sl, +$<HTMLSelectElement>(`[data-tier="${sl}"]`).value, true)); }));
    root.querySelectorAll<HTMLButtonElement>('[data-dismiss]').forEach(b => (b.onclick = () => act(() => c!.dismiss(b.dataset.dismiss as Slot))));
    root.querySelectorAll<HTMLButtonElement>('[data-pawn]').forEach(b => (b.onclick = () => act(() => c!.pawn(b.dataset.pawn!))));
    root.querySelectorAll<HTMLButtonElement>('[data-redeem]').forEach(b => (b.onclick = () => act(() => c!.redeem(+b.dataset.redeem!))));
    root.querySelectorAll<HTMLButtonElement>('[data-note]').forEach(b => (b.onclick = () => act(() => c!.payNote(+b.dataset.note!))));
    root.querySelectorAll<HTMLButtonElement>('[data-repay]').forEach(b => (b.onclick = () => act(() => c!.repay(+b.dataset.repay!, H().purse))));
    root.querySelectorAll<HTMLButtonElement>('[data-trade]').forEach(b => (b.onclick = () => act(() => c!.payTradesmen(+b.dataset.trade!))));
    root.querySelectorAll<HTMLButtonElement>('[data-borrow]').forEach(b => (b.onclick = () => act(() => c!.borrow(+b.dataset.borrow!))));
  }

  function renderPrison() {
    const st = c!.st, h = H(), conf = h.confined!, e = world.settings.economy;
    chapter(false);
    ledger.render(heroLedger());
    const due = c!.enforceable();
    root.innerHTML = `
      <section class="screen">
        <h2><span class="phase">Turn ${st.turn} · ${dateLabel(st.at)}</span>${esc(conf.where.replace(/^the /, 'The '))}</h2>
        <p class="lead">You owe ${money(due)} that the law can recover, and have ${money(h.purse)}. ${h.purse >= due ? 'You could pay it all and walk out today.' : 'The door opens when the creditors are paid, or compose.'}</p>
        ${st.news.length ? `<div class="letters">${st.news.map(r => letterHTML(r, true)).join('')}</div>` : ''}
        ${h.purse >= due ? `<div class="actions"><button class="btn primary" type="button" id="payout">Pay ${money(due)} and walk out</button></div>` : ''}
      </section>
      <section class="screen">
        <h2><span class="phase">This month</span>Within the walls</h2>
        <div class="cards">${st.offers.map(id => c!.byId[id]).map(v => `
          <div class="card"><div class="cd">${esc(conf.where)}</div><div class="ct">${v.title}</div>
            <div class="cb">Begging letters, a fellow prisoner, and terms with your creditors, at so many shillings in the pound.</div>
            <button class="btn primary" type="button" data-v="${v.id}">Undertake it</button></div>`).join('')}
          <div class="card off"><div class="cd">${esc(conf.where)}</div><div class="ct">Idle the month</div><div class="cb">Nothing is done, and nothing is spent but time.</div><button class="btn" type="button" id="idle">Idle</button></div>
        </div>
      </section>
      <section class="screen">
        <h2><span class="phase">Your side</span>The ${conf.side === 'room' ? 'master’s' : 'common'} side</h2>
        <p class="lead">The common side is free, and Melancholic rises a point a month there. A room on the master’s side costs ${money(priceOf(e.prison.room))} a week.</p>
        <div class="actions"><button class="btn" type="button" id="side">${conf.side === 'room' ? 'Go down to the common side' : 'Take a room on the master’s side'}</button></div>
      </section>
      ${affairsHTML()}`;
    chrome.applyLongS(root);
    root.querySelectorAll<HTMLButtonElement>('[data-v]').forEach(b => (b.onclick = () => { c!.startVenture(b.dataset.v!); save(); render(); top(); }));
    $('#idle').onclick = () => { c!.idle(); save(); render(); top(); };
    $('#side').onclick = () => act(() => c!.setSide(conf.side === 'room' ? 'common' : 'room'));
    $('#payout')?.addEventListener('click', () => act(() => c!.payOut()));
    wireAffairs();
  }

  function renderTown() {
    const st = c!.st, h = H();
    if (h.confined) return renderPrison();
    chapter(false);
    ledger.render(heroLedger());
    const offers = st.offers.map(id => c!.byId[id]);
    const below = rankBelow(h.claimedRank), living = world.settings.living;
    root.innerHTML = `
      <section class="screen">
        <h2><span class="phase">Turn ${st.turn} · ${dateLabel(st.at)}</span>${c!.inSavoy() ? 'The Liberty of the Savoy' : 'The Town'}</h2>
        ${st.news.length ? `<p class="lead">The post has brought ${st.news.length === 1 ? 'a letter' : st.news.length + ' letters'} since the last Venture.</p><div class="letters">${st.news.map(r => letterHTML(r, true)).join('')}</div>`
          : `<p class="lead">${st.turn === 1 ? 'London lies before you.' : 'The post has brought nothing. The Town, for the moment, is talking about someone else.'}</p>`}
        ${st.post.length ? `<div class="dev" style="margin-top:10px">in the post: ${st.post.map(r => `${r.from} (${dateLabel(r.at)})`).join('; ')}</div>` : ''}
      </section>
      <section class="screen">
        <h2><span class="phase">This month</span>Three ways to make a fortune, or lose one</h2>
        <p class="lead">Choose one Venture for the month. Each is played in five beats; the risky choices go to Fortune’s Wheel.</p>
        <div class="cards">${offers.map(v => `
          <div class="card">
            <div class="cd">${esc(v.offer!.district)}</div>
            <div class="ct">${v.title}</div>
            <div class="cb">${v.offer!.blurb}</div>
            ${v.test ? '<span class="test" title="Placeholder Venture written for Step 5">placeholder</span>' : ''}
            <button class="btn primary" type="button" data-v="${v.id}">Undertake it</button>
          </div>`).join('')}
          <div class="card off">
            <div class="cd">Anywhere</div>
            <div class="ct">Idle the month</div>
            <div class="cb">No Venture and no spin. The bills come all the same, and Phlegmatic rises.</div>
            <button class="btn" type="button" id="idle">Idle</button>
          </div>
        </div>
      </section>
      ${affairsHTML()}
      <section class="screen">
        <h2><span class="phase">Your lodging</span>A ${h.lodging.room} in ${h.lodging.district}</h2>
        <p class="lead">${c!.inSavoy()
          ? `Inside the Liberty no bailiff can touch you, but your Credit is nothing, your clothes wear twice as fast, and each month costs a point of Celebrity and raises Melancholic. ${c!.canLeaveSavoy() ? 'You may leave when you choose.' : `You cannot leave while you owe ${money(c!.enforceable())} and your Credit outside would be only ${money(c!.credit(true))}.`}`
          : `Upkeep ${upkeepLine()}, lodging included. Moving delays every letter in the post by a week; the Savoy is a refuge from writs.`}</p>
        <div class="actions" style="align-items:flex-end">
          <label class="field">District <select id="dist">${Object.keys(world.settings.lodging).map(d => `<option ${d === h.lodging.district ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="field">Room <select id="room">${ROOMS.map(r => `<option ${r === h.lodging.room ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
          <button class="btn" type="button" id="move">Move lodgings</button>
        </div>
        ${c!.inSavoy() || rankBelow(h.claimedRank) === h.claimedRank ? '' : `<div class="field" style="margin-top:14px">Living<div class="radio">
          <label><input type="radio" name="living" value="claimed" ${h.living === 'claimed' ? 'checked' : ''}> as a ${h.claimedRank}, at ${money(priceOf(living[h.claimedRank]))} a week</label>
          <label><input type="radio" name="living" value="pinching" ${h.living === 'pinching' ? 'checked' : ''}> pinching, as a ${below}, at ${money(priceOf(living[below]))} a week: your clothes wear twice as fast, and every Exposure gain is one worse</label>
        </div></div>`}
      </section>
      <section class="screen">
        <h2><span class="phase">Or</span>Retire from the world</h2>
        <p class="lead">End the run here, and have the Story bound as it stands.</p>
        <div class="actions"><button class="btn" type="button" id="retire">Retire</button></div>
        <div id="confirmBox"></div>
        <div class="dev" style="margin-top:14px">seed ${st.seed} · rng ${st.rng}\n${st.log.join('\n')}</div>
      </section>`;
    chrome.applyLongS(root);
    root.querySelectorAll<HTMLButtonElement>('[data-v]').forEach(b => (b.onclick = () => { c!.startVenture(b.dataset.v!); save(); render(); top(); }));
    $('#idle').onclick = () => { c!.idle(); save(); render(); top(); };
    $('#move').onclick = () => act(() => (c!.move($<HTMLSelectElement>('#dist').value, $<HTMLSelectElement>('#room').value as Room) ? null : 'The bailiffs are waiting at the gate. You cannot leave the Liberty until what you owe falls below your Credit outside.'));
    root.querySelectorAll<HTMLInputElement>('input[name=living]').forEach(r => (r.onchange = () => act(() => c!.setLiving(r.value as 'claimed' | 'pinching'))));
    wireAffairs();
    $('#retire').onclick = () => {
      $('#confirmBox').innerHTML = `<div class="confirm"><p>Retire now? The run ends, and cannot be taken up again.</p><button class="btn primary" type="button" id="yes">Retire</button><button class="btn" type="button" id="no">Not yet</button></div>`;
      $('#yes').onclick = () => { c!.retire(); save(); render(); top(); };
      $('#no').onclick = () => { $('#confirmBox').innerHTML = ''; };
    };
  }

  function renderVenture() {
    const cur = c!.st.current!; const v = c!.byId[cur.id];
    chapter(true, chapterNo(), v.chapter.opening + '.');
    root.innerHTML = `<div class="vhead"><div class="eyebrow">A Venture${v.offer ? ' · ' + esc(v.offer.district) : ''}</div><div class="vt">${v.title}</div><div class="vs">${v.sub}</div>${v.test ? '<div class="dev" style="margin-top:8px">placeholder Venture, written for Step 5</div>' : ''}</div>`;
    const { run, path, next } = c!.replay();
    const ledgerNow = () => {
      const L = ledgerFromRun(run, who(run.S.persona), showExposure(run.S.persona), circumstances());
      const worn = new Set(SLOTS.map(sl => H().dress[sl]?.name).filter(Boolean));
      ledger.render({ ...L, items: run.S.items.filter(i => !worn.has(i)), ...economy(), debtRows: [['Tradesmen', money(run.S.debts)], ...(economy().debtRows ?? []).slice(1)] });
    };
    const vw = new VentureView(run, {
      chrome,
      random: () => { const x = c!.random(); save(); return x; },
      changed: ledgerNow,
      storied: chrome.onStory,
      chose: (ch) => { c!.record(ch); save(); },
      close: { label: 'Settle the month’s bills', act: () => { c!.finishVenture(run, vw.chapter); save(); render(); top(); } },
      weekLabel: (w) => dateLabel(w),
      exposureLabel: (p) => `Exposure (${p})`,
    }, root);
    view = vw;
    for (const p of path) vw.replayed(p.beat, p.choice, p.html, p.fx);
    if (next === 'reckon') vw.renderReckon(); else vw.renderBeat(next);
    ledgerNow(); chrome.onStory();
    chrome.applyLongS(document.querySelector('.chap')!);
  }

  function renderBills() {
    const st = c!.st, b = st.bills!;
    chapter(false);
    ledger.render(heroLedger());
    const letters = b.weeks.flatMap(w => w.letters);
    root.innerHTML = `
      <section class="screen">
        <h2><span class="phase">Turn ${st.turn} · the bills</span>The Month’s Reckoning</h2>
        <p class="lead">${b.owed ? `The purse would not stretch to the month. ${money(b.owed)} goes on the tradesmen’s books.` : 'The month is paid for, which is more than most of the Town can say.'}</p>
        <div class="tablewrap"><table class="account bills"><thead><tr><th>Week</th><th class="n">Upkeep</th><th class="n">Paid</th><th class="n">On credit</th></tr></thead><tbody>
          ${b.weeks.map(w => `<tr><td>${dateLabel(w.at).replace(/^the /, '').replace(/^./, x => x.toUpperCase())}</td><td class="n">${money(w.upkeep)}</td><td class="n">${money(w.paid)}</td><td class="n">${w.owed ? money(w.owed) : '—'}</td></tr>`).join('')}
          <tr><td><b>The month</b></td><td class="n"><b>${money(b.total)}</b></td><td class="n">${money(b.total - b.owed)}</td><td class="n">${b.owed ? money(b.owed) : '—'}</td></tr>
        </tbody></table></div>
        ${b.cooled.length ? `<p class="lead" style="margin-top:12px">With nothing to feed them, ${b.cooled.join(' and ')} cool by a point.</p>` : ''}
        ${b.events?.length ? `<ul class="lst" style="margin-top:12px">${b.events.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
      </section>
      ${letters.length ? `<section class="screen"><h2><span class="phase">The post</span>${letters.length === 1 ? 'A letter arrives' : letters.length + ' letters arrive'}</h2><div class="letters">${letters.map(r => letterHTML(r, true)).join('')}</div></section>` : ''}
      <section class="screen"><div class="actions"><button class="btn primary" type="button" id="turn">Turn the page</button></div></section>`;
    chrome.applyLongS(root);
    $('#turn').onclick = () => { c!.nextTurn(); save(); render(); top(); };
  }

  function renderEnd() {
    const st = c!.st;
    chapter(false);
    ledger.render(heroLedger());
    root.innerHTML = `
      <section class="screen">
        <h2><span class="phase">${st.ended?.how ?? 'The end'}</span>Finis</h2>
        <p class="lead">${esc(H().name)} retires from the world in ${dateLabel(st.at)}, after ${st.turn} turn${st.turn === 1 ? '' : 's'} and ${st.story.length} chapter${st.story.length === 1 ? '' : 's'}. The Memoir, its title page and its Subscribers come in Step 9.</p>
        <div class="actions"><button class="btn" type="button" id="read">Read the Story ❧</button><button class="btn primary" type="button" id="again">Begin a new run</button></div>
      </section>`;
    $('#read').onclick = () => chrome.switchTab('story');
    $('#again').onclick = () => { store.del(KEY); c = null; render(); top(); };
  }

  // the start screen offers to continue a saved run
  render();
  chrome.restoreLongS();
}

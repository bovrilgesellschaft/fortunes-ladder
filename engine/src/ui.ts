// A Venture's own page (dist/heath.html, dist/ball.html): one Venture, played again and again,
// in the layout and visual identity of the published ball.html.

import { Run } from './core';
import type { Content } from './types';
import { $, Chrome, Ledger, VentureView, ledgerFromRun } from './view';

export function mount(content: Content) {
  const v = content.venture;
  const chrome = new Chrome(v.id, content.glossary);
  const ledger = new Ledger();
  let run = new Run(content);
  let view: VentureView;

  const story = () => chrome.renderStory([{ no: v.chapter.no, heading: $('#chapIn').textContent ?? '', passages: run.S.story }]);
  chrome.onStory = story;

  function start() {
    run = new Run(content); ledger.reset();
    const root = $('#story'); root.innerHTML = '';
    const ci = $('#chapIn'); ci.textContent = v.chapter.opening + '.'; ci.classList.remove('fresh');
    view = new VentureView(run, {
      chrome,
      random: Math.random,
      changed: () => ledger.render(ledgerFromRun(run, v.who)),
      storied: story,
      chose: () => {},
      close: { label: v.reckoning.again, act: start },
      weekLabel: (w) => `Week ${w}`,
      exposureLabel: (p) => `Exposure (${p})`,
    }, root);
    ledger.render(ledgerFromRun(run, v.who));
    $('#storyNew').hidden = true; chrome.switchTab('play'); story();
    view.renderBeat(v.first);
    chrome.applyLongS(document.querySelector('.chap')!);
    if (root.getBoundingClientRect().top < 0) window.scrollTo({ top: 0 });
  }

  start();
  chrome.restoreLongS();
}

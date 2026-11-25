// Controller illustration with callout bubbles (like the PlayStation Accessories layout) and a live input overlay.
import { glyph, NAME } from './glyphs.js';
import { esc } from './ui.js';
import { KEYS, WIRE } from '../shared/dualsense.mjs';

export const LOCKED = new Set(['OPTIONS', 'TOUCH', 'CREATE', 'PS']);   // not remappable onboard
export const TARGETS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'TRIANGLE', 'CIRCLE', 'CROSS', 'SQUARE',
  'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'OPTIONS', 'TOUCH'];

const BL = 96, BR = 904;
// [key, bubbleX, bubbleY, anchorX, anchorY]
const LAYOUT = [
  ['L2', BL, 80, 372, 124], ['L1', BL, 126, 380, 150], ['CREATE', BL, 172, 402, 184],
  ['UP', BL, 218, 340, 226], ['LEFT', BL, 264, 316, 250], ['DOWN', BL, 310, 340, 274], ['RIGHT', BL, 356, 364, 250],
  ['L3', BL, 402, 418, 330],
  ['R2', BR, 80, 628, 124], ['R1', BR, 126, 620, 150], ['OPTIONS', BR, 172, 598, 184],
  ['TRIANGLE', BR, 218, 660, 222], ['CIRCLE', BR, 264, 688, 250], ['CROSS', BR, 310, 660, 278], ['SQUARE', BR, 356, 632, 250],
  ['R3', BR, 402, 582, 330],
  ['TOUCH', 500, 52, 500, 206], ['PS', 500, 470, 500, 312],
  ['PADL', BL, 584, 452, 584], ['PADR', BR, 584, 548, 584],
];

// Mirror an absolute M/L/C/Q path horizontally around x = 500.
const mirror = d => { let i = 0; return d.replace(/-?\d+(\.\d+)?/g, n => (i++ % 2 === 0 ? String(1000 - Number(n)) : n)); };

const BODY = 'M318 172 C346 150 404 148 432 160 L568 160 C596 148 654 150 682 172 C742 208 786 300 800 392 C812 456 790 490 752 482 C722 476 700 442 676 406 C664 390 648 382 628 382 L372 382 C352 382 336 390 324 406 C300 442 278 476 248 482 C210 490 188 456 200 392 C214 300 258 208 318 172 Z';
const L2 = 'M334 170 C334 136 356 112 388 112 C414 112 430 128 432 152 L432 162 C400 156 364 160 334 170 Z';
const L1 = 'M322 166 C350 146 404 142 430 152';
const LIGHT = 'M431 170 C428 206 430 238 437 258';
const BACK = 'M330 536 C364 516 636 516 670 536 C722 558 742 612 702 630 L298 630 C258 612 278 558 330 536 Z';
const BACK_TRIG = 'M346 540 C348 516 372 504 398 506 C420 508 430 520 430 536';
const DPAD = [
  'M331 220 Q331 216 335 216 L345 216 Q349 216 349 220 L349 234 L340 243 L331 234 Z',
  'M331 280 Q331 284 335 284 L345 284 Q349 284 349 280 L349 266 L340 257 L331 266 Z',
  'M310 241 Q306 241 306 245 L306 255 Q306 259 310 259 L324 259 L333 250 L324 241 Z',
  'M370 241 Q374 241 374 245 L374 255 Q374 259 370 259 L356 259 L347 250 L356 241 Z',
];
const FACE = [[660, 222, 'TRIANGLE'], [688, 250, 'CIRCLE'], [660, 278, 'CROSS'], [632, 250, 'SQUARE']];

function art() {
  return `
  <defs>
    <linearGradient id="bodyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101a3d"/><stop offset="1" stop-color="#0a1230"/></linearGradient>
    <radialGradient id="capFill"><stop offset="0" stop-color="#1a2654"/><stop offset="1" stop-color="#0e1636"/></radialGradient>
  </defs>
  <g class="art">
    <path class="trigger" id="shape-L2" d="${L2}"/><path class="trigger" id="shape-R2" d="${mirror(L2)}"/>
    <path class="body" d="${BODY}"/>
    <path class="bumper" d="${L1}"/><path class="bumper" d="${mirror(L1)}"/>
    <path class="part pad-surface" d="M438 166 L562 166 C565 200 565 232 559 252 Q500 266 441 252 C435 232 435 200 438 166 Z"/>
    <path class="lightbar" d="${LIGHT}"/><path class="lightbar" d="${mirror(LIGHT)}"/>
    <rect class="part" x="397" y="173" width="10" height="22" rx="5" transform="rotate(-16 402 184)"/>
    <rect class="part" x="593" y="173" width="10" height="22" rx="5" transform="rotate(16 598 184)"/>
    ${DPAD.map(d => `<path class="part key" d="${d}"/>`).join('')}
    ${FACE.map(([x, y, k]) => `<circle class="part key" cx="${x}" cy="${y}" r="12"/><g class="face-glyph" transform="translate(${x} ${y}) scale(.62) translate(${-x} ${-y})">${glyph(k, x, y)}</g>`).join('')}
    ${[418, 582].map(x => `<circle class="part" cx="${x}" cy="330" r="31"/><circle class="cap" cx="${x}" cy="330" r="21"/><circle class="part faint" cx="${x}" cy="330" r="13"/>`).join('')}
    <circle class="part key" cx="500" cy="312" r="9"/>
    <rect class="part" x="490" y="337" width="20" height="7" rx="3.5"/>
    <rect class="part faint" x="410" y="368" width="16" height="7" rx="3.5"/><rect class="part faint" x="574" y="368" width="16" height="7" rx="3.5"/>
    ${[488, 494, 500, 506, 512].map(x => `<circle class="dot-grille" cx="${x}" cy="360" r="1.4"/>`).join('')}
    <path class="body" d="${BACK}"/>
    <path class="part faint" d="${BACK_TRIG}"/><path class="part faint" d="${mirror(BACK_TRIG)}"/>
    <ellipse class="part key" cx="452" cy="584" rx="14" ry="24" transform="rotate(-14 452 584)"/>
    <ellipse class="part key" cx="548" cy="584" rx="14" ry="24" transform="rotate(14 548 584)"/>
    <text class="view-label" x="500" y="618" text-anchor="middle">BACK</text>
  </g>`;
}

function leader(bx, by, ax, ay) {
  if (bx === 500) return `M${bx} ${by + (ay > by ? 23 : -23)} L${ax} ${ay}`;
  const left = bx < 500, sx = bx + (left ? 23 : -23), knee = left ? Math.min(ax - 36, 262) : Math.max(ax + 36, 738);
  return `M${sx} ${by} L${knee} ${by} L${ax} ${ay}`;
}

export function createDiagram(svg, { onPick }) {
  svg.innerHTML = `${art()}
    <g class="leaders">${LAYOUT.map(([, bx, by, ax, ay]) => `<path class="leader" d="${leader(bx, by, ax, ay)}"/>`).join('')}</g>
    <g class="hots">${LAYOUT.map(([k, , , ax, ay]) => `<circle class="hot" data-hot="${k}" cx="${ax}" cy="${ay}" r="10"/>`).join('')}</g>
    <g class="live"><circle class="stickdot" id="dot-L" cx="418" cy="330" r="5.5"/><circle class="stickdot" id="dot-R" cx="582" cy="330" r="5.5"/></g>
    <g class="bubbles"></g>`;
  const bubbles = svg.querySelector('.bubbles');
  const hot = Object.fromEntries([...svg.querySelectorAll('[data-hot]')].map(el => [el.dataset.hot, el]));
  const dotL = svg.querySelector('#dot-L'), dotR = svg.querySelector('#dot-R');
  const trigL = svg.querySelector('#shape-L2'), trigR = svg.querySelector('#shape-R2');
  let bubbleEls = {}, pressed = new Set();

  const pick = el => { const g = el.closest?.('.bubble'); if (g) onPick(g.dataset.k); };
  svg.addEventListener('click', e => pick(e.target));
  svg.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('bubble')) { e.preventDefault(); pick(e.target); }
  });

  function render(map) {
    bubbles.innerHTML = LAYOUT.map(([k, bx, by]) => {
      const out = WIRE[k] !== undefined && WIRE[k] < 16 ? KEYS[map[WIRE[k]]] : k;
      const remapped = out !== k, locked = LOCKED.has(k);
      const label = `${NAME[k]}${remapped ? `, acts as ${NAME[out]}` : ''}${locked ? ' (fixed on the controller)' : ''}`;
      const cls = ['bubble', remapped && 'remapped', locked && 'locked', pressed.has(k) && 'pressed'].filter(Boolean).join(' ');
      return `<g class="${cls}" data-k="${k}" tabindex="0" role="button" aria-label="${esc(label)}"><title>${esc(label)}</title>`
        + `<circle cx="${bx}" cy="${by}" r="21"/>${glyph(out, bx, by)}</g>`;
    }).join('');
    bubbleEls = Object.fromEntries([...bubbles.children].map(g => [g.dataset.k, g]));
  }

  function setPressed(set) {
    for (const k of Object.keys(hot)) {
      const on = set.has(k);
      if (on !== pressed.has(k)) { hot[k].classList.toggle('on', on); bubbleEls[k]?.classList.toggle('pressed', on); }
    }
    pressed = new Set(set);
  }

  function setAnalog(p) {
    const off = v => ((v - 128) / 128) * 13;
    dotL.setAttribute('cx', (418 + off(p.lx)).toFixed(1)); dotL.setAttribute('cy', (330 + off(p.ly)).toFixed(1));
    dotR.setAttribute('cx', (582 + off(p.rx)).toFixed(1)); dotR.setAttribute('cy', (330 + off(p.ry)).toFixed(1));
    trigL.style.fillOpacity = (0.04 + 0.7 * p.l2 / 255).toFixed(3);
    trigR.style.fillOpacity = (0.04 + 0.7 * p.r2 / 255).toFixed(3);
  }

  function clearLive() {
    setPressed(new Set());
    setAnalog({ lx: 128, ly: 128, rx: 128, ry: 128, l2: 0, r2: 0 });
  }

  return { render, setPressed, setAnalog, clearLive };
}

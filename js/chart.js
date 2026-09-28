/* ═══════════════ ONE CHART ═══════════════
   A single series over time: what the selected indicator did. One series means
   one hue and no legend — the title names it. The grid stays recessive, the
   labels wear text colours, and the last point is the one that is marked.     */

import { money } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const node = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/* 1,250,000 -> 1.25M — axis labels have to be read at a glance, not counted. */
/* 1, 2, 2.5 or 5 times a power of ten — the only step sizes that read well. */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export function short(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

/* points: [{ label, value, sub }] — oldest first. */
export function timeChart(points, { format = (v) => money(v, { dp: 0 }), fromZero = true } = {}) {
  const wide = matchMedia('(min-width: 700px)').matches;
  const W = wide ? 760 : 372, H = wide ? 280 : 208;
  const pad = { l: wide ? 52 : 44, r: 10, t: 12, b: 24 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;

  const wrap = document.createElement('div');
  wrap.className = 'chart';
  if (points.length < 2) {
    wrap.append(Object.assign(document.createElement('p'), {
      className: 'chart-empty', textContent: 'Not enough days yet to draw a line.',
    }));
    return wrap;
  }

  /* A scale a person can read: the steps land on round numbers, not on
     whatever 12% above the maximum happened to be. */
  const values = points.map((p) => p.value);
  let lo = fromZero ? Math.min(0, ...values) : Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) hi = lo + (Math.abs(lo) || 1) * 0.1;
  if (!fromZero) { const room = (hi - lo) * 0.15; lo -= room; hi += room; }
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = Math.max(2, Math.min(6, Math.round((hi - lo) / step)));

  const x = (i) => pad.l + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v) => pad.t + plotH - ((v - lo) / (hi - lo)) * plotH;

  const svg = node('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': `${points.length} points, from ${format(values[0])} to ${format(values.at(-1))}`,
  });

  /* grid: round steps, labelled, and quiet enough to read through */
  for (let i = 0; i <= ticks; i++) {
    const v = lo + ((hi - lo) * i) / ticks;
    const yy = y(v);
    svg.append(node('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, class: 'chart-grid' }));
    const label = node('text', { x: pad.l - 7, y: yy + 3.5, class: 'chart-axis', 'text-anchor': 'end' });
    label.textContent = short(v);
    svg.append(label);
  }
  if (lo < 0) svg.append(node('line', { x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0), class: 'chart-zero' }));

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  svg.append(node('path', {
    d: `${line} L${x(points.length - 1).toFixed(1)},${y(lo)} L${x(0).toFixed(1)},${y(lo)} Z`,
    class: 'chart-area',
  }));
  svg.append(node('path', { d: line, class: 'chart-line' }));

  /* only the last point is marked: it is the one the reader is looking for */
  const last = points.length - 1;
  svg.append(node('circle', { cx: x(last), cy: y(points[last].value), r: 4.5, class: 'chart-end' }));

  /* x labels: first, middle, last — never one per point */
  for (const i of [...new Set([0, Math.floor(last / 2), last])]) {
    const t = node('text', {
      x: x(i), y: H - 6, class: 'chart-axis',
      'text-anchor': i === 0 ? 'start' : i === last ? 'end' : 'middle',
    });
    t.textContent = points[i].label;
    svg.append(t);
  }

  /* hover layer: a crosshair and the value under the finger */
  const cross = node('line', { class: 'chart-cross', y1: pad.t, y2: pad.t + plotH, x1: 0, x2: 0, opacity: 0 });
  const dot = node('circle', { r: 4.5, class: 'chart-dot', opacity: 0 });
  svg.append(cross, dot);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;

  const at = (evt) => {
    const box = svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(last, Math.round(((px - pad.l) / plotW) * last)));
    const p = points[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.value)); dot.setAttribute('opacity', 1);
    tip.hidden = false;
    tip.innerHTML = '';
    const k = document.createElement('div'); k.className = 'k'; k.textContent = p.sub || p.label;
    const v = document.createElement('div'); v.className = 'v num'; v.textContent = format(p.value);
    tip.append(k, v);
    const left = (x(i) / W) * box.width;
    tip.style.left = `${Math.max(4, Math.min(box.width - 4, left))}px`;
  };
  const off = () => { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tip.hidden = true; };
  svg.addEventListener('pointermove', at);
  svg.addEventListener('pointerdown', at);
  svg.addEventListener('pointerleave', off);

  wrap.append(svg, tip);
  return wrap;
}

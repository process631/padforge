// Stick response curve chart. The six curve bytes are three (input, output) points on a 0-255 scale.
export function curveSvg(values, { w = 160, h = 112 } = {}) {
  const pad = 10;
  const sx = v => (pad + (v / 255) * (w - 2 * pad)).toFixed(1);
  const sy = v => (h - pad - (v / 255) * (h - 2 * pad)).toFixed(1);
  const pts = [[0, 0], [values[0], values[1]], [values[2], values[3]], [values[4], values[5]], [255, 255]];
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x)} ${sy(y)}`).join(' ');
  const area = `${line} L${sx(255)} ${sy(0)} L${sx(0)} ${sy(0)} Z`;
  const grid = [0.25, 0.5, 0.75].map(f => {
    const v = 255 * f;
    return `<path class="cg" d="M${sx(v)} ${sy(0)} V${sy(255)} M${sx(0)} ${sy(v)} H${sx(255)}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="curve-svg" role="img" aria-label="Stick response curve">
    <rect class="cbg" x="${pad}" y="${pad}" width="${w - 2 * pad}" height="${h - 2 * pad}" rx="4"/>
    ${grid}
    <path class="cdiag" d="M${sx(0)} ${sy(0)} L${sx(255)} ${sy(255)}"/>
    <path class="carea" d="${area}"/>
    <path class="cline" d="${line}"/>
    ${pts.slice(1, 4).map(([x, y]) => `<circle class="cpt" cx="${sx(x)}" cy="${sy(y)}" r="2.6"/>`).join('')}
  </svg>`;
}

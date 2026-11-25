// Names and vector glyphs for controller inputs (crisp at any size, colored via currentColor).

export const NAME = {
  UP: 'D-pad up', DOWN: 'D-pad down', LEFT: 'D-pad left', RIGHT: 'D-pad right',
  TRIANGLE: 'Triangle', CIRCLE: 'Circle', CROSS: 'Cross', SQUARE: 'Square',
  L1: 'L1', R1: 'R1', L2: 'L2', R2: 'R2', L3: 'L3 (press stick)', R3: 'R3 (press stick)',
  OPTIONS: 'Options', CREATE: 'Create', TOUCH: 'Touch pad', PS: 'PS button', MUTE: 'Mute',
  PADL: 'Left back button', PADR: 'Right back button', FNL: 'Left Fn', FNR: 'Right Fn',
};
// Captions shown under a glyph. Keys whose glyph is already text get a description instead of repeating it.
export const SHORT = {
  ...NAME, L1: 'Left bumper', R1: 'Right bumper', L2: 'Left trigger', R2: 'Right trigger',
  L3: 'Left stick press', R3: 'Right stick press', PS: 'Button', PADL: 'Back left', PADR: 'Back right', FNL: 'Left', FNR: 'Right',
};

export function glyph(k, x, y) {
  const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
  const F = 'fill="currentColor"';
  const text = (s, size = 11.5) => `<text x="${x}" y="${y}" ${F} font-size="${size}" font-weight="700" text-anchor="middle" dominant-baseline="central">${s}</text>`;
  switch (k) {
    case 'TRIANGLE': return `<path ${S} d="M${x} ${y - 7} L${x + 7.5} ${y + 5.5} L${x - 7.5} ${y + 5.5}Z"/>`;
    case 'CIRCLE': return `<circle ${S} cx="${x}" cy="${y}" r="7"/>`;
    case 'CROSS': return `<path ${S} d="M${x - 6.5} ${y - 6.5} L${x + 6.5} ${y + 6.5} M${x + 6.5} ${y - 6.5} L${x - 6.5} ${y + 6.5}"/>`;
    case 'SQUARE': return `<rect ${S} x="${x - 6.5}" y="${y - 6.5}" width="13" height="13" rx="1.5"/>`;
    case 'UP': return `<path ${F} d="M${x} ${y - 7} L${x + 7} ${y + 4} L${x - 7} ${y + 4}Z"/>`;
    case 'DOWN': return `<path ${F} d="M${x} ${y + 7} L${x + 7} ${y - 4} L${x - 7} ${y - 4}Z"/>`;
    case 'LEFT': return `<path ${F} d="M${x - 7} ${y} L${x + 4} ${y - 7} L${x + 4} ${y + 7}Z"/>`;
    case 'RIGHT': return `<path ${F} d="M${x + 7} ${y} L${x - 4} ${y - 7} L${x - 4} ${y + 7}Z"/>`;
    case 'OPTIONS': return `<path ${S} d="M${x - 7} ${y - 5} H${x + 7} M${x - 7} ${y} H${x + 7} M${x - 7} ${y + 5} H${x + 7}"/>`;
    case 'CREATE': return `<path ${S} d="M${x - 3} ${y - 9} V${y - 5} M${x - 8} ${y - 8} L${x - 5.5} ${y - 5} M${x + 2} ${y - 8} L${x - 0.5} ${y - 5}"/><rect ${S} x="${x - 7}" y="${y - 2}" width="14" height="9" rx="2"/>`;
    case 'TOUCH': return `<rect ${S} x="${x - 8.5}" y="${y - 6}" width="17" height="12" rx="3"/>`;
    case 'MUTE': return `<rect ${S} x="${x - 3}" y="${y - 8}" width="6" height="10" rx="3"/><path ${S} d="M${x - 6} ${y} a6 6 0 0 0 12 0 M${x} ${y + 6} V${y + 8.5}"/>`;
    case 'PS': return text('PS', 10.5);
    case 'PADL': return text('BL', 10.5);
    case 'PADR': return text('BR', 10.5);
    case 'FNL': case 'FNR': return text('Fn', 10.5);
    default: return text(k);
  }
}

export const glyphIcon = (k, size = 22) =>
  `<svg class="glyph" width="${size}" height="${size}" viewBox="-11 -11 22 22" aria-hidden="true">${glyph(k, 0, 0)}</svg>`;

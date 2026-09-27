/* XP Flight Computer — study figures (inline SVG, theme-aware)
 * Charts are plotted from the same calc functions the calculators use, so they are drawn to scale.
 */
(function (root) {
  'use strict';
  const C = root.XFC.calc;
  let uid = 0;

  const svg = (w, h, label, body) => {
    const id = 'fg' + (++uid);
    const marks = ['acc', 'sel', 'live', 'warn', 'bad', 'line'].map(c =>
      `<marker id="${id}-${c}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="f-${c}"/></marker>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg"><defs>${marks}</defs>${body(id)}</svg>`;
  };
  const arrow = (id, x1, y1, x2, y2, c = 'line', extra = '') =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="s-${c}" marker-end="url(#${id}-${c})" ${extra}/>`;
  const dbl = (id, x1, y1, x2, y2, c = 'line') =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="s-${c}" marker-start="url(#${id}-${c})" marker-end="url(#${id}-${c})"/>`;
  const text = (x, y, s, cls = 't', anchor = 'start', extra = '') => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}" ${extra}>${s}</text>`;
  const line = (x1, y1, x2, y2, cls = 's-line') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
  const f = (x, d = 1) => Number(x).toFixed(d);
  const arcPath = (cx, cy, r, a0, a1) => { // angles in screen degrees, 0 = +x, clockwise positive
    const p = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
    return `M${f(x0)} ${f(y0)} A${r} ${r} 0 ${large} ${sweep} ${f(x1)} ${f(y1)}`;
  };
  const brg = (cx, cy, b, r) => [cx + r * Math.sin(b * Math.PI / 180), cy - r * Math.cos(b * Math.PI / 180)];

  /** Generic chart frame. xs/ys: {min,max,ticks:[...], label}. Returns helpers + svg pieces. */
  function frame(W, H, m, xs, ys) {
    const X = v => m.l + (v - xs.min) / (xs.max - xs.min) * (W - m.l - m.r);
    const Y = v => H - m.b - (v - ys.min) / (ys.max - ys.min) * (H - m.t - m.b);
    let g = '';
    for (const t of xs.ticks) g += line(f(X(t)), m.t, f(X(t)), H - m.b, 's-grid') + text(f(X(t)), H - m.b + 16, xs.fmt ? xs.fmt(t) : t, 't tm', 'middle');
    for (const t of ys.ticks) g += line(m.l, f(Y(t)), W - m.r, f(Y(t)), 's-grid') + text(m.l - 6, f(Y(t) + 4), ys.fmt ? ys.fmt(t) : t, 't tm', 'end');
    g += line(m.l, H - m.b, W - m.r, H - m.b, 's-thin') + line(m.l, m.t, m.l, H - m.b, 's-thin');
    g += text((m.l + W - m.r) / 2, H - 6, xs.label, 't', 'middle');
    g += `<text x="14" y="${(m.t + H - m.b) / 2}" class="t" text-anchor="middle" transform="rotate(-90 14 ${(m.t + H - m.b) / 2})">${ys.label}</text>`;
    const path = pts => pts.map((p, i) => (i ? 'L' : 'M') + f(X(p[0])) + ' ' + f(Y(p[1]))).join(' ');
    return { X, Y, grid: g, path };
  }
  const range = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(6)); return o; };
  const kft = v => (v === 0 ? '0' : (v / 1000) + 'k');

  const airlinerSide = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
      <path d="M-128 -9 H98 Q126 -5 130 0 Q126 6 98 9 H-122 Q-134 7 -136 0 Q-134 -7 -128 -9 Z" class="f-soft s-line"/>
      <path d="M-122 -9 L-106 -52 H-92 L-96 -9 Z" class="f-soft s-line"/>
      <path d="M-122 -2 L-150 -4 L-150 2 L-122 3 Z" class="f-soft s-line"/>
      <path d="M-18 1 L46 1 L30 7 L-22 7 Z" class="f-line"/>
      <rect x="-8" y="7" width="30" height="11" rx="5.5" class="f-soft s-line"/>
      ${range(-100, 90, 12).map(v => `<circle cx="${v}" cy="-3" r="1.6" class="f-muted"/>`).join('')}
      <path d="M104 -6 L116 -6 L121 -1 L106 -1 Z" class="f-muted"/>
    </g>`;

  const F = {};

  // ---------------------------------------------------------------- 1.1 four forces
  F.forces = () => svg(640, 300, 'Four forces on an aircraft in flight', id => `
    <rect x="0" y="0" width="640" height="300" class="f-sky" rx="8"/>
    ${airlinerSide(320, 152, 1.25)}
    ${arrow(id, 330, 132, 330, 34, 'acc')}${text(342, 44, 'Lift  L = ½ρV²S·C<tspan baseline-shift="sub" font-size="9">L</tspan>', 't-acc')}
    ${arrow(id, 330, 172, 330, 272, 'bad')}${text(342, 268, 'Weight  W = mg', 't-bad')}
    ${arrow(id, 492, 152, 606, 152, 'live')}${text(600, 140, 'Thrust T', 't-live', 'end')}
    ${arrow(id, 126, 152, 30, 152, 'warn')}${text(40, 140, 'Drag  D = ½ρV²S·C<tspan baseline-shift="sub" font-size="9">D</tspan>', 't-warn')}
    <circle cx="330" cy="152" r="5" class="f-surface s-line"/><circle cx="330" cy="152" r="2" class="f-line"/>
    ${text(20, 286, 'Steady, level flight: L = W and T = D. Change any one and the aircraft accelerates, climbs or descends.', 't')}`);

  // ---------------------------------------------------------------- 1.1 airfoil & AoA
  F.airfoil = () => svg(640, 270, 'Airfoil at an angle of attack to the relative wind', id => {
    const ax = 210, ay = 140, c = 300, a = 8, m = 0.02, pp = 0.4, t = 0.15;
    const up = [], lo = [];
    for (let i = 0; i <= 40; i++) {
      const x = (1 - Math.cos(Math.PI * i / 40)) / 2;
      const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
      const yc = x < pp ? m / (pp * pp) * (2 * pp * x - x * x) : m / ((1 - pp) ** 2) * ((1 - 2 * pp) + 2 * pp * x - x * x);
      up.push([ax + x * c, ay - (yc + yt) * c]); lo.push([ax + x * c, ay - (yc - yt) * c]);
    }
    const d = 'M' + up.map(q => f(q[0]) + ' ' + f(q[1])).join(' L') + ' L' + lo.reverse().map(q => f(q[0]) + ' ' + f(q[1])).join(' L') + ' Z';
    const cp = [ax + 0.27 * c * Math.cos(a * Math.PI / 180), ay + 0.27 * c * Math.sin(a * Math.PI / 180)];
    return `
    ${[96, 140, 184].map(y => arrow(id, 24, y, 130, y, 'line', 'opacity="0.5"')).join('')}
    ${text(24, 214, 'Relative wind', 'tb')}${text(24, 230, 'the airflow the wing meets', 't')}
    <g transform="rotate(${a} ${ax} ${ay})"><path d="${d}" class="f-soft s-line"/><line x1="${ax}" y1="${ay}" x2="${ax + c}" y2="${ay}" class="s-dash"/></g>
    <line x1="${ax}" y1="${ay}" x2="${ax + c + 30}" y2="${ay}" class="s-thin" stroke-dasharray="2 4"/>
    <path d="${arcPath(ax, ay, 190, 0, a)}" class="s-acc nf"/>${text(ax + 198, ay + 20, 'α', 't-acc')}
    ${text(ax + c - 10, ay + 62, 'chord line', 't', 'end')}
    ${arrow(id, f(cp[0]), f(cp[1] - 22), f(cp[0]), 24, 'acc')}${text(f(cp[0] + 10), 34, 'Lift — at 90° to the relative wind', 't-acc')}
    ${arrow(id, 540, 214, 616, 214, 'warn')}${text(616, 236, 'Drag — along the relative wind', 't-warn', 'end')}
    ${text(24, 262, 'Lift grows with α up to the critical angle (≈15–18° clean); beyond it the flow separates and the wing stalls.', 't')}`;
  });

  // ---------------------------------------------------------------- 1.1 lift curve
  F.liftCurve = () => {
    const fr = frame(640, 300, { l: 54, r: 20, t: 16, b: 38 },
      { min: -4, max: 24, ticks: range(-4, 24, 4), label: 'Angle of attack α (degrees)' },
      { min: -0.4, max: 3.0, ticks: range(0, 3, 0.5), label: 'Lift coefficient C_L', fmt: v => v.toFixed(1) });
    const curve = (a0, as, clmax) => {
      const pts = [];
      for (let a = -4; a <= 24; a += 0.25) {
        const lin = 0.1 * (a - a0), L = 0.1 * (as - 3 - a0);
        let cl;
        if (a <= as - 3) cl = lin;
        else if (a <= as) cl = clmax - (clmax - L) * Math.pow((as - a) / 3, 2);
        else cl = clmax - 0.09 * (a - as) - 0.004 * Math.pow(a - as, 2);
        if (cl > -0.4 && cl < 3.05) pts.push([a, cl]);
      }
      return pts;
    };
    const sets = [[-10, 18, 2.72, 'acc', 'Landing flaps + slats'], [-8, 13, 2.05, 'live', 'Take-off flaps'], [-2, 15, 1.55, 'sel', 'Clean wing']];
    const lx = fr.X(-3.4), ly = fr.Y(2.86);
    return svg(640, 300, 'Lift coefficient against angle of attack', id => fr.grid + sets.map(([a0, as, cm, c]) =>
      `<path d="${fr.path(curve(a0, as, cm))}" class="s-${c} nf"/><circle cx="${f(fr.X(as))}" cy="${f(fr.Y(cm))}" r="4.5" class="f-${c}"/>`).join('') +
      `<rect x="${f(lx - 8)}" y="${f(ly - 16)}" width="236" height="80" rx="6" class="f-surface s-thin"/>` +
      sets.map(([, , cm, c, name], i) => line(f(lx), f(ly + i * 22), f(lx + 22), f(ly + i * 22), 's-' + c) +
        text(f(lx + 30), f(ly + i * 22 + 4), name + ' · C<tspan baseline-shift="sub" font-size="9">Lmax</tspan> ' + cm.toFixed(2), 't-' + c)).join('') +
      text(fr.X(23.6), fr.Y(-0.22), 'Typical swept-wing airliner shapes (illustrative)', 't', 'end'));
  };

  // ---------------------------------------------------------------- 1.2 stall speed vs bank
  F.stallBank = () => {
    const fr = frame(640, 290, { l: 54, r: 24, t: 16, b: 38 },
      { min: 0, max: 75, ticks: range(0, 75, 15), label: 'Bank angle φ in a level turn (degrees)' },
      { min: 1, max: 4, ticks: range(1, 4, 0.5), label: 'Multiplier', fmt: v => v.toFixed(1) + '×' });
    const n = [], vs = [];
    for (let b = 0; b <= 75; b += 1) { const k = 1 / Math.cos(b * Math.PI / 180); n.push([b, k]); vs.push([b, Math.sqrt(k)]); }
    const marks = [30, 45, 60].map(b => {
      const k = 1 / Math.cos(b * Math.PI / 180);
      return `<circle cx="${f(fr.X(b))}" cy="${f(fr.Y(k))}" r="4" class="f-acc"/>${text(f(fr.X(b) - 6), f(fr.Y(k) - 9), k.toFixed(2) + ' g', 't-acc', 'end')}
        <circle cx="${f(fr.X(b))}" cy="${f(fr.Y(Math.sqrt(k)))}" r="4" class="f-sel"/>${b > 30 ? text(f(fr.X(b) + 9), f(fr.Y(Math.sqrt(k)) + 6), '+' + ((Math.sqrt(k) - 1) * 100).toFixed(0) + ' %', 't-sel') : ''}`;
    }).join('');
    return svg(640, 290, 'Load factor and stall speed multiplier against bank angle', id => fr.grid +
      `<path d="${fr.path(n)}" class="s-acc nf"/><path d="${fr.path(vs)}" class="s-sel nf"/>` + marks +
      text(fr.X(52), fr.Y(3.55), 'Load factor n = 1 / cos φ', 't-acc') + text(fr.X(55), fr.Y(1.62), 'Stall speed × √n', 't-sel'));
  };

  // ---------------------------------------------------------------- 1.3 turning flight
  F.turn = () => svg(640, 300, 'Forces in a banked turn and turn radius', id => {
    const cx = 170, cy = 170, phi = 30;
    const up = [Math.sin(phi * Math.PI / 180), -Math.cos(phi * Math.PI / 180)];
    const Lx = cx + up[0] * 120, Ly = cy + up[1] * 120;
    return `
    <g transform="rotate(${phi} ${cx} ${cy})">
      <ellipse cx="${cx}" cy="${cy}" rx="16" ry="16" class="f-soft s-line"/>
      <path d="M${cx - 110} ${cy + 2} L${cx - 14} ${cy - 4} L${cx + 14} ${cy - 4} L${cx + 110} ${cy + 2} L${cx + 110} ${cy + 6} L${cx - 110} ${cy + 6} Z" class="f-soft s-line"/>
      <path d="M${cx - 3} ${cy - 16} L${cx} ${cy - 48} L${cx + 3} ${cy - 16} Z" class="f-soft s-line"/>
      <line x1="${cx}" y1="${cy - 60}" x2="${cx}" y2="${cy + 40}" class="s-dash"/>
    </g>
    ${arrow(id, cx, cy, f(Lx), f(Ly), 'acc')}${text(f(Lx + 6), f(Ly - 4), 'Lift L', 't-acc')}
    ${arrow(id, cx, cy, cx, f(cy - 120 * Math.cos(phi * Math.PI / 180)), 'live')}${text(cx - 8, f(cy - 110), 'L cos φ = W', 't-live', 'end')}
    ${arrow(id, cx, cy, f(Lx), cy, 'sel')}${text(f(Lx + 6), cy + 16, 'L sin φ', 't-sel')}
    ${line(f(Lx), f(Ly), f(Lx), cy, 's-dash')}
    ${arrow(id, cx, cy + 20, cx, cy + 100, 'bad')}${text(cx + 8, cy + 96, 'W', 't-bad')}
    <path d="${arcPath(cx, cy, 58, -90, -90 + phi)}" class="s-line nf"/>${text(cx + 16, cy - 64, 'φ', 'tb')}
    ${text(40, 290, 'Rear view: the tilted lift both holds the weight and pulls the aircraft round.', 't')}
    <circle cx="470" cy="150" r="100" class="s-dash nf"/>
    <circle cx="470" cy="150" r="3" class="f-line"/>${line(470, 150, 570, 150, 's-line')}${text(515, 143, 'r', 'tb', 'middle')}
    <g transform="translate(570 150) rotate(180)"><path d="M0 -12 L6 6 L0 2 L-6 6 Z" class="f-acc"/></g>
    ${arrow(id, 570, 162, 570, 242, 'acc')}${text(580, 236, 'V', 't-acc')}${text(470, 40, 'right turn, seen from above', 't', 'middle')}
    ${arrow(id, 562, 150, 486, 150, 'sel')}
    ${text(470, 272, 'Top view:  r = V² / (g tan φ)   ·   ω = g tan φ / V', 't', 'middle')}`;
  });

  // ---------------------------------------------------------------- 1.4 glide
  F.glide = () => svg(640, 240, 'Glide distance and the glide ratio', id => `
    <rect x="30" y="196" width="600" height="30" class="f-ground" rx="4"/>
    ${line(30, 196, 630, 196, 's-line')}
    <g transform="translate(70 46) rotate(8)"><path d="M-18 -3 H14 Q22 0 14 3 H-18 Z M-2 -1 L4 -14 L8 -14 L6 -1 Z M-14 -2 L-20 -9 L-16 -9 L-10 -2 Z" class="f-line"/></g>
    <path d="M78 52 L560 196" class="s-acc nf"/>${text(330, 110, 'still air: distance = h × L/D', 't-acc')}
    <path d="M78 52 L440 196" class="s-warn nf" stroke-dasharray="7 5"/>${text(258, 166, 'into a headwind: shorter', 't-warn', 'middle')}
    ${dbl(id, 52, 52, 52, 196)}${text(44, 128, 'h', 'tb', 'end')}
    ${dbl(id, 78, 214, 560, 214)}${text(320, 212, 'd', 'tb', 'middle')}
    <path d="${arcPath(560, 196, 60, 180, 196.6)}" class="s-line nf"/>${text(488, 188, 'γ', 'tb')}
    ${text(628, 30, 'L/D = d / h = 1 / tan γ', 'tb', 'end')}${text(628, 48, 'C172 ≈ 9 : 1 · A320 ≈ 17 : 1 · glider ≈ 40 : 1', 't', 'end')}`);

  // ---------------------------------------------------------------- 2.1 ISA
  F.isa = () => {
    const alts = range(0, 65000, 500);
    const fT = frame(310, 300, { l: 50, r: 10, t: 14, b: 38 }, { min: -70, max: 20, ticks: [-60, -40, -20, 0, 20], label: 'Temperature (°C)' },
      { min: 0, max: 65000, ticks: range(0, 60000, 10000), label: 'Pressure altitude (ft)', fmt: kft });
    const fP = frame(310, 300, { l: 50, r: 14, t: 14, b: 38 }, { min: 0, max: 1050, ticks: [0, 250, 500, 750, 1000], label: 'Pressure (hPa)' },
      { min: 0, max: 65000, ticks: range(0, 60000, 10000), label: 'Pressure altitude (ft)', fmt: kft });
    const tp = C.isa(36089);
    return svg(640, 300, 'ISA temperature and pressure against altitude', id => `
      <g>${fT.grid}<path d="${fT.path(alts.map(a => [C.isa(a).Tc, a]))}" class="s-sel nf"/>
        ${line(fT.X(-70), f(fT.Y(36089)), fT.X(20), f(fT.Y(36089)), 's-dash')}${text(f(fT.X(-66)), f(fT.Y(36089) - 6), 'tropopause 36 089 ft', 't')}
        <circle cx="${f(fT.X(15))}" cy="${f(fT.Y(0))}" r="4" class="f-sel"/>${text(f(fT.X(15) - 6), f(fT.Y(0) - 8), '+15 °C', 't-sel', 'end')}
        ${text(f(fT.X(-55)), f(fT.Y(50000)), '−56.5 °C', 't-sel')}${text(f(fT.X(-24)), f(fT.Y(18000)), '−1.98 °C / 1000 ft', 't-sel')}</g>
      <g transform="translate(330 0)">${fP.grid}<path d="${fP.path(alts.map(a => [C.isa(a).hPa, a]))}" class="s-acc nf"/>
        ${line(fP.X(0), f(fP.Y(36089)), fP.X(1050), f(fP.Y(36089)), 's-dash')}
        <circle cx="${f(fP.X(1013.25))}" cy="${f(fP.Y(0))}" r="4" class="f-acc"/>${text(f(fP.X(1013.25) - 6), f(fP.Y(0) - 8), '1013.25', 't-acc', 'end')}
        <circle cx="${f(fP.X(C.isa(18000).hPa))}" cy="${f(fP.Y(18000))}" r="4" class="f-acc"/>${text(f(fP.X(C.isa(18000).hPa) + 8), f(fP.Y(18000) + 4), 'half at 18 000 ft', 't-acc')}
        ${text(f(fP.X(tp.hPa) + 8), f(fP.Y(36089) + 16), f(tp.hPa, 0) + ' hPa', 't-acc')}</g>`);
  };

  // ---------------------------------------------------------------- 2.2 altimetry
  F.altimetry = () => svg(640, 300, 'QFE, QNH and standard pressure settings', id => `
    <rect x="0" y="0" width="640" height="300" class="f-sky" rx="8"/>
    <path d="M0 250 L60 244 L110 226 L150 214 L330 214 L360 222 L420 232 L470 246 L640 250 L640 300 L0 300 Z" class="f-ground"/>
    ${line(150, 214, 330, 214, 's-line')}${text(240, 208, 'Airfield', 'tb', 'middle')}${line(330, 214, 430, 214, 's-dash')}
    ${line(0, 250, 640, 250, 's-dash')}${text(8, 244, 'Mean sea level', 't')}
    <line x1="0" y1="270" x2="640" y2="270" class="s-bad" stroke-dasharray="3 5" style="stroke-width:1.5"/>${text(8, 288, '1013.25 hPa level — below sea level on a low-pressure day', 't-bad')}
    ${line(0, 118, 640, 118, 's-thin')}${text(8, 112, 'Transition altitude: QNH below, standard above', 't')}
    <g transform="translate(520 72)"><path d="M-22 -3 H16 Q24 0 16 3 H-22 Z M-4 -1 L2 -12 L7 -12 L5 -1 Z M-18 -2 L-23 -9 L-19 -9 L-13 -2 Z" class="f-line"/></g>
    ${dbl(id, 430, 84, 430, 214, 'live')}${text(422, 150, 'QFE', 't-live', 'end')}${text(422, 166, 'height', 't', 'end')}
    ${dbl(id, 525, 84, 525, 250, 'sel')}${text(517, 186, 'QNH', 't-sel', 'end')}${text(517, 202, 'altitude', 't', 'end')}
    ${dbl(id, 620, 84, 620, 270, 'bad')}${text(612, 214, 'STD', 't-bad', 'end')}${text(612, 230, 'flight level', 't', 'end')}`);

  // ---------------------------------------------------------------- 2.2 high to low
  F.highLow = () => svg(640, 250, 'Flying from high to low pressure', id => `
    <rect x="30" y="205" width="580" height="20" class="f-ground" rx="4"/>${line(30, 205, 610, 205, 's-line')}
    <path d="M40 70 C 200 72, 420 120, 600 132" class="s-sel nf"/>${text(236, 108, '700 hPa pressure surface', 't-sel', 'middle')}
    <path d="M40 30 C 200 32, 420 80, 600 92" class="s-thin nf"/>
    ${text(50, 190, 'H', 'tl')}${text(580, 190, 'L', 'tl')}
    ${[[90, 70], [330, 94], [560, 128]].map(([x, y]) => `<g transform="translate(${x} ${y - 6})"><path d="M-16 -2 H12 Q18 0 12 2 H-16 Z M-3 -1 L2 -9 L6 -9 L4 -1 Z" class="f-line"/></g>`).join('')}
    ${dbl(id, 90, 70, 90, 205, 'live')}${text(98, 150, 'true 10 000 ft', 't-live')}
    ${dbl(id, 560, 124, 560, 205, 'bad')}${text(552, 172, 'true ≈ 8 800 ft', 't-bad', 'end')}
    ${text(320, 30, 'Altimeter setting unchanged: it reads 10 000 ft the whole way', 'tb', 'middle')}
    ${text(320, 242, 'High to low (or hot to cold), look out below', 't', 'middle')}`);

  // ---------------------------------------------------------------- 2.3 density altitude chart
  F.densityAlt = () => {
    const fr = frame(640, 300, { l: 58, r: 70, t: 14, b: 38 }, { min: -10, max: 40, ticks: range(-10, 40, 10), label: 'Outside air temperature (°C)' },
      { min: -2000, max: 14000, ticks: range(-2000, 14000, 2000), label: 'Density altitude (ft)', fmt: v => v / 1000 + 'k' });
    const pas = [0, 2000, 4000, 6000, 8000];
    return svg(640, 300, 'Density altitude against temperature for several pressure altitudes', id => fr.grid + pas.map((pa, i) => {
      const pts = range(-10, 40, 1).map(t => [t, C.densityAltitude(pa, t).ft]);
      const isaT = C.isaTempC(pa);
      const c = i === 2 ? 'acc' : 'sel';
      return `<path d="${fr.path(pts)}" class="s-${c} nf" ${i === 2 ? '' : 'opacity="0.7"'}/>` +
        `<circle cx="${f(fr.X(isaT))}" cy="${f(fr.Y(pa))}" r="3.5" class="f-surface s-line"/>` +
        text(f(fr.X(40) + 6), f(fr.Y(pts[pts.length - 1][1]) + 4), 'PA ' + pa, 't-' + c);
    }).join('') + text(fr.X(-8), fr.Y(12600), 'Circles: ISA temperature — there, density altitude equals pressure altitude', 't'));
  };

  // ---------------------------------------------------------------- 2.4 temperature error
  F.tempError = () => {
    const base = 250, s = 0.055;
    const cols = [[-20, 'Cold (ISA −20)', 'bad'], [0, 'ISA', 'line'], [20, 'Warm (ISA +20)', 'warn']];
    return svg(640, 300, 'Air column height in cold, standard and warm air', id => `
      <rect x="20" y="${base}" width="600" height="36" class="f-ground" rx="4"/>${line(20, base, 620, base, 's-line')}
      ${cols.map(([dev, name, c], i) => {
        const x = 90 + i * 190;
        const top = C.trueHeight(3000, dev, 0);
        const y = base - top * s;
        return `<rect x="${x - 40}" y="${f(y)}" width="80" height="${f(base - y)}" class="fa-sel s-thin"/>
          ${[1000, 2000, 3000].map(h => { const yy = base - C.trueHeight(h, dev, 0) * s; return line(x - 40, f(yy), x + 40, f(yy), 's-thin') + text(x + 46, f(yy + 4), h, 't tm'); }).join('')}
          <g transform="translate(${x} ${f(y - 10)})"><path d="M-16 -2 H12 Q18 0 12 2 H-16 Z M-3 -1 L2 -9 L6 -9 L4 -1 Z" class="f-${c === 'line' ? 'line' : c}"/></g>
          ${text(x, 286, name, 'tb', 'middle')}${text(x, f(y - 26), 'true ' + Math.round(top) + ' ft', c === 'line' ? 'tb' : 't-' + c, 'middle')}`;
      }).join('')}
      <path d="M172 ${base} L204 ${base - 2850 * s} L236 ${base}" class="f-ground s-line"/>${text(204, base - 2850 * s - 8, 'ridge 2850 ft', 't', 'middle')}
      ${text(20, 20, 'Every column shows the altimeter reading 3000 ft (QNH set at sea level).', 't')}`);
  };

  // ---------------------------------------------------------------- 3.1 airspeed chain
  F.speedChain = () => svg(640, 190, 'From indicated airspeed to ground speed', id => {
    const boxes = [['IAS', 'indicated', 'line'], ['CAS', 'calibrated', 'sel'], ['EAS', 'equivalent', 'sel'], ['TAS', 'true', 'acc'], ['GS', 'ground', 'live']];
    const notes = ['instrument &\nposition error', 'compressibility\n(high speed)', 'density\n× √(ρ₀/ρ)', 'wind'];
    return boxes.map(([k, s, c], i) => {
      const x = 14 + i * 126;
      return `<rect x="${x}" y="40" width="96" height="64" rx="10" class="f-surface s-${c === 'line' ? 'line' : c}"/>${text(x + 48, 72, k, c === 'line' ? 'tl' : 'tl', 'middle', `style="fill:var(--${c === 'line' ? 'text' : c === 'sel' ? 'sel' : c === 'acc' ? 'accent' : 'live'})"`)}${text(x + 48, 92, s, 't', 'middle')}` +
        (i < 4 ? arrow(id, x + 98, 72, x + 124, 72) + notes[i].split('\n').map((l, j) => text(x + 111, 128 + j * 15, l, 't', 'middle')).join('') : '');
    }).join('') + text(320, 22, 'Each step removes one error or effect', 'tb', 'middle') + text(320, 182, 'Low and slow: IAS ≈ CAS ≈ EAS. High and fast they all differ — the calculators do it exactly.', 't', 'middle');
  });

  // ---------------------------------------------------------------- 3.1 pitot static
  F.pitot = () => svg(640, 230, 'Pitot-static system and the airspeed indicator', id => `
    ${[60, 90].map(y => arrow(id, 20, y, 90, y, 'line', 'opacity="0.5"')).join('')}${text(20, 120, 'airflow', 't')}
    <path d="M100 70 H230 V80 H100 Z" class="f-soft s-line"/><circle cx="100" cy="75" r="4" class="f-acc"/>${text(100, 56, 'Pitot tube: total pressure P<tspan baseline-shift="sub" font-size="9">t</tspan>', 't-acc')}
    <path d="M40 170 H260" class="s-line"/><circle cx="150" cy="170" r="5" class="f-sel"/>${text(150, 196, 'Static port: static pressure P<tspan baseline-shift="sub" font-size="9">s</tspan>', 't-sel', 'middle')}
    <path d="M230 75 H420 V120" class="s-acc nf"/><path d="M155 165 V150 H520 V130" class="s-sel nf"/>
    <circle cx="470" cy="125" r="58" class="f-surface s-line"/>
    <path d="M440 125 q15 -22 30 0 q15 22 30 0" class="s-acc nf"/>${text(470, 100, 'capsule', 't', 'middle')}
    <line x1="470" y1="125" x2="505" y2="92" class="s-line"/><circle cx="470" cy="125" r="4" class="f-line"/>
    ${text(470, 205, 'q<tspan baseline-shift="sub" font-size="9">c</tspan> = P<tspan baseline-shift="sub" font-size="9">t</tspan> − P<tspan baseline-shift="sub" font-size="9">s</tspan> moves the needle → IAS', 'tb', 'middle')}
    ${text(600, 40, 'Blocked pitot: acts like an altimeter', 't', 'end')}${text(600, 58, 'Blocked static: freezes altimeter & VSI', 't', 'end')}`);

  // ---------------------------------------------------------------- 3.2 crossover chart
  F.crossover = () => {
    const cas = 290, M = 0.78;
    const xo = C.crossoverAltitude(cas, M).ft;
    const fr = frame(640, 300, { l: 58, r: 20, t: 14, b: 38 }, { min: 250, max: 520, ticks: range(250, 500, 50), label: 'True airspeed (kt, ISA)' },
      { min: 0, max: 42000, ticks: range(0, 40000, 10000), label: 'Pressure altitude (ft)', fmt: kft });
    const alts = range(0, 42000, 500);
    const casL = alts.map(a => [C.casToTas(cas, a, C.isaTempC(a)).tas, a]);
    const machL = alts.map(a => [C.machToTas(M, C.isaTempC(a)), a]);
    const flown = alts.map(a => [a <= xo ? C.casToTas(cas, a, C.isaTempC(a)).tas : C.machToTas(M, C.isaTempC(a)), a]);
    const xt = C.machToTas(M, C.isaTempC(xo));
    return svg(640, 300, 'Constant CAS and constant Mach lines crossing at the crossover altitude', id => fr.grid +
      `<path d="${fr.path(casL)}" class="s-sel nf" stroke-dasharray="6 5"/><path d="${fr.path(machL)}" class="s-live nf" stroke-dasharray="6 5"/>
       <path d="${fr.path(flown)}" class="s-acc nf" style="stroke-width:4"/>
       <circle cx="${f(fr.X(xt))}" cy="${f(fr.Y(xo))}" r="5" class="f-acc"/>${text(f(fr.X(xt) - 10), f(fr.Y(xo) + 4), 'crossover ≈ FL' + Math.round(xo / 100), 't-acc', 'end')}
       ${text(f(fr.X(C.casToTas(cas, 8000, C.isaTempC(8000)).tas) + 8), f(fr.Y(8000)), cas + ' KCAS', 't-sel')}
       ${text(f(fr.X(C.machToTas(M, C.isaTempC(38000))) + 8), f(fr.Y(38000)), 'M' + M.toFixed(2), 't-live')}
       ${text(fr.X(254), fr.Y(40000), 'Bold: the speed you actually fly on a 290 kt / M0.78 climb', 't')}`);
  };

  // ---------------------------------------------------------------- 4.1 wind triangle
  F.windTriangle = () => svg(640, 300, 'The wind triangle', id => {
    const O = [100, 240], s = 3.4;
    const tas = 120, hd = 80.8, ws = 25, wfrom = 40;
    const A = [O[0] + tas * s * Math.sin(hd * Math.PI / 180), O[1] - tas * s * Math.cos(hd * Math.PI / 180)];
    const to = wfrom + 180;
    const G = [A[0] + ws * s * Math.sin(to * Math.PI / 180), A[1] - ws * s * Math.cos(to * Math.PI / 180)];
    return `
      ${arrow(id, 40, 120, 40, 50, 'line')}${text(40, 42, 'N', 'tb', 'middle')}
      ${arrow(id, O[0], O[1], f(A[0]), f(A[1]), 'sel')}${text(290, 184, 'Heading 081° · TAS 120 kt', 't-sel', 'middle', 'transform="rotate(-9 290 184)"')}
      ${arrow(id, f(A[0]), f(A[1]), f(G[0]), f(G[1]), 'warn')}${text(f(A[0] + 14), f((A[1] + G[1]) / 2), 'Wind 040° / 25 kt', 't-warn')}
      ${arrow(id, O[0], O[1], f(G[0]), f(G[1]), 'acc')}${text(290, 262, 'Track 090° · GS 102 kt', 't-acc', 'middle')}
      <path d="${arcPath(O[0], O[1], 120, -9.2, 0)}" class="s-line nf"/>${text(O[0] + 128, O[1] - 4, 'WCA 9°', 'tb')}
      ${text(20, 24, 'Air vector + wind vector = ground vector', 'tb')}
      ${text(620, 290, 'Crab into the wind by the WCA to hold the track', 't', 'end')}`;
  });

  // ---------------------------------------------------------------- 4.2 crosswind
  F.crosswind = () => svg(640, 300, 'Headwind and crosswind components on a runway', id => {
    const rx = 250, top = 24, bottom = 276;
    const P = [352, 214], Lw = 150, a = 40;
    const dir = [-Math.sin(a * Math.PI / 180), Math.cos(a * Math.PI / 180)];
    const T = [P[0] - Lw * dir[0], P[1] - Lw * dir[1]];
    return `
      <rect x="${rx - 26}" y="${top}" width="52" height="${bottom - top}" class="f-soft s-line"/>
      ${range(0, 8, 1).map(i => line(rx, bottom - 24 - i * 28, rx, bottom - 38 - i * 28, 's-line')).join('')}
      ${text(rx, bottom + 18, 'RWY 26 · 263°', 'tb', 'middle')}
      ${arrow(id, rx, 250, rx, 150, 'line')}${text(rx - 34, 204, 'landing', 't', 'end')}
      ${arrow(id, f(T[0]), f(T[1]), P[0], P[1], 'warn')}${text(f(T[0] + 10), f(T[1] - 4), 'Wind 303° / 20 kt', 't-warn')}
      ${arrow(id, f(T[0]), f(T[1]), f(T[0]), P[1], 'acc')}${text(f(T[0] + 10), f((T[1] + P[1]) / 2 + 20), 'Headwind = V cos α', 't-acc')}
      ${arrow(id, f(T[0]), P[1], P[0], P[1], 'sel')}${text(f((T[0] + P[0]) / 2), P[1] + 20, 'Crosswind = V sin α', 't-sel', 'middle')}
      <path d="${arcPath(T[0], T[1], 44, 90, 90 + a)}" class="s-line nf"/>${text(f(T[0] - 12), f(T[1] + 58), 'α', 'tb', 'end')}
      <g transform="translate(96 70)">${text(0, 0, 'Clock code', 'tb', 'middle')}
        ${[['15°', '¼'], ['30°', '½'], ['45°', '¾'], ['60°+', 'all']].map(([ang, k], i) => text(-66, 28 + i * 22, ang, 't tm') + text(66, 28 + i * 22, k + ' of the wind', 't', 'end')).join('')}
        ${text(0, 132, 'minutes past the hour', 't', 'middle')}${text(0, 148, '= fraction of an hour', 't', 'middle')}</g>`;
  });

  // ---------------------------------------------------------------- 4.3 great circle & 1-in-60
  F.greatCircle = () => svg(640, 300, 'Great circle versus rhumb line, and the 1-in-60 rule', id => {
    const W = 380, H = 240, x0 = 20, y0 = 30;
    const lon0 = -80, lon1 = 10, lat0 = 30, lat1 = 70;
    const merc = la => Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360));
    const PX = lo => x0 + (lo - lon0) / (lon1 - lon0) * W;
    const PY = la => y0 + H - (merc(la) - merc(lat0)) / (merc(lat1) - merc(lat0)) * H;
    const a = [40.64, -73.78], b = [51.47, -0.45];
    const toV = (la, lo) => [Math.cos(la * Math.PI / 180) * Math.cos(lo * Math.PI / 180), Math.cos(la * Math.PI / 180) * Math.sin(lo * Math.PI / 180), Math.sin(la * Math.PI / 180)];
    const va = toV(...a), vb = toV(...b);
    const om = Math.acos(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]);
    const gc = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, k1 = Math.sin((1 - t) * om) / Math.sin(om), k2 = Math.sin(t * om) / Math.sin(om);
      const v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
      const la = Math.asin(v[2]) * 180 / Math.PI, lo = Math.atan2(v[1], v[0]) * 180 / Math.PI;
      gc.push((i ? 'L' : 'M') + f(PX(lo)) + ' ' + f(PY(la)));
    }
    let grid = '';
    for (let lo = -80; lo <= 10; lo += 15) grid += line(f(PX(lo)), y0, f(PX(lo)), y0 + H, 's-grid');
    for (let la = 30; la <= 70; la += 10) grid += line(x0, f(PY(la)), x0 + W, f(PY(la)), 's-grid') + text(x0 + W - 4, f(PY(la) - 3), la + '°N', 't', 'end');
    const d = C.greatCircle(a[0], a[1], b[0], b[1]);
    return `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" class="f-sky" rx="6"/>${grid}
      <path d="M${f(PX(a[1]))} ${f(PY(a[0]))} L${f(PX(b[1]))} ${f(PY(b[0]))}" class="s-sel nf" stroke-dasharray="7 5"/>
      <path d="${gc.join(' ')}" class="s-acc nf"/>
      <circle cx="${f(PX(a[1]))}" cy="${f(PY(a[0]))}" r="5" class="f-line"/>${text(f(PX(a[1]) - 4), f(PY(a[0]) + 20), 'New York', 'tb')}
      <circle cx="${f(PX(b[1]))}" cy="${f(PY(b[0]))}" r="5" class="f-line"/>${text(f(PX(b[1])), f(PY(b[0]) + 20), 'London', 'tb', 'end')}
      ${text(x0 + 8, y0 + 18, 'Great circle ' + Math.round(d.distNm) + ' NM (curves north on this chart)', 't-acc')}
      ${text(f(PX(-28)), f(PY(40.2)), 'Rhumb line: one course, longer', 't-sel', 'middle')}
      <g transform="translate(422 60)">${text(80, 0, '1-in-60 rule', 'tb', 'middle')}
        <path d="M0 150 L160 150 L160 122 Z" class="fa-acc s-line"/>${text(80, 170, '60 NM flown', 't', 'middle')}${text(166, 140, '1 NM', 't')}
        <path d="${arcPath(0, 150, 60, -9.5, 0)}" class="s-acc nf"/>${text(66, 144, '1°', 't-acc')}
        ${text(80, 200, 'Off track 1 NM after 60 NM', 't', 'middle')}${text(80, 216, '= 1° of track error', 't', 'middle')}</g>`;
  });

  // ---------------------------------------------------------------- 4.4 holding
  F.holding = () => svg(640, 360, 'Right-hand holding pattern and entry sectors', id => {
    const fx = 300, fy = 190, r = 26, L = 90, R0 = 160;
    const pts = b => brg(fx, fy, b, R0);
    const p0 = pts(0), p110 = pts(110), p290 = pts(290);
    const lab = (b, rr, s, c) => { const [x, y] = brg(fx, fy, b, rr); return text(f(x), f(y), s, c, 'middle'); };
    const ex0 = brg(fx, fy, 318, 150), ex1 = brg(fx, fy, 318, 16);
    return `
      <path d="M${fx} ${fy} L${f(p0[0])} ${f(p0[1])} A${R0} ${R0} 0 0 1 ${f(p110[0])} ${f(p110[1])} Z" class="fa-warn"/>
      <path d="M${fx} ${fy} L${f(p290[0])} ${f(p290[1])} A${R0} ${R0} 0 0 1 ${f(p0[0])} ${f(p0[1])} Z" class="fa-sel"/>
      <path d="M${fx} ${fy} L${f(p110[0])} ${f(p110[1])} A${R0} ${R0} 0 0 1 ${f(p290[0])} ${f(p290[1])} Z" class="fa-live"/>
      ${line(fx, fy, f(p0[0]), f(p0[1]), 's-dash')}${line(f(p110[0]), f(p110[1]), f(p290[0]), f(p290[1]), 's-dash')}
      ${lab(52, 110, 'PARALLEL · 110°', 't-warn')}${lab(338, 102, 'TEARDROP · 70°', 't-sel')}${lab(222, 138, 'DIRECT · 180°', 't-live')}
      <path d="${arcPath(fx, fy, 38, 290 - 90, 360 - 90)}" class="s-thin nf"/>${lab(325, 50, '70°', 't')}
      <path d="M${fx} ${fy + L} V${fy} A${r} ${r} 0 0 1 ${fx + 2 * r} ${fy} V${fy + L} A${r} ${r} 0 0 1 ${fx} ${fy + L}" class="s-acc nf"/>
      ${arrow(id, fx, fy + 62, fx, fy + 38, 'acc')}${arrow(id, fx + 2 * r, fy + 38, fx + 2 * r, fy + 62, 'acc')}
      <circle cx="${fx}" cy="${fy}" r="6" class="f-surface s-line"/><path d="M${fx - 3} ${fy} L${fx} ${fy - 3} L${fx + 3} ${fy} L${fx} ${fy + 3} Z" class="f-line"/>
      ${text(fx - 12, fy + 4, 'FIX', 'tb', 'end')}${text(fx - 10, fy + 74, 'inbound', 't', 'end')}${text(fx + 2 * r + 10, fy + 74, 'outbound · 1 min', 't')}
      ${arrow(id, 30, 52, 30, 18, 'line')}${text(42, 32, 'N · inbound course 360°', 't')}
      ${arrow(id, f(ex0[0]), f(ex0[1]), f(ex1[0]), f(ex1[1]), 'line', 'stroke-dasharray="4 4"')}${text(f(ex0[0] - 6), f(ex0[1] - 6), 'arriving from here: teardrop', 't', 'end')}`;
  });

  // ---------------------------------------------------------------- 4.5 descent profile
  F.descent = () => svg(640, 250, 'Top of descent and a 3° descent path', id => `
    <rect x="20" y="214" width="600" height="22" class="f-ground" rx="4"/>
    ${line(20, 214, 620, 214, 's-line')}
    <path d="M30 50 H230" class="s-sel nf"/>${text(40, 42, 'Cruise FL360', 't-sel')}
    <path d="M230 50 L500 176" class="s-acc nf"/>${text(360, 102, '3° path · 318 ft per NM', 't-acc', 'middle', 'transform="rotate(25 360 102)"')}
    <path d="M500 176 H600" class="s-live nf"/>${text(550, 168, 'slow down', 't-live', 'middle')}
    <circle cx="230" cy="50" r="5" class="f-acc"/>${text(230, 34, 'TOD', 'tb', 'middle')}
    ${dbl(id, 612, 50, 612, 176)}${text(606, 116, 'ΔH', 'tb', 'end')}
    ${dbl(id, 230, 196, 500, 196)}${text(365, 192, 'D = ΔH / 318', 'tb', 'middle')}
    ${dbl(id, 500, 196, 600, 196)}${text(550, 192, '+ decel', 't', 'middle')}
    ${text(30, 244, 'Rules of thumb: D ≈ 3 NM per 1000 ft · VS ≈ 5 × ground speed · add ~1 NM per 10 kt to lose', 't')}`);

  // ---------------------------------------------------------------- 5.1 mass & balance
  F.massBalance = () => svg(640, 300, 'Weights acting at their arms from the datum, and the centre of gravity', id => {
    const x0 = 60, sc = 200, yb = 150;
    const st = [['Front seats', 0.94, 170], ['Empty aircraft', 0.99, 767], ['Fuel', 1.22, 110], ['Rear seats', 1.85, 80], ['Baggage', 2.41, 20]];
    const r = C.massBalance(st.map(([, a, m]) => ({ mass: m, arm: a })));
    const X = a => x0 + a * sc;
    const rows = [0, 1, 2, 0, 1];
    return `
      ${line(x0, 24, x0, 270, 's-line')}${text(x0 + 6, 34, 'Datum', 'tb')}
      <rect x="${x0}" y="${yb - 4}" width="${2.7 * sc}" height="8" class="f-soft s-line"/>
      ${st.map(([n, a, m], i) => {
        const len = 18 + 3.2 * Math.sqrt(m), ly = yb + 34 + rows[i] * 22;
        return arrow(id, f(X(a)), f(yb - 6 - len), f(X(a)), yb - 6, 'sel') +
          line(f(X(a)), yb + 6, f(X(a)), ly - 12, 's-thin') + text(f(X(a)), ly, n + ' ' + m + ' kg', 't', 'middle');
      }).join('')}
      <path d="M${f(X(r.cg))} ${yb + 5} l-10 18 h20 z" class="f-acc"/>
      ${dbl(id, x0, 258, f(X(r.cg)), 258, 'acc')}${text(f(X(r.cg) + 10), 262, 'CG ' + r.cg.toFixed(2) + ' m aft of datum', 't-acc')}
      ${[0, 1, 2].map(i => line(f(X(i)), 274, f(X(i)), 280, 's-thin') + text(f(X(i)), 293, i + ' m', 't tm', 'middle')).join('')}
      ${text(628, 34, 'CG = Σ(mass × arm) ÷ Σ mass', 'tb', 'end')}${text(628, 52, 'arrow length ∝ √mass', 't', 'end')}`;
  });

  // ---------------------------------------------------------------- 5.2 take-off
  F.takeoff = () => svg(640, 320, 'Take-off speeds and distances', id => `
    ${text(24, 28, 'V1 ≤ VR ≤ V2 · V2 ≥ 1.13 V<tspan baseline-shift="sub" font-size="9">S1g</tspan> · balanced field: V1 chosen so the go and stop distances match', 'tb')}
    <rect x="30" y="196" width="520" height="16" class="f-soft s-line"/>${text(290, 208, 'TORA — take-off run available', 't', 'middle')}
    <rect x="550" y="196" width="64" height="16" class="fa-sel s-thin"/>${text(582, 230, 'clearway', 't-sel', 'middle')}
    ${line(30, 186, 30, 222, 's-line')}
    ${line(300, 110, 300, 222, 's-dash')}${text(300, 104, 'V1', 'tl', 'middle')}${text(300, 88, 'decision', 't', 'middle')}
    ${line(370, 110, 370, 222, 's-dash')}${text(370, 104, 'VR', 'tl', 'middle')}${text(370, 88, 'rotate', 't', 'middle')}
    <path d="M30 196 H400 Q470 194 604 150" class="s-acc nf"/>
    ${line(604, 150, 604, 196, 's-line')}${text(596, 176, '35 ft', 't', 'end')}${text(604, 138, 'V2', 'tl', 'middle')}
    <g transform="translate(96 190)"><path d="M-16 -2 H12 Q18 0 12 2 H-16 Z M-3 -1 L2 -9 L6 -9 L4 -1 Z" class="f-line"/></g>
    ${arrow(id, 300, 262, 612, 262, 'live')}${text(456, 254, 'engine fails after V1: continue, 35 ft by the end of TODA', 't-live', 'middle')}
    ${arrow(id, 300, 296, 548, 296, 'bad')}${text(424, 288, 'fails before V1: reject, stop within ASDA', 't-bad', 'middle')}`);

  // ---------------------------------------------------------------- 5.3 landing
  F.landing = () => svg(640, 250, 'Landing distance segments', id => `
    <rect x="110" y="180" width="500" height="16" class="f-soft s-line"/>${text(360, 192, 'LDA — landing distance available', 't', 'middle')}
    <path d="M10 108 L120 150 Q170 174 240 180" class="s-acc nf"/>
    ${line(120, 150, 120, 180, 's-line')}${text(126, 146, '50 ft at Vref', 't-acc')}
    <circle cx="240" cy="180" r="4" class="f-acc"/>${text(240, 170, 'touchdown', 't', 'middle')}
    ${dbl(id, 120, 214, 240, 214, 'sel')}${text(180, 232, 'air distance', 't-sel', 'middle')}
    ${dbl(id, 240, 214, 290, 214, 'warn')}${text(265, 246, 'transition', 't-warn', 'middle')}
    ${dbl(id, 290, 214, 520, 214, 'bad')}${text(405, 232, 'braking  V² / 2a', 't-bad', 'middle')}
    ${line(520, 170, 520, 222, 's-line')}${text(520, 164, 'stop', 'tb', 'middle')}
    ${text(20, 30, 'Actual landing distance (ALD) = air + transition + braking', 'tb')}
    ${text(20, 50, 'In flight: ALD × 1.15 must fit · At dispatch: certified distance ÷ 0.6 (wet × 1.15)', 't')}`);

  // ---------------------------------------------------------------- 5.4 fuel stack
  F.fuel = () => svg(640, 200, 'Components of block fuel', id => {
    const parts = [['Taxi', 200, 'f-muted'], ['Trip', 3130, 'f-acc'], ['Cont.', 183, 'f-warn'], ['Alternate', 1098, 'f-sel'], ['Final reserve', 1100, 'f-bad']];
    const tot = parts.reduce((a, p) => a + p[1], 0);
    let x = 20; const W = 600;
    const bars = parts.map(([n, v, c]) => { const w = v / tot * W; const s = `<rect x="${f(x)}" y="60" width="${f(w)}" height="44" class="${c}"/>` + (w > 52 ? text(f(x + w / 2), 87, n, 'tb', 'middle', 'style="fill:var(--surface)"') : text(f(x + w / 2), 122, n, 't', 'middle')); x += w; return s; }).join('');
    const tx = 20 + 200 / tot * W;
    return `${bars}${dbl(id, f(tx), 142, 620, 142, 'line')}${text(f((tx + 620) / 2), 160, 'take-off fuel', 't', 'middle')}
      ${dbl(id, 20, 180, 620, 180, 'line')}${text(320, 196, 'block fuel (at the gate)', 'tb', 'middle')}
      ${text(20, 36, 'Example: 737-800, 500 NM, 100 NM alternate — kg', 't')}`;
  });

  // ---------------------------------------------------------------- 5.5 flex
  F.flex = () => {
    const fr = frame(640, 300, { l: 54, r: 20, t: 16, b: 38 }, { min: 0, max: 75, ticks: range(0, 75, 15), label: 'Temperature (°C) at sea level' },
      { min: 55, max: 105, ticks: range(60, 100, 10), label: 'Thrust available (% of rated)', fmt: v => v + '%' });
    const thr = t => (t <= 30 ? 100 : 100 * (1 - 0.0063 * (t - 30)));
    const pts = range(0, 75, 1).map(t => [t, thr(t)]);
    const need = 83, tf = 30 + (1 - need / 100) / 0.0063;
    return svg(640, 300, 'Thrust against temperature and the assumed temperature', id => fr.grid +
      `<path d="${fr.path(pts)}" class="s-sel nf"/>
       ${line(fr.X(0), f(fr.Y(need)), fr.X(75), f(fr.Y(need)), 's-dash')}${text(fr.X(1), f(fr.Y(need) - 6), 'thrust this runway and weight actually need', 't')}
       ${line(fr.X(0), f(fr.Y(75)), fr.X(75), f(fr.Y(75)), 's-thin')}${text(fr.X(1), f(fr.Y(75) + 14), '25 % reduction limit', 't')}
       <circle cx="${f(fr.X(15))}" cy="${f(fr.Y(100))}" r="5" class="f-live"/>${text(f(fr.X(15)), f(fr.Y(100) - 10), 'OAT 15 °C: full thrust', 't-live', 'middle')}
       <circle cx="${f(fr.X(tf))}" cy="${f(fr.Y(need))}" r="5" class="f-acc"/>${text(f(fr.X(tf) + 8), f(fr.Y(need) - 8), 'assumed ' + tf.toFixed(0) + ' °C', 't-acc')}
       ${text(f(fr.X(31)), f(fr.Y(101.5)), 'flat-rated to 30 °C', 't-sel')}`);
  };

  root.XFC.figures = F;
})(typeof self !== 'undefined' ? self : this);

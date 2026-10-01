/* XP Flight Computer — host for the X-Plane plugin.
 * Runs inside the plugin's embedded JavaScript engine (QuickJS) after polyfill.js, calc.js, aircraft.js,
 * perf.js, derive.js and calculators.js — the same files the web app uses, so the numbers match.
 * It turns the calculators and the performance pages into plain view models (JSON strings) that the
 * plugin draws with Dear ImGui, and applies the user's edits. No DOM, no network.
 */
(function (root) {
  'use strict';
  const X = root.XFC, C = X.calc, A = X.aircraft, P = X.perf;
  const R = String.raw;
  const VERSION = '1.3.0';
  const isNum = x => typeof x === 'number' && isFinite(x);

  // ================================================================== SETTINGS & UNITS
  const settings = { mass: 'kg', press: 'hPa', rwy: 'm', fontSize: 16 };
  const Q = {
    mass: { kg: [1, 'kg'], lb: [1 / 0.45359237, 'lb'] },
    flow: { kg: [1, 'kg/h'], lb: [1 / 0.45359237, 'lb/h'] },
    press: { hPa: [1, 'hPa'], inHg: [1 / 33.8638866667, 'inHg'] },
    rwy: { m: [1, 'm'], ft: [1 / 0.3048, 'ft'] }
  };
  const qSel = q => (q === 'flow' ? settings.mass : settings[q]);
  const toDisp = (q, v) => v * Q[q][qSel(q)][0];
  const fromDisp = (q, v) => v / Q[q][qSel(q)][0];
  const qUnit = q => Q[q][qSel(q)][1];
  const qDec = q => (q === 'press' ? (settings.press === 'inHg' ? 2 : 0) : 0);

  // ================================================================== FORMATTING (as in the web app)
  const num = (v, d = 0) => (isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
  const hdg = v => { if (!isNum(v)) return '—'; let r = Math.round(C.norm360(v)); if (r === 0) r = 360; return String(r).padStart(3, '0') + '°'; };
  function mins(m) {
    if (!isNum(m) || m < 0) return '—';
    if (m < 60) return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' min';
    let h = Math.floor(m / 60), r = Math.round(m - h * 60);
    if (r === 60) { h++; r = 0; }
    return h + ' h ' + String(r).padStart(2, '0') + ' min';
  }
  const fl = ft => (isNum(ft) ? 'FL' + String(Math.max(0, Math.round(ft / 100))).padStart(3, '0') : '—');
  const qn = (q, v, d) => (isNum(v) ? num(toDisp(q, v), d ?? qDec(q)) : '—');
  function fmtInput(v, step) {
    if (!isNum(v)) return '';
    const d = step === 'any' || step >= 1 ? (Math.abs(v) >= 100 ? 0 : 2) : Math.min(4, Math.max(2, -Math.floor(Math.log10(step))));
    return String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
  }

  // ================================================================== TeX → PLAIN TEXT
  // The working steps are written in TeX for the web app. ImGui cannot typeset, so turn them into
  // readable text: √(2W/(ρ₀ S C_Lmax)) = 130.7 kt.
  const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', varepsilon: 'ε', eta: 'η', theta: 'θ', Theta: 'Θ',
    lambda: 'λ', mu: 'μ', nu: 'ν', pi: 'π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', varphi: 'φ', Phi: 'Φ', psi: 'ψ', omega: 'ω', Omega: 'Ω' };
  const SPACE = '\u0001', FN = '\u0002';           // wide gap (\quad); space around a function name
  const SYM = { times: '×', cdot: '·', approx: '≈', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', pm: '±', to: '→', rightarrow: '→', Rightarrow: '⇒',
    Longrightarrow: '⇒', implies: '⇒', infty: '∞', propto: '∝', sum: 'Σ', circ: '°', degree: '°', ldots: '…', dots: '…', cdots: '⋯', partial: '∂', prime: '′',
    ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', quad: SPACE, qquad: SPACE, '%': '%', '{': '{', '}': '}', '_': '_', '#': '#', '&': '&', '|': '|',
    lbrace: '{', rbrace: '}', lvert: '|', rvert: '|', vert: '|', mid: '|', displaystyle: '', textstyle: '', limits: '' };
  const FUNCS = ['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'ln', 'log', 'exp', 'max', 'min', 'sinh', 'cosh', 'tanh', 'lim'];
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
    a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ', i: 'ᵢ', r: 'ᵣ', u: 'ᵤ', v: 'ᵥ' };
  function texToText(src) {
    const s = String(src == null ? '' : src);
    let i = 0;
    const simple = t => /^[\w.·′°%Ͱ-Ͽ⁰-₟ᵢ-ᵥ]+$/.test(t);
    const wrap = t => (simple(t) ? t : '(' + t + ')');
    const skip = () => { while (i < s.length && s[i] === ' ') i++; };
    const readCmd = () => {
      i++;
      if (i >= s.length) return '';
      if (!/[A-Za-z]/.test(s[i])) return s[i++];
      let n = '';
      while (i < s.length && /[A-Za-z]/.test(s[i])) n += s[i++];
      return n;
    };
    const group = () => { i++; const t = seq('}'); i++; return t; };
    const arg = () => { skip(); if (s[i] === '{') return group(); if (s[i] === '\\') return cmd(readCmd()); return s[i++] || ''; };
    const seq = end => { let o = ''; while (i < s.length && s[i] !== end) o += atom(); return o; };
    const sup = t => { const T = t.replace(/\u0002/g, '').trim(); if (T === '°') return '°'; if (T && [...T].every(c => SUP[c])) return [...T].map(c => SUP[c]).join(''); return '^' + wrap(T); };
    const sub = t => { const T = t.replace(/\u0002/g, '').trim(); if (T && [...T].every(c => SUB[c])) return [...T].map(c => SUB[c]).join(''); return '_' + wrap(T); };
    function frac(a, b) {
      const n = a.trim(), d = b.trim(), key = n + '/' + d;
      const F = { '1/2': '½', '1/4': '¼', '3/4': '¾', '1/3': '⅓', '2/3': '⅔' };
      if (F[key]) return F[key];
      return '\u0003' + wrap(n) + '/' + wrap(d) + '\u0004';     // marked, so sin²(Δφ/2) keeps its brackets
    }
    function cmd(c) {
      if (c === 'frac' || c === 'tfrac' || c === 'dfrac') { const a = arg(), b = arg(); return frac(a, b); }
      if (c === 'sqrt') {
        skip(); let idx = '';
        if (s[i] === '[') { i++; while (i < s.length && s[i] !== ']') idx += s[i++]; i++; }
        return (idx ? sup(idx) : '') + '√' + wrap(arg().trim());
      }
      if (['text', 'mathrm', 'textrm', 'operatorname', 'mathit', 'mathbf', 'boldsymbol', 'textbf', 'mbox', 'overline', 'bar', 'hat', 'vec', 'dot'].includes(c)) return arg();
      if (['left', 'right', 'bigl', 'bigr', 'big', 'Big', 'bigg', 'Bigg'].includes(c)) {
        skip();
        if (s[i] === '\\') { const d = readCmd(); return SYM[d] ?? d; }
        if (s[i] === '.') { i++; return ''; }
        return s[i++] || '';
      }
      if (GREEK[c]) return GREEK[c];
      if (FUNCS.includes(c)) return FN + c + FN;
      if (c in SYM) return SYM[c];
      return c;
    }
    function atom() {
      const ch = s[i];
      if (ch === '{') return group();
      if (ch === '\\') return cmd(readCmd());
      if (ch === '^') { i++; return sup(arg()); }
      if (ch === '_') { i++; return sub(arg()); }
      if (ch === '~') { i++; return ' '; }
      i++;
      return ch;
    }
    let out = '';
    while (i < s.length) out += atom();
    return out.replace(/\u0002/g, ' ').replace(/\s+/g, ' ').replace(/ ?\u0001+ ?/g, '     ').replace(/\( /g, '(').replace(/ \)/g, ')')
      .replace(/\b(sin|cos|tan|arcsin|arccos|arctan|ln|log|exp|max|min|sinh|cosh|tanh|lim) (?=[(\[{⁰¹²³⁴⁵⁶⁷⁸⁹\u0003])/g, '$1')
      .replace(/\b(sin|cos|tan|ln|log|exp|sinh|cosh|tanh)([⁰¹²³⁴⁵⁶⁷⁸⁹]*)\u0003([^\u0003\u0004]*)\u0004/g, '$1$2($3)')
      .replace(/[\u0003\u0004]/g, '').trim();
  }

  // ================================================================== LIVE DATA
  const live = { s: null, ac: null, det: null, sig: null, n: 0 };
  X.app = Object.assign(X.app || {}, { live });          // calculators.js looks for the detected aircraft here
  function setLive(fJson, acJson) {
    let f, ac;
    try { f = JSON.parse(fJson); ac = JSON.parse(acJson); } catch (e) { return; }
    if (!f || !ac) { live.s = null; return; }
    const sig = [ac.icao, ac.desc, ac.tail].join('|');
    if (sig !== live.sig) {
      live.sig = sig;
      live.det = A.detect(ac);
      live.ac = ac;
      if (plan.profile === 'auto') plan.forProfile = null;            // performance re-seeds for the new aircraft
    }
    live.ac = ac;
    try { live.s = X.derive(f, ac, live.det); } catch (e) { live.s = null; }
    live.n++;
    for (const c of calcs) { const st = cstate[c.id]; if (st && st.follow) applyLive(c, st, false); }
  }
  function clearLive() { live.s = null; }
  function status() {
    const s = live.s, d = live.det, ac = live.ac;
    const name = d && d.profile && !d.profile.generic ? d.profile.name : ac ? (A.clean(ac.desc) || A.clean(ac.icao) || 'Aircraft') : '';
    const items = [];
    if (s) {
      if (isNum(s.ias)) items.push(['IAS', num(s.ias) + ' kt']);
      if (isNum(s.gs)) items.push(['GS', num(s.gs) + ' kt']);
      if (isNum(s.altInd)) items.push(['ALT', num(Math.round(s.altInd / 10) * 10) + ' ft']);
      if (isNum(s.windDirM) && isNum(s.windKt)) items.push(['Wind', hdg(s.windDirM) + ' / ' + num(s.windKt) + ' kt']);
      if (isNum(s.oat)) items.push(['OAT', num(s.oat) + ' °C']);
      if (isNum(s.mass) && s.mass > 0) items.push(['Mass', qn('mass', s.mass) + ' ' + qUnit('mass')]);
    }
    return { version: VERSION, live: !!s, aircraft: name, icao: ac ? A.clean(ac.icao) : '', label: d ? d.label : '', airliner: !!(d && d.commercial),
      profile: d && d.profile ? d.profile.id : '', phase: s ? s.phase || '' : '', items };
  }

  // ================================================================== MODELS SHARED BY BOTH TABS
  function fieldModel(i, vals, st) {
    if (i.show && !i.show(vals)) return null;
    const f = { k: i.k, label: i.label, hint: i.hint || '', live: !!i.live, following: false };
    if (i.type === 'select') {
      const opts = typeof i.options === 'function' ? i.options(vals) : i.options;
      f.kind = 'select'; f.options = opts.map(([v, l]) => [String(v), String(l)]); f.value = String(vals[i.k]);
    } else if (i.type === 'text') {
      f.kind = 'text'; f.value = String(vals[i.k] ?? '');
    } else {
      const unit = i.q ? qUnit(i.q) : (typeof i.unit === 'function' ? i.unit(vals) : i.unit) || '';
      const step = typeof i.step === 'function' ? i.step(vals) : (i.step || 'any');
      f.kind = 'num'; f.unit = unit; f.value = fmtInput(i.q ? toDisp(i.q, vals[i.k]) : vals[i.k], step);
    }
    if (st) f.following = !!(st.follow && i.live && live.s && !st.manual[i.k]);
    return f;
  }
  function resultModel(r) {
    let val, unit = r.unit || '';
    if (r.fmt === 'hdg') { val = hdg(r.value); unit = ''; }
    else if (r.fmt === 'min') { val = mins(r.value); unit = ''; }
    else if (r.fmt === 'mach') val = isNum(r.value) ? 'M' + r.value.toFixed(3) : '—';
    else if (r.fmt === 'text') val = String(r.value);
    else if (r.q) { val = num(toDisp(r.q, r.value), r.d ?? qDec(r.q)); unit = qUnit(r.q) + (r.unitSuffix || ''); }
    else val = isNum(r.value) ? (r.signed && r.value > 0 ? '+' : '') + num(r.value, r.d ?? 0) : '—';
    return { label: String(r.label), value: val, unit, note: r.note ? String(r.note) : '', tone: r.tone || '', main: !!r.main };
  }
  const res = (label, value, unit, note, tone, main) => ({ label, value: String(value), unit: unit || '', note: note || '', tone: tone || '', main: !!main });
  const stepsOf = list => (list || []).map(s => ({ t: s.t, text: texToText(s.tex) }));
  function setValue(def, vals, raw) {
    if (def.type === 'select' || def.type === 'text') { vals[def.k] = String(raw); return true; }
    const x = parseFloat(String(raw).replace(',', '.'));
    if (!isNum(x)) return false;
    vals[def.k] = def.q ? fromDisp(def.q, x) : x;
    return true;
  }
  /** Chart data for a set of departure runs (same shape calculators.js returns for the NADP calculator). */
  const thin = (pts, max = 160) => { if (pts.length <= max) return pts; const out = [], step = (pts.length - 1) / (max - 1); for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]); return out; };
  const chartOf = (runs, o = {}) => ({
    refNm: o.refNm || null, refLabel: o.refLabel || '', segments: o.segments || null,
    runs: runs.map(q => ({ label: q.label, tone: q.cls, dash: !!q.dash, groundNm: q.r.groundNm,
      pts: thin(q.r.pts).map(p => [Math.round(p.x * 1000) / 1000, Math.round(p.h), Math.round(p.v)]),
      events: q.r.events.filter(e => ['thrRed', 'acc', 'clean', 'mct', 'flap'].includes(e.key)).map(e => ({ key: e.key, x: Math.round(e.x * 1000) / 1000, h: Math.round(e.h), label: e.label })) }))
  });

  // ================================================================== CALCULATORS
  const calcs = X.calculators, groups = X.calcGroups;
  const cstate = {};
  let dirty = false;
  function stateOf(c) {
    if (!cstate[c.id]) { const v = {}; for (const i of c.inputs) v[i.k] = i.v; cstate[c.id] = { vals: v, follow: false, manual: {} }; }
    return cstate[c.id];
  }
  const findCalc = id => calcs.find(x => x.id === id) || calcs[0];
  function applyLive(c, st, force) {
    if (!live.s) return false;
    let changed = false;
    for (const i of c.inputs) {
      if (!i.live || (st.manual[i.k] && !force)) continue;
      let v; try { v = i.live(live.s, st.vals); } catch (e) { v = undefined; }
      if (!isNum(v)) continue;
      st.vals[i.k] = v; changed = true;
    }
    return changed;
  }
  function calcList() {
    return groups.map(g => ({ group: g, items: calcs.filter(c => c.group === g).map(c => ({ id: c.id, title: c.title, search: (c.title + ' ' + c.desc + ' ' + g).toLowerCase() })) }))
      .filter(g => g.items.length);
  }
  function calcView(id) {
    const c = findCalc(id), st = stateOf(c);
    let out;
    try { out = c.run(Object.assign({}, st.vals), { s: live.s, det: live.det }); } catch (e) { out = { error: 'Could not calculate: ' + e.message }; }
    out = out || {};
    return {
      kind: 'calc', id: c.id, group: c.group, title: c.title, desc: c.desc,
      hasLive: c.inputs.some(i => i.live), follow: st.follow, liveOk: !!live.s,
      sections: [{ title: '', fields: c.inputs.map(i => fieldModel(i, st.vals, st)).filter(Boolean) }],
      error: out.error || '',
      results: out.error ? [] : (out.results || []).filter(r => r.fmt === 'text' || isNum(r.value)).map(resultModel),
      bars: [], tables: [],
      steps: out.error ? [] : stepsOf(out.steps),
      notes: out.error ? [] : (out.notes || []).map(String),
      chart: out.error ? null : out.chart || null
    };
  }
  function calcSet(id, k, raw) {
    const c = findCalc(id), st = stateOf(c), def = c.inputs.find(i => i.k === k);
    if (!def || !setValue(def, st.vals, raw)) return false;
    if (st.follow && def.live && def.type !== 'select' && def.type !== 'text') st.manual[k] = true;
    dirty = true;
    return true;
  }
  function calcFollow(id, on) {
    const c = findCalc(id), st = stateOf(c);
    st.follow = !!on; st.manual = {};
    if (st.follow) applyLive(c, st, true);
    dirty = true;
  }
  function calcFill(id) { const c = findCalc(id), st = stateOf(c); st.manual = {}; applyLive(c, st, true); dirty = true; }
  function calcReset(id) { const c = findCalc(id); delete cstate[c.id]; dirty = true; }

  // ================================================================== PERFORMANCE (ported from app.js)
  const plan = { profile: 'auto' };
  const DEP_DEF = { depProc: 'nadp2', depV2Add: 15, nadp1Thr: 800, nadp2Acc: 800, stdThr: 1500, stdAcc: 1500, eoAcc: 1000 };
  function currentProfile() {
    if (plan.profile && plan.profile !== 'auto' && A.byId[plan.profile]) return A.byId[plan.profile];
    if (live.det && live.det.profile) return live.det.profile;
    return A.byId.B738;
  }
  const defaultCruise = p => Math.min(p.ceilingFt - 2000, p.engine === 'turboprop' ? 24000 : p.cls === 'widebody' ? 37000 : p.cls === 'regional' ? 35000 : 36000);
  function resetPlanFor(p) {
    const cap = p.cls === 'widebody' ? 330 : p.cls === 'regional' || p.cls === 'turboprop' ? 76 : 180;
    const paxFit = Math.round(Math.max(0, p.mzfw - p.oew - 1500) / 99 * 0.8);
    const toF = (p.takeoffFlaps.find(f => f.def) || p.takeoffFlaps[0]).id;
    const ldF = (p.landingFlaps.find(f => f.def) || p.landingFlaps[0]).id;
    const ab = p.autobrake || [];
    Object.assign(plan, {
      oew: live.ac && live.ac.oew > 0 && live.det && live.det.profile === p ? live.ac.oew : p.oew,
      crewKg: p.cls === 'widebody' ? 1200 : p.cls === 'narrowbody' ? 500 : 300,
      pax: Math.min(cap, paxFit), paxKg: 84, bagKg: 15, cargoKg: p.cls === 'widebody' ? 8000 : p.cls === 'narrowbody' ? 1200 : 300,
      tripNm: p.cls === 'widebody' ? 2500 : p.engine === 'turboprop' ? 250 : p.cls === 'regional' ? 400 : 600,
      cruiseFt: defaultCruise(p), windKt: 0, isaDev: 0, mach: p.cruiseMach || null, ffCruise: p.ffCruise, ffHold: p.ffHold,
      altNm: p.cls === 'widebody' ? 200 : 110, contPct: 5, finalResMin: 30, extraKg: 0, taxiKg: p.taxiKg,
      toMassMode: 'plan', toMass: Math.round(p.mtow * 0.9), depElev: 131, depQnh: 1013, depOat: 15, depWindDir: 260, depWindKt: 8,
      rwyHdg: 263, toraM: 3000, slope: 0, depSurface: 'dry', toFlap: toF,
      ldMassMode: 'plan', ldMass: Math.round(p.mlw * 0.9), arrElev: 131, arrQnh: 1013, arrOat: 12, arrWindDir: 260, arrWindKt: 10, arrGust: 0,
      arrRwyHdg: 263, ldaM: 2800, arrSlope: 0, arrSurface: 'dry', ldgFlap: ldF, ab: ab.length ? ab[Math.min(1, ab.length - 1)].id : null, reverse: 'yes',
      climbCas: p.engine === 'turboprop' ? 210 : 290, climbMach: p.cruiseMach || 0.5, desFrom: defaultCruise(p), desTo: 3000, desGs: p.engine === 'turboprop' ? 260 : 360, decelNm: 10,
      forProfile: p.id
    }, DEP_DEF);
    dirty = true;
  }
  function perfCalc(p) {
    const fp = P.fuelPlan(p, { distNm: plan.tripNm, cruiseFt: plan.cruiseFt, windKt: plan.windKt, mach: p.cruiseMach ? plan.mach : undefined,
      isaDev: plan.isaDev, ffCruise: plan.ffCruise, ffHold: plan.ffHold, altNm: plan.altNm, contPct: plan.contPct, finalResMin: plan.finalResMin,
      extraKg: plan.extraKg, taxiKg: plan.taxiKg });
    const ls = P.loadsheet(p, { oew: plan.oew, crewKg: plan.crewKg, pax: plan.pax, paxKg: plan.paxKg, bagKg: plan.bagKg, cargoKg: plan.cargoKg,
      takeoffFuel: fp.takeoffFuel, tripKg: fp.trip.fuel, taxiKg: fp.taxi });
    const s = live.s;
    const toMass = plan.toMassMode === 'sim' && s && s.mass > 0 ? s.mass : plan.toMassMode === 'manual' ? plan.toMass : ls.tow;
    const ldMass = plan.ldMassMode === 'sim' && s && s.mass > 0 ? s.mass : plan.ldMassMode === 'manual' ? plan.ldMass : ls.lw;
    return { fp, ls, toMass, ldMass };
  }
  const flapName = p => (p.policy === 'airbus' ? 'CONF ' : 'Flaps ');
  const massSource = pre => [
    { k: pre + 'MassMode', label: pre === 'to' ? 'Take-off mass from' : 'Landing mass from', type: 'select', options: [['plan', 'Load sheet & fuel plan'], ['sim', 'X-Plane gross weight now'], ['manual', 'Enter it']] },
    { k: pre + 'Mass', label: pre === 'to' ? 'Take-off mass' : 'Landing mass', q: 'mass', show: () => plan[pre + 'MassMode'] === 'manual' }
  ];
  const surfaceOpts = [['dry', 'Dry'], ['wet', 'Wet'], ['contaminated', 'Contaminated']];
  const TABS = {
    load: {
      title: 'Load sheet',
      sections: () => [{ title: 'Payload', fields: [
        { k: 'oew', label: 'Operating empty weight', q: 'mass' }, { k: 'crewKg', label: 'Crew, catering & extras', q: 'mass' },
        { k: 'pax', label: 'Passengers', unit: 'pax', step: 1 }, { k: 'paxKg', label: 'Mass per passenger', q: 'mass', hint: 'EASA standard adult 84 kg incl. hand baggage' },
        { k: 'bagKg', label: 'Checked bag per passenger', q: 'mass' }, { k: 'cargoKg', label: 'Cargo & mail', q: 'mass' }] }]
    },
    fuel: {
      title: 'Fuel plan',
      sections: p => [{ title: 'Route & policy', fields: [
        { k: 'tripNm', label: 'Trip distance (air route)', unit: 'NM' }, { k: 'cruiseFt', label: 'Cruise altitude', unit: 'ft', step: 1000 },
        { k: 'mach', label: 'Cruise Mach', unit: 'M', step: 0.01, show: () => !!p.cruiseMach }, { k: 'windKt', label: 'Average wind component (+ tail)', unit: 'kt' },
        { k: 'isaDev', label: 'Cruise ISA deviation', unit: '°C' }, { k: 'ffCruise', label: 'Average cruise fuel flow', q: 'flow' },
        { k: 'ffHold', label: 'Holding fuel flow', q: 'flow' }, { k: 'taxiKg', label: 'Taxi fuel', q: 'mass' },
        { k: 'contPct', label: 'Contingency', unit: '% of trip' }, { k: 'altNm', label: 'Distance to alternate (0 = none)', unit: 'NM' },
        { k: 'finalResMin', label: 'Final reserve', unit: 'min' }, { k: 'extraKg', label: 'Extra / discretionary fuel', q: 'mass' }] }]
    },
    takeoff: {
      title: 'Take-off', sim: 'dep',
      sections: p => [{ title: 'Conditions', fields: massSource('to').concat([
        { k: 'toFlap', label: 'Take-off flaps', type: 'select', options: p.takeoffFlaps.map(f => [f.id, flapName(p) + f.id]) },
        { k: 'depSurface', label: 'Runway condition', type: 'select', options: surfaceOpts },
        { k: 'toraM', label: 'Take-off run available', q: 'rwy' }, { k: 'rwyHdg', label: 'Runway heading', unit: '°M' },
        { k: 'depElev', label: 'Airport elevation', unit: 'ft' }, { k: 'slope', label: 'Slope (+ uphill)', unit: '%', step: 0.1 },
        { k: 'depOat', label: 'Outside air temperature', unit: '°C' }, { k: 'depQnh', label: 'QNH', q: 'press' },
        { k: 'depWindDir', label: 'Wind from', unit: '°M' }, { k: 'depWindKt', label: 'Wind speed', unit: 'kt' }]) }]
    },
    after: {
      title: 'After take-off', sim: 'dep',
      sections: () => [{ title: 'Departure procedure (uses the take-off tab’s conditions)', fields: [
        { k: 'depProc', label: 'Procedure', type: 'select', options: [['nadp1', 'NADP 1 — close-in'], ['nadp2', 'NADP 2 — distant'], ['custom', 'Airline standard'], ['eo', 'Engine failure at V1']] },
        { k: 'depV2Add', label: 'Initial climb speed V2 +', unit: 'kt', step: 1, show: () => plan.depProc !== 'eo' },
        { k: 'nadp1Thr', label: 'Thrust reduction height', unit: 'ft AAL', step: 100, show: () => plan.depProc === 'nadp1' },
        { k: 'nadp2Acc', label: 'Acceleration height', unit: 'ft AAL', step: 100, show: () => plan.depProc === 'nadp2' },
        { k: 'stdThr', label: 'Thrust reduction height', unit: 'ft AAL', step: 100, show: () => plan.depProc === 'custom' },
        { k: 'stdAcc', label: 'Acceleration height', unit: 'ft AAL', step: 100, show: () => plan.depProc === 'custom' },
        { k: 'eoAcc', label: 'Engine-out acceleration height', unit: 'ft AAL', step: 100 }] }]
    },
    landing: {
      title: 'Landing', sim: 'arr',
      sections: p => [{ title: 'Conditions', fields: massSource('ld').concat([
        { k: 'ldgFlap', label: 'Landing flaps', type: 'select', options: p.landingFlaps.map(f => [f.id, flapName(p) + f.id]) },
        { k: 'ab', label: p.autobrake === A.AB.manual ? 'Braking' : 'Autobrake', type: 'select', options: (p.autobrake || []).map(a => [a.id, a.id + ' (' + a.d.toFixed(1) + ' m/s²)']) },
        { k: 'arrSurface', label: 'Runway condition', type: 'select', options: surfaceOpts },
        { k: 'reverse', label: 'Reverse thrust', type: 'select', options: [['yes', 'Used'], ['no', 'Not used']] },
        { k: 'ldaM', label: 'Landing distance available', q: 'rwy' }, { k: 'arrRwyHdg', label: 'Runway heading', unit: '°M' },
        { k: 'arrElev', label: 'Airport elevation', unit: 'ft' }, { k: 'arrSlope', label: 'Slope (+ uphill)', unit: '%', step: 0.1 },
        { k: 'arrOat', label: 'Outside air temperature', unit: '°C' }, { k: 'arrQnh', label: 'QNH', q: 'press' },
        { k: 'arrWindDir', label: 'Wind from', unit: '°M' }, { k: 'arrWindKt', label: 'Wind speed', unit: 'kt' }, { k: 'arrGust', label: 'Gusting to (0 = none)', unit: 'kt' }]) }]
    },
    cruise: {
      title: 'Climb, cruise & descent', sim: 'cruise',
      sections: () => [{ title: 'Profile', fields: [
        { k: 'climbCas', label: 'Climb / descent CAS', unit: 'kt' }, { k: 'climbMach', label: 'Cruise Mach', unit: 'M', step: 0.01 },
        { k: 'desFrom', label: 'Descend from', unit: 'ft', step: 1000 }, { k: 'desTo', label: 'To altitude', unit: 'ft', step: 500 },
        { k: 'desGs', label: 'Average descent GS', unit: 'kt' }, { k: 'decelNm', label: 'Slow-down allowance', unit: 'NM' }] }]
    }
  };
  const SIM_HINT = { dep: 'Fills OAT, QNH and wind — and elevation and runway heading when on the ground.', arr: 'Fills OAT, QNH and wind, and the FMS landing elevation if set.', cruise: 'Fills the altitude and ground speed.' };

  function perfBody(tab, p) {
    const out = { results: [], bars: [], tables: [], steps: [], notes: [], chart: null, badge: null };
    const { fp, ls, toMass, ldMass } = perfCalc(p);
    const mass = (label, v) => res(label, qn('mass', v), qUnit('mass'));
    if (tab === 'load') {
      const t = { title: 'Load sheet', cols: ['Item', 'Mass'], align: ['l', 'r'], rows: [] };
      const row = (k, v, total) => t.rows.push({ cells: [k, qn('mass', v) + ' ' + qUnit('mass')], strong: !!total });
      row('Operating empty weight', plan.oew); row('Crew & extras', plan.crewKg); row('Dry operating weight', ls.dow, true);
      row(plan.pax + ' passengers', ls.paxMass); row('Checked bags', ls.bagMass); row('Cargo', plan.cargoKg); row('Zero-fuel weight', ls.zfw, true);
      row('Take-off fuel (block − taxi)', fp.takeoffFuel); row('Take-off weight', ls.tow, true); row('Trip fuel', fp.trip.fuel); row('Landing weight', ls.lw, true);
      out.tables.push(t);
      const lim = (label, v, max) => out.bars.push({ label, used: v, avail: max, text: qn('mass', v) + ' of ' + qn('mass', max) + ' ' + qUnit('mass'), tone: v <= max ? (v / max > 0.97 ? 'warn' : 'ok') : 'bad' });
      lim('Zero-fuel weight', ls.zfw, p.mzfw); lim('Take-off weight', ls.tow, p.mtow); lim('Landing weight', ls.lw, p.mlw);
      out.results.push(res(ls.underload >= 0 ? 'Underload' : 'Over the limit by', qn('mass', Math.abs(ls.underload)), qUnit('mass'), 'limited by ' + ls.limitedBy, ls.underload >= 0 ? 'ok' : 'bad', true));
      out.results.push(mass('Payload', ls.payload));
      out.results.push(res('For X-Plane’s Weight & Fuel', 'payload ' + qn('mass', ls.zfw - plan.oew) + ' ' + qUnit('mass'), '', 'fuel ' + qn('mass', fp.block) + ' ' + qUnit('mass') + ' at the gate'));
      out.badge = ls.underload >= 0 ? { text: 'within limits', tone: 'ok' } : { text: 'overweight', tone: 'bad' };
      if (live.s) out.notes.push('X-Plane now: payload ' + qn('mass', live.s.payload) + ', fuel ' + qn('mass', live.s.fuel) + ', total ' + qn('mass', live.s.mass) + ' ' + qUnit('mass') + '.');
      out.notes.push('Fuel comes from the fuel plan tab.');
    } else if (tab === 'fuel') {
      const t = fp.trip;
      const tb = { title: 'Fuel plan', cols: ['Component', 'Time', 'Fuel'], align: ['l', 'r', 'r'], rows: [] };
      const row = (a, b, c, strong) => tb.rows.push({ cells: [a, b, qn('mass', c) + ' ' + qUnit('mass')], strong: !!strong });
      row('Taxi', '', fp.taxi);
      row('Trip — climb ' + num(t.climb.dist) + ' NM', mins(t.climb.time), t.climb.fuel);
      row('Trip — cruise ' + num(t.cruise.dist) + ' NM at ' + fl(t.altFt), mins(t.cruise.time), t.cruise.fuel);
      row('Trip — descent ' + num(t.descent.dist) + ' NM', mins(t.descent.time), t.descent.fuel);
      row('Trip — approach & landing', mins(t.approach.time), t.approach.fuel);
      row('Trip fuel', mins(t.time), t.fuel, true);
      row('Contingency', '', fp.contingency);
      row('Alternate' + (fp.alternate ? ' (' + num(plan.altNm) + ' NM at ' + fl(fp.alternate.altFt) + ', incl. go-around)' : ''), fp.alternate ? mins(fp.alternate.time) : '', fp.alternate ? fp.alternate.fuel : 0);
      row('Final reserve (' + num(plan.finalResMin) + ' min)', '', fp.finalReserve);
      row('Extra', '', fp.extra);
      row('Block fuel', '', fp.block, true);
      out.tables.push(tb);
      out.results.push(res('Block fuel', qn('mass', fp.block), qUnit('mass'), num(C.units.lToUsg(fp.block / 0.8)) + ' US gal · ' + num(fp.block / 0.8) + ' L of jet fuel', '', true));
      out.results.push(res('Cruise TAS / GS', num(t.tas) + ' / ' + num(t.gs), 'kt'));
      out.results.push(mass('Expected landing fuel', fp.landingFuel));
      if (t.reduced) out.notes.push('Trip too short for ' + fl(plan.cruiseFt) + ' — planned at ' + fl(t.altFt) + ' instead.');
      out.notes.push('ICAO Annex 6 / EASA structure: taxi + trip + contingency (5 % of trip, at least 5 min holding) + alternate + final reserve (30 min holding at 1500 ft) + extra.');
      out.badge = fp.overCapacity ? { text: 'exceeds tank capacity', tone: 'bad' } : { text: 'fits the tanks', tone: 'ok' };
    } else if (tab === 'takeoff' || tab === 'after') {
      const wc = C.windComponents(plan.depWindDir, plan.depWindKt, plan.rwyHdg);
      const o = { mass: toMass, flap: plan.toFlap, elevFt: plan.depElev, qnh: plan.depQnh, oatC: plan.depOat, headwind: wc.head, slopePct: plan.slope, surface: plan.depSurface, toraM: plan.toraM };
      const fx = P.flexTemp(p, o);
      const useFlex = fx.flex != null;
      const d = useFlex ? fx.flexDist : fx.toga;
      const sp = d.speeds;
      if (tab === 'takeoff') {
        const fits = fx.toga.tofl <= plan.toraM, over = toMass > p.mtow;
        out.badge = over ? { text: 'above MTOW', tone: 'bad' } : fits ? { text: 'runway OK', tone: 'ok' } : { text: 'runway too short', tone: 'bad' };
        out.title = 'Take-off data · ' + flapName(p) + sp.flap;
        out.results.push(res('V1', num(sp.v1), 'kt', '', '', true), res('VR', num(sp.vr), 'kt', '', '', true), res('V2', num(sp.v2), 'kt', '', '', true));
        out.results.push(res(useFlex ? (p.policy === 'airbus' ? 'FLEX temperature' : 'Assumed temperature') : 'Thrust', useFlex ? num(fx.flex) : 'TOGA', useFlex ? '°C' : '',
          useFlex ? '−' + num(fx.reduction * 100) + ' % thrust · limited by ' + fx.limitedBy : (fx.limitedBy || ''), useFlex ? '' : 'warn'));
        out.results.push(res('Take-off mass', qn('mass', toMass), qUnit('mass'), num(toMass / p.mtow * 100) + ' % of MTOW', over ? 'bad' : ''));
        out.results.push(res((wc.head >= 0 ? 'Headwind' : 'Tailwind') + ' / crosswind', num(Math.abs(wc.head)) + ' / ' + num(Math.abs(wc.cross)), 'kt', 'crosswind from the ' + wc.side));
        out.results.push(res('Pressure / density altitude', num(d.air.pa) + ' / ' + num(C.densityAltitude(d.air.pa, plan.depOat).ft), 'ft'));
        out.bars.push({ label: 'Field length needed (TOGA)', used: fx.toga.tofl, avail: plan.toraM, text: qn('rwy', fx.toga.tofl) + ' of ' + qn('rwy', plan.toraM) + ' ' + qUnit('rwy'), tone: fits ? 'ok' : 'bad' });
        if (useFlex) out.bars.push({ label: 'Field length needed at ' + num(fx.flex) + ' °C', used: fx.flexDist.tofl, avail: plan.toraM, text: qn('rwy', fx.flexDist.tofl) + ' ' + qUnit('rwy'), tone: 'ok' });
        if (sp.vmcgLimited) out.notes.push('V1 raised to VMCG (minimum control speed on the ground).');
        out.notes.push('Estimate for simulation. Real V-speeds also depend on VMCA, tyre and brake limits and obstacle clearance.');
        out.steps = stepsOf([
          { t: '1-g stall speed in take-off configuration (lift equation, sea-level density, CAS ≈ EAS)', tex: R`V_{S1g} = \sqrt{\frac{2W}{\rho_0 S C_{L\max}}} = \sqrt{\frac{2 \times ${Math.round(toMass)} \times 9.807}{1.225 \times ${p.wingArea} \times ${sp.cl}}} = ${sp.vs1g.toFixed(1)}\ \text{kt}` },
          { t: 'Take-off safety speed: at least 1.13 × the 1-g stall speed (CS/FAR 25.107)', tex: R`V_2 = 1.13\,V_{S1g} = ${sp.v2.toFixed(1)}\ \text{kt} \qquad V_R = V_2 - ${p.vr} \qquad V_1 = V_R - ${plan.depSurface === 'dry' ? p.v1Dry : p.v1Wet}` },
          { t: 'Field length scales with weight², thin air, lower thrust and less flap', tex: R`\text{TOFL} = \text{TOFL}_{ref}\left(\frac{W}{W_{MTOW}}\right)^{2}\frac{1}{\sigma}\,\frac{T_{ref}}{T}\,\frac{C_{L,ref}}{C_L}\,f_{wind}\,f_{slope}\,f_{surface}` },
          { t: 'With your numbers', tex: R`${Math.round(p.toflRef)} \times ${fx.toga.factors.mass.toFixed(3)} \times ${fx.toga.factors.density.toFixed(3)} \times ${fx.toga.factors.thrust.toFixed(3)} \times ${fx.toga.factors.flap.toFixed(3)} \times ${fx.toga.factors.wind.toFixed(3)} \times ${fx.toga.factors.slope.toFixed(3)} \times ${fx.toga.factors.surface.toFixed(2)} = ${fx.toga.tofl.toFixed(0)}\ \text{m}` },
          { t: 'Assumed temperature: pretend it is hotter until the runway is just long enough (max 25 % reduction)', tex: R`T_{flex} = ${useFlex ? fx.flex + R`^\circ\text{C}` : R`\text{none}`}` }
        ]);
      } else {
        afterTakeoff(p, out, { mass: toMass, flap: sp.flap, elevFt: plan.depElev, qnh: plan.depQnh, oatC: plan.depOat, headwind: wc.head, thrustPct: useFlex ? (1 - fx.reduction) * 100 : 100, flexC: useFlex ? fx.flex : null });
      }
    } else if (tab === 'landing') {
      const wc = C.windComponents(plan.arrWindDir, plan.arrWindKt, plan.arrRwyHdg, plan.arrGust > plan.arrWindKt ? plan.arrGust : undefined);
      const ab = (p.autobrake || []).find(a => a.id === plan.ab) || (p.autobrake || [])[0];
      const o = { mass: ldMass, flap: plan.ldgFlap, elevFt: plan.arrElev, qnh: plan.arrQnh, oatC: plan.arrOat, headwind: wc.head, windSpeed: plan.arrWindKt,
        gust: plan.arrGust > plan.arrWindKt ? plan.arrGust : 0, slopePct: plan.arrSlope, surface: plan.arrSurface, decel: ab ? ab.d : 2, reverse: plan.reverse === 'yes' };
      const ld = P.landingDistance(p, o), rec = P.recommendAutobrake(p, o, plan.ldaM), sp = ld.speeds;
      const fitsDispatch = ld.ldr <= plan.ldaM, fitsOp = ld.factored <= plan.ldaM, over = ldMass > p.mlw;
      const brakeWord = p.autobrake === A.AB.manual ? 'braking' : 'autobrake';
      out.title = 'Landing data · ' + flapName(p) + sp.flap;
      out.badge = over ? { text: 'above max landing weight', tone: 'bad' } : fitsOp ? { text: 'runway OK', tone: 'ok' } : { text: 'runway too short', tone: 'bad' };
      out.results.push(res(sp.name, num(sp.vref), 'kt', '', '', true), res('Wind additive', '+' + num(sp.add), 'kt', '', '', true), res(p.policy === 'airbus' ? 'VAPP' : 'Vapp', num(sp.vapp), 'kt', '', '', true));
      out.results.push(res('Landing mass', qn('mass', ldMass), qUnit('mass'), num(ldMass / p.mlw * 100) + ' % of max landing weight', over ? 'bad' : ''));
      out.results.push(res((wc.head >= 0 ? 'Headwind' : 'Tailwind') + ' / crosswind', num(Math.abs(wc.head)) + ' / ' + num(Math.abs(wc.cross)), 'kt', isNum(wc.gustCross) ? 'gust crosswind ' + num(Math.abs(wc.gustCross)) + ' kt' : 'crosswind from the ' + wc.side));
      out.results.push(res('Touchdown ground speed', num(ld.gsTdKt), 'kt'));
      out.results.push(res('Suggested ' + brakeWord, rec.pick ? rec.pick.id : 'none fits', '', 'lowest setting with 15 % margin', rec.pick ? 'ok' : 'bad'));
      out.bars.push({ label: 'Actual landing distance × 1.15 (' + (ab ? ab.id : '') + ')', used: ld.factored, avail: plan.ldaM, text: qn('rwy', ld.factored) + ' of ' + qn('rwy', plan.ldaM) + ' ' + qUnit('rwy'), tone: fitsOp ? 'ok' : 'bad' });
      out.bars.push({ label: 'Dispatch required distance (÷ 0.6' + (plan.arrSurface === 'dry' ? '' : ' × 1.15') + ')', used: ld.ldr, avail: plan.ldaM, text: qn('rwy', ld.ldr) + ' ' + qUnit('rwy'), tone: fitsDispatch ? 'ok' : 'warn' });
      out.tables.push({ title: p.autobrake === A.AB.manual ? 'Braking' : 'Autobrake', cols: [p.autobrake === A.AB.manual ? 'Braking' : 'Autobrake', 'Decel m/s²', 'Distance', '× 1.15', 'Fits'], align: ['l', 'r', 'r', 'r', 'c'],
        rows: rec.rows.map(r => ({ cells: [r.id + (r.frictionLimited ? ' (friction-limited)' : ''), r.achieved.toFixed(2), qn('rwy', r.ald) + ' ' + qUnit('rwy'), qn('rwy', r.factored) + ' ' + qUnit('rwy'), r.fits ? '✓' : '✗'], pick: !!(rec.pick && r.id === rec.pick.id) })) });
      out.notes.push(sp.rule, 'Estimate for simulation. Contaminated runways need the aircraft’s own data.');
      out.steps = stepsOf([
        { t: 'Reference speed: 1.23 × the 1-g stall speed in landing configuration', tex: R`V_{S1g} = \sqrt{\frac{2 \times ${Math.round(ldMass)} \times 9.807}{1.225 \times ${p.wingArea} \times ${sp.cl}}} = ${sp.vs1g.toFixed(1)}\ \text{kt} \;\Rightarrow\; ${sp.name === 'VLS' ? 'V_{LS}' : 'V_{REF}'} = 1.23\,V_{S1g} = ${sp.vref.toFixed(1)}\ \text{kt}` },
        { t: 'Distance = air segment from 50 ft + transition + braking', tex: R`\text{ALD} = ${ld.airDist.toFixed(0)} + ${ld.trans.toFixed(0)} + \frac{V_{td}^2}{2a} = ${ld.airDist.toFixed(0)} + ${ld.trans.toFixed(0)} + \frac{(${(ld.gsTdKt * 0.5144).toFixed(1)})^2}{2 \times ${ld.aBrake.toFixed(2)}} = ${ld.ald.toFixed(0)}\ \text{m}` },
        { t: 'Autobrake holds a set deceleration; reverse thrust only shortens the roll when braking is at the friction limit', tex: R`a = ${ld.frictionLimited ? R`\mu g + a_{rev}` : R`a_{autobrake}`} = ${ld.aBrake.toFixed(2)}\ \text{m/s}^2` }
      ]);
    } else if (tab === 'cruise') {
      const xo = C.crossoverAltitude(plan.climbCas, plan.climbMach);
      const des = C.descent({ fromFt: plan.desFrom, toFt: plan.desTo, gs: plan.desGs, angleDeg: 3, decelNm: plan.decelNm });
      const tasCr = C.machToTas(plan.climbMach, C.isaTempC(plan.desFrom));
      const hs = C.holdingSpeeds(plan.desTo);
      const m = live.s && live.s.mass > 0 ? live.s.mass : (toMass + ldMass) / 2;
      const man = P.maneuverSpeeds(p, m);
      out.title = 'Speeds & descent';
      out.badge = { text: 'at ' + qn('mass', m) + ' ' + qUnit('mass'), tone: '' };
      out.results.push(res('Crossover altitude ' + num(plan.climbCas) + ' kt / M' + plan.climbMach.toFixed(2), fl(xo.ft), '', num(xo.ft) + ' ft — fly the Mach above it', '', true));
      out.results.push(res('Top of descent', num(des.distNm), 'NM out', '3° path ' + num(des.pathNm) + ' NM + ' + num(plan.decelNm) + ' NM slowing', '', true));
      out.results.push(res('Descent rate for 3°', num(des.vs), 'fpm'));
      out.results.push(res('TAS at M' + plan.climbMach.toFixed(2) + ', ' + fl(plan.desFrom) + ' (ISA)', num(tasCr), 'kt'));
      if (p.greenDot) out.results.push(res('Green dot (rule of thumb)', num(P.greenDot(m, 0)), 'kt', '2 × mass in tonnes + 85'));
      out.results.push(res('Max holding speed at ' + num(plan.desTo) + ' ft', hs.icao, '', 'ICAO · FAA ' + hs.faa));
      if (man) out.tables.push({ title: 'Flap manoeuvre speeds', cols: ['Flaps', 'Speed'], align: ['l', 'r'], rows: man.map(x => ({ cells: [x.flap, num(x.speed) + ' kt'] })) });
      if (man) out.notes.push('Flap manoeuvre speeds: Vref' + p.maneuver.ref + ' + the usual additives.');
      out.steps = stepsOf([
        { t: 'Crossover: the static pressure where the CAS impact pressure equals the Mach impact pressure', tex: R`P_x = \frac{q_c(V_c)}{(1 + 0.2M^2)^{3.5} - 1} = ${(xo.P / 100).toFixed(1)}\ \text{hPa} \Rightarrow ${Math.round(xo.ft)}\ \text{ft}` },
        { t: '3° descent: 318 ft per NM; VS = 5.3 × GS', tex: R`D = \frac{${plan.desFrom - plan.desTo}}{318.4} = ${des.pathNm.toFixed(1)}\ \text{NM} \qquad VS = ${plan.desGs} \times 5.31 = ${Math.round(des.vs)}\ \text{fpm}` }
      ]);
    }
    return out;
  }

  /** After take-off: FMS entries, clean-up speeds and the climb, for the take-off conditions. */
  function afterTakeoff(p, out, base) {
    const proc = plan.depProc, airbus = p.policy === 'airbus';
    const hts = { nadp1: { thrRedFt: plan.nadp1Thr }, nadp2: { accFt: plan.nadp2Acc }, custom: { thrRedFt: plan.stdThr, accFt: plan.stdAcc } };
    const b = Object.assign({}, base, { v2Add: plan.depV2Add });
    const eo = P.departureProfile(p, Object.assign({ proc: 'eo', accFt: plan.eoAcc }, b));
    const r = proc === 'eo' ? eo : P.departureProfile(p, Object.assign({ proc }, b, hts[proc]));
    const msl = h => num(Math.round((plan.depElev + h) / 10) * 10);
    const cu = r.cleanup, sp = r.speeds, g = eo.gradients;
    const fms = proc === 'nadp1' ? [r.thrRedFt, 3000] : proc === 'nadp2' ? [r.accFt, r.accFt] : proc === 'custom' ? [r.thrRedFt, r.accFt] : null;
    const firstTo = cu.steps.length ? cu.steps[0].to : 'UP';
    const eoOk = !eo.cannotClimb && g.second >= eo.minGrad.second;
    const ev = k => r.events.find(e => e.key === k);
    const ref = r.at(3.51), h3 = ev('h3000');
    out.title = 'After take-off · FMS';
    out.badge = { text: { nadp1: 'NADP 1', nadp2: 'NADP 2', custom: 'airline standard', eo: 'engine failure' }[proc], tone: '' };
    if (airbus) {
      if (fms) out.results.push(res('THR RED / ACC', msl(fms[0]) + ' / ' + msl(fms[1]), '', 'MCDU PERF TAKE OFF · ft above sea level (' + num(fms[0]) + ' / ' + num(fms[1]) + ' above the airport)', '', true));
      out.results.push(res('ENG OUT ACC', msl(eo.accFt), '', num(eo.accFt) + ' ft above the airport', '', !fms));
    } else {
      if (fms) out.results.push(res('THR REDUCTION / ACCEL HT', (proc === 'nadp2' && p.maneuver ? 'FLAPS ' + firstTo : num(fms[0]) + ' FT') + ' / ' + num(fms[1]) + ' FT', '', 'FMC TAKEOFF REF page 2 · above the runway (altitudes ' + msl(fms[0]) + ' / ' + msl(fms[1]) + ' ft)', '', true));
      out.results.push(res('EO ACCEL HT', num(eo.accFt) + ' FT', '', 'altitude ' + msl(eo.accFt) + ' ft', '', !fms));
    }
    out.results.push(res(proc === 'eo' ? 'Fly V2' : 'Initial climb (V2 + ' + r.v2Add + ')', num(proc === 'eo' ? sp.v2 : r.vInit), 'kt', proc === 'eo' ? 'or the speed at the failure, up to V2 + 15' : 'hold it until the acceleration height'));
    out.results.push(res('Clean-up speeds', cu.steps.map(s => s.label + ' at ' + num(s.at)).join(' · '), 'kt', cu.cleanName + ' ' + num(cu.vClean) + ' kt'));
    if (proc === 'eo') {
      out.results.push(res('2nd segment, one engine out', eo.cannotClimb ? 'cannot climb' : num(g.second * 100, 1), eo.cannotClimb ? '' : '%', 'minimum ' + num(eo.minGrad.second * 100, 1) + ' % · final ' + (g.final ? num(g.final * 100, 1) + ' %' : '—'), eoOk ? 'ok' : 'bad'));
    } else {
      out.results.push(res('Over 6.5 km from brake release', ref ? num(ref.h) : '—', ref ? 'ft' : '', ref ? num(ref.v) + ' kt · ' + (ref.thr === 'TO' ? 'take-off thrust' : 'climb thrust') : ''));
      out.results.push(res('3000 ft above the airport', h3 ? num(h3.x, 1) : '—', h3 ? 'NM' : '', h3 ? 'from brake release · ' + num(h3.t) + ' s after lift-off' : ''));
      out.results.push(res('Engine out: 2nd segment', eo.cannotClimb ? 'cannot climb' : num(g.second * 100, 1), eo.cannotClimb ? '' : '%', 'minimum ' + num(eo.minGrad.second * 100, 1) + ' %', eoOk ? 'ok' : 'bad'));
    }
    if (eo.cannotClimb) out.notes.push('One engine out, this aircraft cannot climb at this weight, temperature and elevation — the climb (WAT) limit. Reduce the mass or use more thrust.');
    if (base.flexC != null) out.notes.push('Take-off thrust in the profile is the FLEX / assumed-temperature thrust (' + num(base.thrustPct) + ' % of TOGA at ' + num(base.flexC) + ' °C).');
    out.notes.push('A study model: thrust lapses with Mach, altitude and temperature; drag comes from a simple polar for each flap stage. Your aircraft’s FMS and your airline’s procedures are the reference.');
    if (proc === 'eo') {
      if (!eo.cannotClimb) {
        const aeo = P.departureProfile(p, Object.assign({ proc: 'custom', thrRedFt: 1500, accFt: 1500 }, b));
        const evE = k => eo.events.find(e => e.key === k), end = eo.pts[eo.pts.length - 1], gear = (eo.pts.find(q => q.t >= 11) || eo.pts[0]).x;
        const acc = evE('acc'), mct = evE('mct');
        out.chart = chartOf([{ r: eo, cls: 'line', label: 'Engine failure' }, { r: aeo, cls: 'sel', label: 'All engines', dash: true }],
          { segments: [[eo.groundNm, gear, '1st'], [gear, acc ? acc.x : end.x, '2nd'], [acc ? acc.x : end.x, mct ? mct.x : end.x, '3rd'], [mct ? mct.x : end.x, end.x, 'final']] });
      }
    } else {
      out.chart = chartOf([{ r, cls: 'acc', label: { nadp1: 'NADP 1', nadp2: 'NADP 2', custom: 'Airline standard' }[proc] }], { refNm: 3.5, refLabel: '6.5 km from brake release' });
    }
  }

  function perfView(tab) {
    const T = TABS[tab] ? tab : 'takeoff';
    const p = currentProfile();
    if (plan.forProfile !== p.id) resetPlanFor(p);
    for (const [k, d] of Object.entries(DEP_DEF)) if (plan[k] == null) plan[k] = d;
    const def = TABS[T];
    let body;
    try { body = perfBody(T, p); } catch (e) { body = { error: 'Could not calculate: ' + e.message, results: [], bars: [], tables: [], steps: [], notes: [] }; }
    const d = live.det;
    return Object.assign({
      kind: 'perf', tab: T, title: def.title, profile: plan.profile, profileName: p.name, maker: p.maker, cls: p.cls, generic: !!p.generic,
      profiles: [['auto', 'Auto — detected aircraft' + (d && d.profile ? ' (' + d.profile.id + ')' : '')]].concat(A.PROFILES.map(x => [x.id, x.id + ' · ' + x.name + (x.user ? ' (yours)' : '')])),
      detected: !!(d && d.commercial), liveOk: !!live.s,
      sim: def.sim ? { label: 'Use X-Plane now', hint: SIM_HINT[def.sim] } : null,
      sections: def.sections(p).map(sec => ({ title: sec.title, fields: sec.fields.map(i => fieldModel(i, plan, null)).filter(Boolean) })),
      error: ''
    }, body);
  }
  function perfField(tab, k) {
    const p = currentProfile(), def = TABS[tab] || TABS.takeoff;
    for (const sec of def.sections(p)) for (const f of sec.fields) if (f.k === k) return f;
    return null;
  }
  function perfSet(tab, k, raw) {
    const f = perfField(tab, k);
    if (!f || !setValue(f, plan, raw)) return false;
    dirty = true;
    return true;
  }
  function perfProfile(id) {
    plan.profile = id && (id === 'auto' || A.byId[id]) ? id : 'auto';
    resetPlanFor(currentProfile());
  }
  function perfUseSim(tab) {
    const s = live.s; if (!s) return false;
    const r = x => Math.round(x);
    if (tab === 'takeoff' || tab === 'after') {
      if (isNum(s.oat)) plan.depOat = r(s.oat);
      if (s.qnh) plan.depQnh = r(s.qnh);
      if (isNum(s.windDirM)) plan.depWindDir = r(s.windDirM);
      if (isNum(s.windKt)) plan.depWindKt = r(s.windKt);
      if (s.onGround) { if (isNum(s.altMsl)) plan.depElev = r(s.altMsl); if (isNum(s.hdgM)) plan.rwyHdg = r(s.hdgM); }
      if (s.rwyFriction > 0) plan.depSurface = s.rwyFriction <= 3 ? 'wet' : 'contaminated';
    } else if (tab === 'landing') {
      if (isNum(s.oat)) plan.arrOat = r(s.oat);
      if (s.qnh) plan.arrQnh = r(s.qnh);
      if (isNum(s.windDirM)) plan.arrWindDir = r(s.windDirM);
      if (isNum(s.windKt)) plan.arrWindKt = r(s.windKt);
      if (isNum(s.landingAlt) && s.landingAlt > 0) plan.arrElev = r(s.landingAlt);
      if (s.rwyFriction > 0) plan.arrSurface = s.rwyFriction <= 3 ? 'wet' : 'contaminated';
    } else if (tab === 'cruise') {
      if (isNum(s.altInd)) plan.desFrom = Math.round(s.altInd / 100) * 100;
      if (s.gs > 50) plan.desGs = r(s.gs);
    } else return false;
    dirty = true;
    return true;
  }

  // ================================================================== SETTINGS & PERSISTENCE
  function setSetting(k, v) {
    if (k === 'mass' && Q.mass[v]) settings.mass = v;
    else if (k === 'press' && Q.press[v]) settings.press = v;
    else if (k === 'rwy' && Q.rwy[v]) settings.rwy = v;
    else if (k === 'fontSize') { const x = Math.round(Number(v)); if (x >= 12 && x <= 26) settings.fontSize = x; }
    else return false;
    dirty = true;
    return true;
  }
  function save() {
    const calc = {};
    for (const [id, st] of Object.entries(cstate)) calc[id] = { vals: st.vals, follow: st.follow };
    dirty = false;
    return JSON.stringify({ v: 1, settings, calc, plan });
  }
  function load(json) {
    let o;
    try { o = JSON.parse(json); } catch (e) { return false; }
    if (!o || typeof o !== 'object') return false;
    if (o.settings) for (const k of ['mass', 'press', 'rwy', 'fontSize']) if (o.settings[k] != null) setSetting(k, o.settings[k]);
    if (o.calc) for (const [id, saved] of Object.entries(o.calc)) {
      const c = calcs.find(x => x.id === id); if (!c || !saved) continue;
      const st = stateOf(c);
      for (const i of c.inputs) if (saved.vals && saved.vals[i.k] !== undefined && saved.vals[i.k] !== null) st.vals[i.k] = saved.vals[i.k];
      st.follow = !!saved.follow;
    }
    if (o.plan && typeof o.plan === 'object') Object.assign(plan, o.plan);
    dirty = false;
    return true;
  }

  // ================================================================== API FOR THE PLUGIN
  const J = x => JSON.stringify(x);
  root.XFCHost = {
    version: () => VERSION,
    status: () => J(status()),
    settings: () => J(settings),
    setSetting: (k, v) => setSetting(k, v),
    setLive: (f, ac) => { setLive(f, ac); return ''; },
    clearLive: () => { clearLive(); return ''; },
    calcList: () => J(calcList()),
    calcView: id => J(calcView(id)),
    calcSet: (id, k, v) => calcSet(id, k, v),
    calcFollow: (id, on) => { calcFollow(id, on === true || on === 1 || on === '1'); return ''; },
    calcFill: id => { calcFill(id); return ''; },
    calcReset: id => { calcReset(id); return ''; },
    perfView: tab => J(perfView(tab)),
    perfSet: (tab, k, v) => (k === 'profile' ? (perfProfile(v), true) : perfSet(tab, k, v)),
    perfUseSim: tab => perfUseSim(tab),
    isDirty: () => dirty,
    save, load,
    texToText
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* XP Flight Computer — application shell, live data, views */
(function () {
  'use strict';
  const X = window.XFC, C = X.calc, A = X.aircraft, P = X.perf;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = x => typeof x === 'number' && isFinite(x);
  const view = () => $('#view');

  // ------------------------------------------------------------------ storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('xfc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('xfc.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };
  const settings = Object.assign({ theme: 'system', mass: 'kg', press: 'hPa', rwy: 'm', vol: 'L', demo: 'B738' }, store.get('settings', {}));
  const saveSettings = () => store.set('settings', settings);

  // ------------------------------------------------------------------ units
  const Q = {
    mass: { kg: [1, 'kg'], lb: [1 / 0.45359237, 'lb'] },
    flow: { kg: [1, 'kg/h'], lb: [1 / 0.45359237, 'lb/h'] },
    press: { hPa: [1, 'hPa'], inHg: [1 / 33.8638866667, 'inHg'] },
    rwy: { m: [1, 'm'], ft: [1 / 0.3048, 'ft'] },
    vol: { L: [1, 'L'], USG: [1 / 3.785411784, 'US gal'] }
  };
  const qSel = q => (q === 'flow' ? settings.mass : settings[q]);
  const toDisp = (q, v) => v * Q[q][qSel(q)][0];
  const fromDisp = (q, v) => v / Q[q][qSel(q)][0];
  const qUnit = q => Q[q][qSel(q)][1];
  const qDec = q => (q === 'press' ? (settings.press === 'inHg' ? 2 : 0) : 0);

  // ------------------------------------------------------------------ formatting
  function num(v, d = 0) { return isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'; }
  function hdg(v) { if (!isNum(v)) return '—'; let r = Math.round(C.norm360(v)); if (r === 0) r = 360; return String(r).padStart(3, '0') + '°'; }
  function mins(m) {
    if (!isNum(m) || m < 0) return '—';
    if (m < 60) return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' min';
    let h = Math.floor(m / 60), r = Math.round(m - h * 60);
    if (r === 60) { h++; r = 0; }
    return h + ' h ' + String(r).padStart(2, '0') + ' min';
  }
  function latlon(v, pos, neg, w) {
    if (!isNum(v)) return '—';
    const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    return (v >= 0 ? pos : neg) + ' ' + String(d).padStart(w, '0') + '°' + m.toFixed(2).padStart(5, '0') + '′';
  }
  const unitHTML = u => (u ? `<small>${esc(u)}</small>` : '');
  const qv = (q, v, d) => (isNum(v) ? num(toDisp(q, v), d ?? qDec(q)) + unitHTML(qUnit(q)) : '—');
  const fl = ft => (isNum(ft) ? 'FL' + String(Math.max(0, Math.round(ft / 100))).padStart(3, '0') : '—');
  function tex(s, display) {
    if (window.katex) {
      try { return window.katex.renderToString(s, { displayMode: !!display, throwOnError: false, output: 'html' }); } catch (e) { /* fall through */ }
    }
    return `<code>${esc(s)}</code>`;
  }

  // ------------------------------------------------------------------ toast
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 4200);
  }

  // ------------------------------------------------------------------ theme
  function applyTheme() {
    const r = document.documentElement;
    if (settings.theme === 'light' || settings.theme === 'dark') r.setAttribute('data-theme', settings.theme);
    else r.removeAttribute('data-theme');
  }
  function isDark() {
    if (settings.theme === 'dark') return true;
    if (settings.theme === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // ================================================================== LIVE DATA
  const live = { raw: null, s: null, ac: null, det: null, sig: null, src: 'none', bridge: false, cfg: null, hist: [], lastHist: 0, streamOk: false };
  const demo = X.demo;

  function derive(f, ac, det) {
    const s = Object.assign({}, f);
    s.mtow = ac.mtow; s.oew = ac.oew;
    const mv = isNum(f.magVar) ? f.magVar : 0;
    s.trkM = isNum(f.trkT) ? C.norm360(f.trkT - mv) : NaN;
    s.windDirM = isNum(f.windDirT) ? C.norm360(f.windDirT - mv) : NaN;
    if (!isNum(s.pa) && isNum(f.altInd) && isNum(f.baro)) s.pa = C.pressureAltitude(f.altInd, f.baro);
    if (isNum(s.pa) && isNum(f.oat)) {
      s.isaT = C.isaTempC(s.pa); s.isaDev = f.oat - s.isaT;
      const da = C.densityAltitude(s.pa, f.oat); s.da = da.ft; s.sigma = da.sigma;
      const spd = isNum(f.cas) && f.cas > 30 ? f.cas : f.ias;
      if (isNum(spd) && spd > 30) { const t = C.casToTas(spd, s.pa, f.oat); s.tasCalc = t.tas; s.machCalc = t.mach; s.eas = t.eas; }
      if (isNum(f.mach)) s.tatCalc = C.tatFromSat(f.oat, f.mach);
      if (isNum(f.altInd)) s.trueAlt = C.trueHeight(f.altInd, s.isaDev, 0);
    }
    if (isNum(f.hdgT) && isNum(f.trkT) && f.gs > 20) s.drift = C.norm180(f.trkT - f.hdgT);
    if (isNum(f.windDirT) && isNum(f.windKt) && isNum(f.hdgT)) {
      const w = C.windComponents(f.windDirT, f.windKt, f.hdgT); s.hw = w.head; s.xw = w.cross;
    }
    if (isNum(f.vs) && f.gs > 20) s.fpa = C.angleFromVs(f.vs, f.gs);
    if (f.gs > 20) s.vs3 = C.vsForAngle(f.gs, 3);
    if (f.ff > 0 && isNum(f.fuel)) { s.endurMin = f.fuel / f.ff * 60; if (f.gs > 20) s.rangeNm = f.fuel / f.ff * f.gs; }
    s.nz = isNum(f.roll) ? 1 / Math.cos(C.rad(Math.min(80, Math.abs(f.roll)))) : 1;
    const wr = ac.mtow > 0 && f.mass > 0 ? Math.sqrt(f.mass / ac.mtow) : 1;
    const flapsOut = (f.flapDep ?? f.flapReq ?? 0) > 0.05;
    const vRef = flapsOut ? (ac.vso > 0 ? ac.vso : ac.vs) : ac.vs;
    if (vRef > 0) { s.vsEst = vRef * wr; s.vsTurn = s.vsEst * Math.sqrt(s.nz); if (f.ias > 0) s.stallMargin = f.ias / s.vsTurn - 1; }
    if (ac.vne > 0 && isNum(f.ias)) s.toVne = ac.vne - f.ias;
    if (ac.mmo > 0 && isNum(f.mach)) s.toMmo = ac.mmo - f.mach;
    s.flapLabel = A.flapLabel(f.flapDep ?? f.flapReq, det && det.profile, ac.flapDetents);
    if (f.onGround) s.phase = f.gs > 40 ? 'Take-off / landing roll' : f.gs > 3 ? 'Taxi' : 'On ground';
    else if (f.vs > 400) s.phase = 'Climb'; else if (f.vs < -400) s.phase = 'Descent';
    else s.phase = f.altInd > 18000 ? 'Cruise' : 'Level flight';
    s.std = isNum(f.baro) && Math.abs(f.baro - 1013.25) < 0.3;
    return s;
  }

  function onSnapshot(st, src) {
    live.raw = st; live.src = src;
    if (st && st.ac && st.f) {
      const sig = [st.ac.icao, st.ac.desc, st.ac.tail].join('|');
      if (sig !== live.sig) {
        const first = live.sig === null;
        live.sig = sig; live.ac = st.ac; live.det = A.detect(st.ac);
        onAircraftChange(first);
      }
      live.ac = st.ac;
      live.s = derive(st.f, st.ac, live.det);
      const now = Date.now();
      if (now - live.lastHist > 2000) {
        live.lastHist = now;
        live.hist.push({ t: now, alt: live.s.altInd, ias: live.s.ias });
        if (live.hist.length > 300) live.hist.shift();
      }
    } else {
      live.s = null;
    }
    updateHeader();
    if (current && current.tick) current.tick();
  }

  function onAircraftChange(first) {
    const d = live.det, ac = live.ac;
    live.hist = [];
    $('#perfBadge').hidden = !d.commercial;
    const name = (ac.icao || '????') + ' · ' + (ac.desc || 'Unknown aircraft');
    if (live.src !== 'demo' || !first) toast('Aircraft detected: ' + name + ' — ' + d.label + (d.commercial ? '. Performance calculator ready.' : '.'));
    if (plan.profile === 'auto') resetPlanFor(currentProfile());
    if (current && (currentRoute.view === 'live' || currentRoute.view === 'perf')) route();
  }

  function startDemo(quiet) {
    demo.start(settings.demo, st => onSnapshot(st, 'demo'));
    if (!quiet) toast('Demo flight started — simulated data, not X-Plane.');
  }
  function stopDemo() {
    demo.stop();
    live.s = null; live.sig = null; live.raw = null; live.det = null;
    updateHeader();
  }

  function connect() {
    if (!/^https?:$/.test(location.protocol)) { startDemo(true); return; }
    fetch('api/config', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('no bridge'))))
      .then(cfg => {
        live.bridge = true; live.cfg = cfg;
        fetch('api/profiles', { cache: 'no-store' }).then(r => r.json()).then(list => {
          const n = A.addUserProfiles(list);
          if (n) toast('Loaded ' + n + ' aircraft profile' + (n > 1 ? 's' : '') + ' from user_profiles.json');
        }).catch(() => {});
        const es = new EventSource('api/stream');
        es.onopen = () => { live.streamOk = true; updateHeader(); };
        es.onmessage = e => {
          let st; try { st = JSON.parse(e.data); } catch (err) { return; }
          live.streamOk = true;
          if (demo.running()) {
            if (st.xp && st.xp.connected) { demo.stop(); live.sig = null; toast('X-Plane connected — demo stopped.'); }
            else { live.bridgeState = st; return; }
          }
          live.bridgeState = st;
          onSnapshot(st, 'bridge');
        };
        es.onerror = () => { live.streamOk = false; updateHeader(); };
        updateHeader();
      })
      .catch(() => { live.bridge = false; startDemo(true); updateHeader(); });
  }

  // ================================================================== HEADER
  function updateHeader() {
    const pill = $('#conn'), lbl = $('.lbl', pill), sub = $('.sub', pill);
    let cls = 'off', l = 'Offline', t = 'manual input';
    if (live.src === 'demo' && demo.running()) { cls = 'demo'; l = 'Demo'; t = 'simulated flight'; }
    else if (live.bridge) {
      const xp = live.raw && live.raw.xp;
      if (!live.streamOk) { cls = 'off'; l = 'App stopped'; t = 'restart xpfc'; }
      else if (xp && xp.connected) { cls = 'live'; l = 'Live'; t = 'X-Plane ' + (xp.version || '') + ' · ' + xp.via; }
      else { cls = 'off'; l = 'No sim'; t = 'waiting for X-Plane'; }
    }
    pill.className = 'pill ' + cls; lbl.textContent = l; sub.textContent = t;
    const chip = $('#acchip');
    if (live.s && live.ac) {
      chip.hidden = false;
      $('.ac-chip', chip).textContent = live.ac.icao || '????';
      $('.sub', chip).textContent = live.det ? live.det.label : '';
    } else chip.hidden = true;
  }

  // ================================================================== ROUTER
  let current = null, currentRoute = { view: 'live' };
  const routes = { live: renderLive, calc: renderCalc, perf: renderPerf, study: renderStudy, settings: renderSettings };
  function route() {
    const h = (location.hash || '#live').slice(1);
    const [v, sub] = h.split('.');
    const name = routes[v] ? v : 'live';
    currentRoute = { view: name, sub };
    $$('.rail a').forEach(a => { if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    current = routes[name](sub) || null;
  }
  function go(hash) { if (location.hash === '#' + hash) route(); else location.hash = hash; }

  // ================================================================== LIVE VIEW
  const SIL = {
    airliner: '<svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true"><path fill="currentColor" d="M32 4c2 0 3 2 3 5v14l22 12v5l-22-6v14l6 4v4l-9-2-9 2v-4l6-4V34L7 40v-5l22-12V9c0-3 1-5 3-5z"/><rect fill="currentColor" x="16" y="31" width="4" height="7" rx="2"/><rect fill="currentColor" x="44" y="31" width="4" height="7" rx="2"/></svg>',
    ga: '<svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true"><path fill="currentColor" d="M30 6h4l1 4v10h23v6H35v18l9 2v5H20v-5l9-2V26H6v-6h23V10z"/><rect fill="currentColor" x="24" y="4" width="16" height="2.5" rx="1"/></svg>',
    bizjet: '<svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true"><path fill="currentColor" d="M32 5c2 0 3 2 3 6v14l17 10v4l-17-5v13h8v4H23v-4h8V29L14 34v-4l17-10V11c0-4 1-6 1-6z"/><rect fill="currentColor" x="36" y="41" width="3" height="7" rx="1.5"/><rect fill="currentColor" x="25" y="41" width="3" height="7" rx="1.5"/></svg>',
    helicopter: '<svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true"><circle cx="32" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/><path d="M11 24h42M32 3v42" stroke="currentColor" stroke-width="3"/><ellipse cx="32" cy="26" rx="7" ry="10" fill="currentColor"/><path d="M31 35h2v24h-2zM26 57h12v3H26z" fill="currentColor"/></svg>',
    glider: '<svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true"><path fill="currentColor" d="M31 8h2l1 14h28v4H34v22l8 2v4H22v-4l8-2V26H2v-4h28z"/></svg>',
    military: '<svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true"><path fill="currentColor" d="M32 3l4 14 2 12 18 16v5l-20-8-1 8 8 6v3l-11-3-11 3v-3l8-6-1-8-20 8v-5l18-16 2-12z"/></svg>'
  };
  const silFor = cat => SIL[cat] || (cat === 'airliner' ? SIL.airliner : SIL.ga);
  const KIND = { piston: 'piston', turboprop: 'turboprop', jet: 'jet', electric: 'electric', rocket: 'rocket', unknown: 'engine' };

  function waitingHTML() {
    const bridge = live.bridge;
    const xp = live.raw && live.raw.xp;
    return `
      <div class="view-head"><div><div class="eyebrow">Live</div><h1>Waiting for X-Plane</h1>
      <p>${bridge ? 'The app is running. Start X-Plane 12 and load any aircraft — it will be detected automatically.' : 'This page is not connected to the XP Flight Computer app on your PC, so live data is off. Calculators and the study library still work.'}</p></div></div>
      <section class="panel empty">
        <h2>Connect X-Plane 12</h2>
        <ol>
          <li>Run <b>start.bat</b> (or <b>python xpfc.py</b>) on the PC with X-Plane, then open <b>http://127.0.0.1:8765</b>.</li>
          <li>X-Plane <b>12.1.1 or newer</b> connects on its own through the built-in Web API (port 8086).</li>
          <li>Older 12.x, or X-Plane on another PC: in X-Plane open <b>Settings → Network</b> and turn on <b>Accept incoming connections</b> (UDP port 49000).</li>
          <li>Load an aircraft. Airliners open the performance calculator automatically.</li>
        </ol>
        ${xp ? `<dl class="kv"><dt>Web API</dt><dd>${esc(xp.webapi)}</dd><dt>UDP</dt><dd>${esc(xp.udp)}</dd><dt>X-Plane host</dt><dd>${esc(xp.host)}</dd></dl>` : ''}
        <div class="row"><button class="btn primary" id="demoBtn" type="button">Run the demo flight</button><a class="btn" href="#calc">Open the calculators</a><a class="btn ghost" href="#study">Study library</a></div>
      </section>`;
  }

  function renderLive() {
    const el = view();
    if (!live.s) {
      el.innerHTML = waitingHTML();
      const b = $('#demoBtn', el); if (b) b.onclick = () => startDemo(false);
      let wasWaiting = true;
      return { tick() { if (live.s && wasWaiting) { wasWaiting = false; route(); } else if (!live.s) { const k = $('.kv', el); const xp = live.raw && live.raw.xp; if (k && xp) k.innerHTML = `<dt>Web API</dt><dd>${esc(xp.webapi)}</dd><dt>UDP</dt><dd>${esc(xp.udp)}</dd><dt>X-Plane host</dt><dd>${esc(xp.host)}</dd>`; } } };
    }
    const src = live.src === 'demo' ? 'Demo flight — simulated data' : 'Live from X-Plane';
    el.innerHTML = `
      <div class="view-head">
        <div><div class="eyebrow">${esc(src)}</div><h1>Flight deck</h1></div>
        <div class="legend"><span><i class="sw sw-live"></i>read from X-Plane</span><span><i class="sw sw-calc"></i>calculated here</span></div>
      </div>
      <section class="panel ac-card" id="acCard"></section>
      <div class="groups" id="groups"></div>
      <section class="panel trend" id="trend"></section>`;
    renderAcCard();
    const groups = liveGroups();
    $('#groups').innerHTML = groups.map((g, gi) => `
      <section class="group"><h3><span>${esc(g.title)}</span>${g.link ? `<a class="small" href="#${g.link}">study</a>` : ''}</h3>
        ${g.rows.map((r, ri) => `<div class="rd src-${r.src}${r.big ? ' big' : ''}"><span class="k">${esc(r.label)}</span><span class="v" data-g="${gi}" data-r="${ri}">—</span></div>`).join('')}
      </section>`).join('');
    const cells = $$('#groups .v');
    const tick = () => {
      if (!live.s) { route(); return; }
      const s = live.s;
      for (const c of cells) {
        const r = groups[c.dataset.g].rows[c.dataset.r];
        let out = '—', tone = null;
        try { out = r.fmt(s); tone = r.tone ? r.tone(s) : null; } catch (e) { out = '—'; }
        if (c._last !== out) { c.innerHTML = out; c._last = out; }
        c.classList.toggle('warn', tone === 'warn'); c.classList.toggle('bad', tone === 'bad');
      }
      renderTrend();
    };
    tick();
    return { tick };
  }

  function renderAcCard() {
    const ac = live.ac, d = live.det, p = d.profile;
    const kind = KIND[d.kind] || 'engine';
    const chips = [
      `<span class="chip ${d.commercial ? 'accent' : ''}">${esc(d.label)}</span>`,
      ac.engines ? `<span class="chip">${ac.engines} × ${esc(kind)}</span>` : '',
      ac.mtow > 0 ? `<span class="chip plain">MTOW ${esc(num(toDisp('mass', ac.mtow)))} ${esc(qUnit('mass'))}</span>` : '',
      p ? `<span class="chip live">Profile · ${esc(p.name)}</span>` : ''
    ].join('');
    const cta = d.commercial
      ? `<a class="btn primary" href="#perf">Open performance</a><span class="small muted">${p ? 'matched by ' + esc(d.via) : ''}</span>`
      : d.category === 'helicopter' ? `<a class="btn" href="#calc.turn">Turn performance</a><a class="btn ghost" href="#calc.altitudes">Density altitude</a>`
        : `<a class="btn" href="#calc.ga-runway">Runway distances</a><a class="btn ghost" href="#calc.altitudes">Density altitude</a>`;
    $('#acCard').innerHTML = `
      <div class="sil">${silFor(d.category)}</div>
      <div style="min-width:0">
        <div class="code">${esc(ac.icao || '????')}</div>
        <div class="name">${esc(ac.desc || 'Unknown aircraft')}</div>
        <div class="meta">${ac.tail ? 'Tail ' + esc(ac.tail) + ' · ' : ''}${ac.author ? 'by ' + esc(ac.author) : ''}</div>
        <div class="chips">${chips}</div>
      </div>
      <div class="cta">${cta}</div>`;
  }

  function liveGroups() {
    const s0 = u => unitHTML(u);
    const L = 'live', K = 'calc';
    const signed = (v, d = 0) => (isNum(v) ? (v > 0 ? '+' : '') + num(v, d) : '—');
    return [
      { title: 'Airspeed', link: 'study.airspeeds', rows: [
        { label: 'Indicated airspeed', src: L, big: true, fmt: s => num(s.ias) + s0('kt') },
        { label: 'Calibrated airspeed', src: L, fmt: s => num(s.cas ?? s.ias) + s0('kt') },
        { label: 'True airspeed', src: L, fmt: s => num(s.tas) + s0('kt') },
        { label: 'TAS from CAS, PA and OAT', src: K, fmt: s => num(s.tasCalc) + s0('kt') },
        { label: 'Ground speed', src: L, fmt: s => num(s.gs) + s0('kt') },
        { label: 'Mach', src: L, fmt: s => (isNum(s.mach) ? 'M' + s.mach.toFixed(3) : '—') }
      ] },
      { title: 'Altitude', link: 'study.altimetry', rows: [
        { label: 'Altimeter', src: L, big: true, fmt: s => num(s.altInd) + s0('ft') },
        { label: 'Pressure altitude', src: L, fmt: s => num(s.pa) + s0('ft ' + fl(s.pa)) },
        { label: 'Density altitude', src: K, fmt: s => num(s.da) + s0('ft'), tone: s => (s.da - s.pa > 3000 ? 'warn' : null) },
        { label: 'True altitude (temperature-corrected)', src: K, fmt: s => '≈' + num(s.trueAlt) + s0('ft') },
        { label: 'Height above ground', src: L, fmt: s => num(s.agl) + s0('ft') }
      ] },
      { title: 'Vertical', link: 'study.descent', rows: [
        { label: 'Vertical speed', src: L, big: true, fmt: s => signed(Math.round(s.vs / 10) * 10) + s0('fpm') },
        { label: 'Flight-path angle', src: K, fmt: s => signed(s.fpa, 1) + s0('°') },
        { label: 'VS for a 3° path at this GS', src: K, fmt: s => num(s.vs3) + s0('fpm') },
        { label: 'FMS distance to top of descent', src: L, fmt: s => (s.todDist > 0 ? num(s.todDist, 1) + s0('NM') : '—') },
        { label: 'GPS distance to go', src: L, fmt: s => (s.gpsDist > 0 ? num(s.gpsDist, 1) + s0('NM') : '—') }
      ] },
      { title: 'Direction', link: 'study.wind-triangle', rows: [
        { label: 'Heading', src: L, big: true, fmt: s => hdg(s.hdgM) + s0('M') },
        { label: 'Track', src: L, fmt: s => hdg(s.trkM) + s0('M') },
        { label: 'Drift angle', src: K, fmt: s => signed(s.drift, 1) + s0('°') },
        { label: 'Magnetic variation', src: L, fmt: s => (isNum(s.magVar) ? num(Math.abs(s.magVar), 1) + '°' + s0(s.magVar >= 0 ? 'E' : 'W') : '—') },
        { label: 'Latitude', src: L, fmt: s => latlon(s.lat, 'N', 'S', 2) },
        { label: 'Longitude', src: L, fmt: s => latlon(s.lon, 'E', 'W', 3) }
      ] },
      { title: 'Wind & air', link: 'study.crosswind', rows: [
        { label: 'Wind (true)', src: L, big: true, fmt: s => hdg(s.windDirT) + ' / ' + num(s.windKt) + s0('kt') },
        { label: 'Head / tailwind on the nose', src: K, fmt: s => (isNum(s.hw) ? num(Math.abs(s.hw)) + s0(s.hw >= 0 ? 'kt head' : 'kt tail') : '—') },
        { label: 'Crosswind', src: K, fmt: s => (isNum(s.xw) ? num(Math.abs(s.xw)) + s0(s.xw >= 0 ? 'kt from right' : 'kt from left') : '—') },
        { label: 'Outside air temperature', src: L, fmt: s => num(s.oat, 1) + s0('°C') },
        { label: 'ISA deviation', src: K, fmt: s => signed(s.isaDev, 1) + s0('°C') },
        { label: 'Total air temperature', src: L, fmt: s => num(s.tat ?? s.tatCalc, 1) + s0('°C') },
        { label: 'QNH', src: L, fmt: s => qv('press', s.qnh) },
        { label: 'Altimeter setting', src: L, fmt: s => (s.std ? 'STD' : qv('press', s.baro)) }
      ] },
      { title: 'Mass & fuel', link: 'study.fuel', rows: [
        { label: 'Gross weight', src: L, big: true, fmt: s => qv('mass', s.mass) },
        { label: 'Share of maximum take-off mass', src: K, fmt: s => (s.mtow > 0 ? num(s.mass / s.mtow * 100, 1) + s0('%') : '—') },
        { label: 'Fuel on board', src: L, fmt: s => qv('mass', s.fuel) },
        { label: 'Fuel flow (all engines)', src: L, fmt: s => qv('flow', s.ff) },
        { label: 'Endurance at this flow', src: K, fmt: s => mins(s.endurMin) },
        { label: 'Range at this ground speed', src: K, fmt: s => num(s.rangeNm) + s0('NM') },
        { label: 'Payload', src: L, fmt: s => qv('mass', s.payload) }
      ] },
      { title: 'Envelope', link: 'study.stall', rows: [
        { label: 'Stall speed now (weight, flaps, bank)', src: K, big: true, fmt: s => (isNum(s.vsTurn) ? '≈' + num(s.vsTurn) + s0('kt') : '—') },
        { label: 'Margin above stall', src: K, fmt: s => (isNum(s.stallMargin) ? num(s.stallMargin * 100) + s0('%') : '—'), tone: s => (s.stallMargin < 0.15 ? 'bad' : s.stallMargin < 0.3 ? 'warn' : null) },
        { label: 'Load factor', src: K, fmt: s => num(s.nz, 2) + s0('g') },
        { label: 'Below Vmo / Vne', src: K, fmt: s => (isNum(s.toVne) ? num(s.toVne) + s0('kt') : '—'), tone: s => (s.toVne < 5 ? 'bad' : s.toVne < 15 ? 'warn' : null) },
        { label: 'Below Mmo', src: K, fmt: s => (isNum(s.toMmo) ? s.toMmo.toFixed(3) : '—'), tone: s => (s.toMmo < 0.01 ? 'bad' : s.toMmo < 0.02 ? 'warn' : null) },
        { label: 'Angle of attack', src: L, fmt: s => num(s.aoa, 1) + s0('°') }
      ] },
      { title: 'Configuration', rows: [
        { label: 'Phase', src: K, big: true, fmt: s => `<span style="font-size:18px">${esc(s.phase)}</span>` },
        { label: 'Flaps', src: L, fmt: s => esc(s.flapLabel ?? '—') },
        { label: 'Gear handle', src: L, fmt: s => (s.gearDown == null ? '—' : s.gearDown ? 'DOWN' : 'UP') },
        { label: 'Sim', src: L, fmt: s => (s.paused ? 'PAUSED' : 'running') },
        { label: 'Zulu time', src: L, fmt: s => (isNum(s.zulu) ? new Date(s.zulu * 1000).toISOString().slice(11, 19) + s0('Z') : '—') }
      ] }
    ];
  }

  function sparkline(pts, key, color) {
    const w = 600, h = 110, pad = 6;
    const vals = pts.map(p => p[key]).filter(isNum);
    if (vals.length < 2) return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="waiting for data"><text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="var(--faint)" font-size="13">collecting data…</text></svg>`;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const x = t => pad + (t - t0) / Math.max(1, t1 - t0) * (w - 2 * pad);
    const y = v => h - pad - (v - lo) / (hi - lo) * (h - 2 * pad - 16);
    const line = pts.filter(p => isNum(p[key])).map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p[key]).toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    const grid = [0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`).join('');
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${key} trend">${grid}
      <path d="${line} L${x(last.t).toFixed(1)} ${h} L${x(t0).toFixed(1)} ${h} Z" fill="${color}" opacity="0.10"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(last.t).toFixed(1)}" cy="${y(last[key]).toFixed(1)}" r="4" fill="${color}"/></svg>`;
  }
  let trendT = 0;
  function renderTrend() {
    const el = $('#trend'); if (!el) return;
    const now = Date.now(); if (now - trendT < 1900 && el.innerHTML) return; trendT = now;
    const h = live.hist;
    const span = h.length > 1 ? Math.round((h[h.length - 1].t - h[0].t) / 60000) : 0;
    const rng = k => { const v = h.map(p => p[k]).filter(isNum); return v.length ? num(Math.min(...v)) + ' – ' + num(Math.max(...v)) : '—'; };
    el.innerHTML = `<div class="ttl"><h3 style="margin:0;font-size:15px">Last ${span || '<1'} min</h3><span class="small muted">sampled every 2 s</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:10px">
        <div><div class="small muted">Altitude · ${rng('alt')} ft</div>${sparkline(h, 'alt', 'var(--live)')}</div>
        <div><div class="small muted">Indicated airspeed · ${rng('ias')} kt</div>${sparkline(h, 'ias', 'var(--accent)')}</div>
      </div>`;
  }

  // ================================================================== CALCULATORS
  const calcVals = store.get('calcVals', {});
  const calcFollow = store.get('calcFollow', {});
  function valsFor(c) {
    const v = {};
    for (const i of c.inputs) v[i.k] = i.v;
    return Object.assign(v, calcVals[c.id] || {});
  }
  function fieldHTML(i, vals, prefix) {
    const id = prefix + '-' + i.k;
    if (i.show && !i.show(vals)) return '';
    const hint = i.hint ? `<div class="hint">${esc(i.hint)}</div>` : '';
    if (i.type === 'select') {
      const opts = typeof i.options === 'function' ? i.options(vals) : i.options;
      return `<div class="field" data-k="${i.k}"><label for="${id}">${esc(i.label)}</label><div class="inp"><select id="${id}" data-k="${i.k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(vals[i.k]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>${hint}</div>`;
    }
    const unit = i.q ? qUnit(i.q) : (typeof i.unit === 'function' ? i.unit(vals) : i.unit);
    const step = typeof i.step === 'function' ? i.step(vals) : (i.step || 'any');
    const dv = i.q ? toDisp(i.q, vals[i.k]) : vals[i.k];
    return `<div class="field" data-k="${i.k}"><label for="${id}">${esc(i.label)}</label><div class="inp"><input id="${id}" data-k="${i.k}" type="number" inputmode="decimal" step="${step}" value="${esc(fmtInput(dv, step))}">${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>${hint}</div>`;
  }
  function fmtInput(v, step) {
    if (!isNum(v)) return '';
    const d = step === 'any' || step >= 1 ? (Math.abs(v) >= 100 ? 0 : 2) : Math.min(4, Math.max(2, -Math.floor(Math.log10(step))));
    return String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
  }
  function resultHTML(r) {
    let val, unit = r.unit || '';
    if (r.fmt === 'hdg') { val = hdg(r.value); unit = ''; }
    else if (r.fmt === 'min') { val = mins(r.value); unit = ''; }
    else if (r.fmt === 'mach') val = isNum(r.value) ? 'M' + r.value.toFixed(3) : '—';
    else if (r.fmt === 'text') val = esc(r.value);
    else if (r.q) { val = num(toDisp(r.q, r.value), r.d ?? qDec(r.q)); unit = qUnit(r.q) + (r.unitSuffix || ''); }
    else val = isNum(r.value) ? (r.signed && r.value > 0 ? '+' : '') + num(r.value, r.d ?? 0) : '—';
    return `<div class="res${r.main ? ' main' : ''}${r.tone ? ' ' + r.tone : ''}"><div class="k">${esc(r.label)}</div><div class="v">${val}${unit ? unitHTML(unit) : ''}</div>${r.note ? `<div class="x">${esc(r.note)}</div>` : ''}</div>`;
  }
  function stepsHTML(steps) {
    return steps.map((s, i) => `<div class="step"><span class="i">${i + 1}</span><div><div class="t">${esc(s.t)}</div><div class="e">${tex(s.tex, true)}</div></div></div>`).join('');
  }

  function renderCalc(sub) {
    const list = X.calculators;
    const c = list.find(x => x.id === sub) || list[0];
    const el = view();
    const nav = X.calcGroups.map(g => {
      const items = list.filter(x => x.group === g);
      if (!items.length) return '';
      return `<div class="navgroup" data-g="${esc(g)}"><h4>${esc(g)}</h4>${items.map(x => `<a href="#calc.${x.id}" data-t="${esc((x.title + ' ' + x.desc + ' ' + x.group).toLowerCase())}"${x.id === c.id ? ' aria-current="page"' : ''}>${esc(x.title)}</a>`).join('')}</div>`;
    }).join('');
    el.innerHTML = `
      <div class="view-head"><div><div class="eyebrow">Calculators · ${list.length} tools</div><h1>Flight computer</h1>
      <p>Every result shows its working. <span style="color:var(--live)">Green</span> fields follow X-Plane when “Follow sim” is on; <span style="color:var(--sel)">blue</span> fields are yours.</p></div></div>
      <div class="two">
        <aside class="side collapsible" id="calcSide"><input class="search" id="calcSearch" type="search" placeholder="Search calculators…" aria-label="Search calculators">
          <button class="btn ghost" id="calcMenu" type="button" style="display:none;width:100%;justify-content:center;margin-bottom:8px">Show all calculators</button>${nav}</aside>
        <section class="panel calc" id="calcCard"></section>
      </div>`;
    const side = $('#calcSide');
    if (window.matchMedia('(max-width: 760px)').matches) { $('#calcMenu').style.display = 'flex'; $('#calcMenu').onclick = () => { side.classList.toggle('open'); $('#calcMenu').textContent = side.classList.contains('open') ? 'Hide the list' : 'Show all calculators'; }; }
    $('#calcSearch').oninput = e => {
      const q = e.target.value.trim().toLowerCase();
      side.classList.toggle('open', !!q);
      $$('.navgroup', side).forEach(g => {
        let any = false;
        $$('a', g).forEach(a => { const m = !q || a.dataset.t.includes(q); a.hidden = !m; any = any || m; });
        g.hidden = !any;
      });
    };
    const api = buildCalc(c, $('#calcCard'));
    return { tick: api.tick };
  }

  function buildCalc(c, card) {
    let vals = valsFor(c);
    const hasLive = c.inputs.some(i => i.live);
    let follow = !!calcFollow[c.id] && hasLive;
    const liveNow = () => !!live.s;
    card.innerHTML = `
      <div class="eyebrow">${esc(c.group)}</div>
      <h2>${esc(c.title)}</h2><p class="desc">${esc(c.desc)}</p>
      <div class="tools">
        ${hasLive ? `<button class="btn live" id="followBtn" type="button" aria-pressed="${follow}">Follow sim</button><button class="btn" id="fillBtn" type="button">Fill from sim once</button>` : ''}
        <button class="btn ghost" id="resetBtn" type="button">Reset</button>
        ${c.study ? `<a class="btn ghost" href="#study.${c.study}">Study the theory →</a>` : ''}
      </div>
      <div class="fields" id="fields"></div>
      <div id="out"></div>`;
    const fieldsEl = $('#fields', card), outEl = $('#out', card);
    let workingOpen = store.get('workingOpen', true);

    function drawFields() {
      fieldsEl.innerHTML = c.inputs.map(i => fieldHTML(i, vals, 'f')).join('');
      $$('input,select', fieldsEl).forEach(inp => {
        const def = c.inputs.find(i => i.k === inp.dataset.k);
        const fw = inp.closest('.field');
        if (follow && def.live && liveNow()) fw.classList.add('following');
        inp.addEventListener(def.type === 'select' ? 'change' : 'input', () => {
          if (def.type === 'select') { vals[def.k] = inp.value; save(); drawFields(); compute(); return; }
          const raw = parseFloat(inp.value);
          if (!isNum(raw)) return;
          vals[def.k] = def.q ? fromDisp(def.q, raw) : raw;
          if (follow && def.live) { fw.classList.remove('following'); def._manual = true; }
          save(); compute();
        });
      });
    }
    function save() { calcVals[c.id] = vals; store.set('calcVals', calcVals); }
    function applyLive(force) {
      if (!live.s) return false;
      let changed = false;
      for (const i of c.inputs) {
        if (!i.live || (i._manual && !force)) continue;
        let v; try { v = i.live(live.s, vals); } catch (e) { v = undefined; }
        if (!isNum(v)) continue;
        vals[i.k] = v; changed = true;
        const inp = $(`[data-k="${i.k}"]`, fieldsEl);
        if (inp && inp.tagName === 'INPUT' && document.activeElement !== inp) {
          const step = typeof i.step === 'function' ? i.step(vals) : (i.step || 'any');
          inp.value = fmtInput(i.q ? toDisp(i.q, v) : v, step);
          if (follow) inp.closest('.field').classList.add('following');
        }
      }
      return changed;
    }
    function compute() {
      let out;
      try { out = c.run(Object.assign({}, vals), { s: live.s }); } catch (e) { out = { error: 'Could not calculate: ' + e.message }; }
      if (out.error) { outEl.innerHTML = `<div class="note bad err">${esc(out.error)}</div>`; return; }
      outEl.innerHTML = `<div class="results">${out.results.filter(r => r.fmt === 'text' || isNum(r.value)).map(resultHTML).join('')}</div>
        ${(out.notes || []).map(t => `<div class="note" style="margin-top:12px">${esc(t)}</div>`).join('')}
        ${out.steps && out.steps.length ? `<details class="working" ${workingOpen ? 'open' : ''}><summary>Show the working</summary>${stepsHTML(out.steps)}</details>` : ''}`;
      const d = $('details', outEl);
      if (d) d.addEventListener('toggle', () => { workingOpen = d.open; store.set('workingOpen', workingOpen); });
    }
    drawFields(); compute();
    const fb = $('#followBtn', card);
    if (fb) {
      fb.onclick = () => {
        follow = !follow; calcFollow[c.id] = follow; store.set('calcFollow', calcFollow);
        fb.setAttribute('aria-pressed', follow);
        c.inputs.forEach(i => { i._manual = false; });
        if (follow) { if (!live.s) toast('No live data yet — start X-Plane or the demo.'); applyLive(true); save(); drawFields(); compute(); }
        else $$('.field.following', fieldsEl).forEach(f => f.classList.remove('following'));
      };
      $('#fillBtn', card).onclick = () => { if (!live.s) { toast('No live data yet — start X-Plane or the demo.'); return; } c.inputs.forEach(i => { i._manual = false; }); applyLive(true); save(); drawFields(); compute(); };
    }
    $('#resetBtn', card).onclick = () => { vals = {}; c.inputs.forEach(i => { vals[i.k] = i.v; i._manual = false; }); delete calcVals[c.id]; store.set('calcVals', calcVals); drawFields(); compute(); };
    let last = 0;
    return {
      tick() {
        if (!follow || !live.s) return;
        const now = Date.now(); if (now - last < 450) return; last = now;
        if (applyLive(false)) { save(); compute(); }
      }
    };
  }

  // ================================================================== PERFORMANCE
  const plan = Object.assign({ profile: 'auto' }, store.get('plan', {}));
  const savePlan = () => store.set('plan', plan);
  function currentProfile() {
    if (plan.profile && plan.profile !== 'auto' && A.byId[plan.profile]) return A.byId[plan.profile];
    if (live.det && live.det.profile) return live.det.profile;
    return A.byId.B738;
  }
  function defaultCruise(p) { return Math.min(p.ceilingFt - 2000, p.engine === 'turboprop' ? 24000 : p.cls === 'widebody' ? 37000 : p.cls === 'regional' ? 35000 : 36000); }
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
    });
    savePlan();
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

  const PF = {
    load: [
      { k: 'oew', label: 'Operating empty weight', q: 'mass' }, { k: 'crewKg', label: 'Crew, catering & extras', q: 'mass' },
      { k: 'pax', label: 'Passengers', unit: 'pax', step: 1 }, { k: 'paxKg', label: 'Mass per passenger', q: 'mass', hint: 'EASA standard adult 84 kg incl. hand baggage' },
      { k: 'bagKg', label: 'Checked bag per passenger', q: 'mass' }, { k: 'cargoKg', label: 'Cargo & mail', q: 'mass' }
    ],
    fuel: [
      { k: 'tripNm', label: 'Trip distance (air route)', unit: 'NM' }, { k: 'cruiseFt', label: 'Cruise altitude', unit: 'ft', step: 1000 },
      { k: 'mach', label: 'Cruise Mach', unit: 'M', step: 0.01, show: () => !!currentProfile().cruiseMach }, { k: 'windKt', label: 'Average wind component (+ tail)', unit: 'kt' },
      { k: 'isaDev', label: 'Cruise ISA deviation', unit: '°C' }, { k: 'ffCruise', label: 'Average cruise fuel flow', q: 'flow' },
      { k: 'ffHold', label: 'Holding fuel flow', q: 'flow' }, { k: 'taxiKg', label: 'Taxi fuel', q: 'mass' },
      { k: 'contPct', label: 'Contingency', unit: '% of trip' }, { k: 'altNm', label: 'Distance to alternate (0 = none)', unit: 'NM' },
      { k: 'finalResMin', label: 'Final reserve', unit: 'min' }, { k: 'extraKg', label: 'Extra / discretionary fuel', q: 'mass' }
    ]
  };

  function pfield(i) {
    if (i.show && !i.show()) return '';
    return fieldHTML(i, plan, 'p');
  }
  function bindPlan(container, onChange) {
    $$('input,select', container).forEach(inp => {
      const k = inp.dataset.k;
      inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
        if (inp.tagName === 'SELECT') plan[k] = inp.value;
        else {
          const raw = parseFloat(inp.value); if (!isNum(raw)) return;
          const q = inp.closest('.field').dataset.q;
          plan[k] = q ? fromDisp(q, raw) : raw;
        }
        savePlan(); onChange(k);
      });
    });
  }
  function fieldsWithQ(list) { return list.map(i => pfield(i).replace('class="field"', `class="field"${i.q ? ` data-q="${i.q}"` : ''}`)).join(''); }
  const bar = (used, avail, tone) => {
    const pct = Math.max(0, Math.min(100, used / Math.max(1, avail) * 100));
    return `<div class="bar"><span class="${tone}" style="width:${pct.toFixed(1)}%"></span></div>`;
  };

  function renderPerf(sub) {
    const tabs = [['load', 'Load sheet'], ['fuel', 'Fuel plan'], ['takeoff', 'Take-off'], ['landing', 'Landing'], ['cruise', 'Climb, cruise & descent']];
    const tab = tabs.some(t => t[0] === sub) ? sub : 'takeoff';
    const p = currentProfile();
    if (plan.forProfile !== p.id) resetPlanFor(p);
    const d = live.det;
    const detected = d && d.commercial;
    const el = view();
    const opts = [['auto', 'Auto — detected aircraft' + (d && d.profile ? ' (' + d.profile.id + ')' : '')]].concat(A.PROFILES.map(x => [x.id, x.id + ' · ' + x.name + (x.user ? ' (yours)' : '')]));
    el.innerHTML = `
      <div class="view-head">
        <div><div class="eyebrow">Performance · ${esc(p.maker)} ${esc(p.cls)}</div><h1>${esc(p.name)}</h1>
          <p>${detected ? 'Opened automatically because X-Plane is flying an airliner.' : live.s ? 'The loaded aircraft is not an airliner — pick a type to plan with.' : 'Pick an aircraft type, or load an airliner in X-Plane and it is selected for you.'}
          Speeds come from the lift equation with typical data; distances are estimates. Use your aircraft’s own FMS or EFB when it has one.</p></div>
        <div class="field" style="min-width:min(320px,100%)"><label for="profSel">Aircraft profile</label><div class="inp"><select id="profSel">${opts.map(([v, l]) => `<option value="${esc(v)}"${plan.profile === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
      </div>
      ${p.generic ? `<div class="note warn" style="margin-bottom:14px"><b>Generic profile.</b> This type is not in the library, so wing area, flap lift and fuel flow are estimated from X-Plane’s own weights. Add your aircraft to <b>user_profiles.json</b> for better numbers.</div>` : ''}
      <nav class="tabs" aria-label="Performance sections">${tabs.map(([id, l]) => `<a href="#perf.${id}"${id === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <div id="perfBody"></div>`;
    $('#profSel').onchange = e => { plan.profile = e.target.value; savePlan(); resetPlanFor(currentProfile()); route(); };
    const body = $('#perfBody');
    const fn = { load: perfLoad, fuel: perfFuel, takeoff: perfTakeoff, landing: perfLanding, cruise: perfCruise }[tab];
    return fn(p, body) || null;
  }

  function simButtons(kind) {
    if (!live.s) return '';
    return `<button class="btn live" type="button" data-sim="${kind}">Use X-Plane now</button>`;
  }

  function perfLoad(p, body) {
    body.innerHTML = `<div class="perf-grid">
      <section class="panel pad"><fieldset class="fs"><legend>Payload</legend><div class="fields">${fieldsWithQ(PF.load)}</div></fieldset>
        <div class="note">Fuel comes from the <a href="#perf.fuel">fuel plan</a>. ${live.s ? `X-Plane now: payload <b>${qv('mass', live.s.payload)}</b>, fuel <b>${qv('mass', live.s.fuel)}</b>, total <b>${qv('mass', live.s.mass)}</b>.` : ''}</div></section>
      <section class="panel pad" id="lsOut"></section></div>`;
    const draw = () => {
      const { fp, ls } = perfCalc(p);
      const row = (k, v, bold) => `<tr${bold ? ' class="total"' : ''}><td>${k}</td><td class="n">${qv('mass', v)}</td></tr>`;
      const lim = (name, val, max) => {
        const ok = val <= max;
        return `<div style="margin-bottom:12px"><div class="bar-l"><b style="color:var(--text)">${name}</b><span>${qv('mass', val)} of ${qv('mass', max)}</span></div>${bar(val, max, ok ? (val / max > 0.97 ? 'warn' : 'ok') : 'bad')}</div>`;
      };
      $('#lsOut').innerHTML = `<div class="card-h"><h3>Load sheet</h3><span class="chip ${ls.underload >= 0 ? 'live' : 'bad'}">${ls.underload >= 0 ? 'within limits' : 'overweight'}</span></div>
        <div class="scroll-x"><table class="t"><tbody>
          ${row('Operating empty weight', plan.oew)}${row('Crew & extras', plan.crewKg)}${row('Dry operating weight', ls.dow, true)}
          ${row(plan.pax + ' passengers', ls.paxMass)}${row('Checked bags', ls.bagMass)}${row('Cargo', plan.cargoKg)}${row('Zero-fuel weight', ls.zfw, true)}
          ${row('Take-off fuel (block − taxi)', fp.takeoffFuel)}${row('Take-off weight', ls.tow, true)}${row('Trip fuel', fp.trip.fuel)}${row('Landing weight', ls.lw, true)}
        </tbody></table></div>
        <div style="margin-top:16px">${lim('Zero-fuel weight', ls.zfw, p.mzfw)}${lim('Take-off weight', ls.tow, p.mtow)}${lim('Landing weight', ls.lw, p.mlw)}</div>
        <div class="results"><div class="res ${ls.underload >= 0 ? 'ok' : 'bad'}"><div class="k">${ls.underload >= 0 ? 'Underload' : 'Over the limit by'}</div><div class="v">${qv('mass', Math.abs(ls.underload))}</div><div class="x">limited by ${esc(ls.limitedBy)}</div></div>
          <div class="res"><div class="k">Payload</div><div class="v">${qv('mass', ls.payload)}</div></div>
          <div class="res"><div class="k">For X-Plane’s Weight & Fuel</div><div class="v" style="font-size:16px">payload ${qv('mass', ls.zfw - plan.oew)}</div><div class="x">fuel ${qv('mass', fp.block)} at the gate</div></div></div>`;
    };
    bindPlan(body, draw); draw();
  }

  function perfFuel(p, body) {
    body.innerHTML = `<div class="perf-grid">
      <section class="panel pad"><fieldset class="fs"><legend>Route & policy</legend><div class="fields">${fieldsWithQ(PF.fuel)}</div></fieldset>
      <div class="note">Structure follows ICAO Annex 6 / EASA: taxi + trip + contingency (5 % of trip, at least 5 min holding) + alternate + final reserve (30 min holding at 1500 ft) + extra.</div></section>
      <section class="panel pad" id="fpOut"></section></div>`;
    const draw = () => {
      const { fp } = perfCalc(p);
      const t = fp.trip;
      const parts = [['Taxi', fp.taxi, 'var(--fig-muted)'], ['Trip', t.fuel, 'var(--accent)'], ['Contingency', fp.contingency, 'var(--warn)'], ['Alternate', fp.alternate ? fp.alternate.fuel : 0, 'var(--sel)'], ['Final reserve', fp.finalReserve, 'var(--bad)'], ['Extra', fp.extra, 'var(--live)']];
      const tot = fp.block;
      $('#fpOut').innerHTML = `<div class="card-h"><h3>Fuel plan</h3><span class="chip ${fp.overCapacity ? 'bad' : 'live'}">${fp.overCapacity ? 'exceeds tank capacity' : 'fits the tanks'}</span></div>
        <div class="stack" role="img" aria-label="fuel components">${parts.filter(x => x[1] > 0).map(([n, v, col]) => `<span style="width:${(v / tot * 100).toFixed(1)}%;background:${col}" title="${n}">${v / tot > 0.09 ? esc(n) : ''}</span>`).join('')}</div>
        <div class="scroll-x" style="margin-top:12px"><table class="t"><thead><tr><th>Component</th><th class="n">Time</th><th class="n">Fuel</th></tr></thead><tbody>
          <tr><td>Taxi</td><td class="n"></td><td class="n">${qv('mass', fp.taxi)}</td></tr>
          <tr><td>Trip — climb ${num(t.climb.dist)} NM</td><td class="n">${mins(t.climb.time)}</td><td class="n">${qv('mass', t.climb.fuel)}</td></tr>
          <tr><td>Trip — cruise ${num(t.cruise.dist)} NM at ${fl(t.altFt)}</td><td class="n">${mins(t.cruise.time)}</td><td class="n">${qv('mass', t.cruise.fuel)}</td></tr>
          <tr><td>Trip — descent ${num(t.descent.dist)} NM</td><td class="n">${mins(t.descent.time)}</td><td class="n">${qv('mass', t.descent.fuel)}</td></tr>
          <tr><td>Trip — approach & landing</td><td class="n">${mins(t.approach.time)}</td><td class="n">${qv('mass', t.approach.fuel)}</td></tr>
          <tr class="total"><td>Trip fuel</td><td class="n">${mins(t.time)}</td><td class="n">${qv('mass', t.fuel)}</td></tr>
          <tr><td>Contingency</td><td class="n"></td><td class="n">${qv('mass', fp.contingency)}</td></tr>
          <tr><td>Alternate${fp.alternate ? ' (' + num(plan.altNm) + ' NM at ' + fl(fp.alternate.altFt) + ', incl. go-around)' : ''}</td><td class="n">${fp.alternate ? mins(fp.alternate.time) : ''}</td><td class="n">${qv('mass', fp.alternate ? fp.alternate.fuel : 0)}</td></tr>
          <tr><td>Final reserve (${num(plan.finalResMin)} min)</td><td class="n"></td><td class="n">${qv('mass', fp.finalReserve)}</td></tr>
          <tr><td>Extra</td><td class="n"></td><td class="n">${qv('mass', fp.extra)}</td></tr>
          <tr class="total"><td>Block fuel</td><td class="n"></td><td class="n">${qv('mass', fp.block)}</td></tr>
        </tbody></table></div>
        ${t.reduced ? `<div class="note warn" style="margin-top:10px">Trip too short for ${fl(plan.cruiseFt)} — planned at ${fl(t.altFt)} instead.</div>` : ''}
        <div class="results"><div class="res main"><div class="k">Block fuel</div><div class="v">${qv('mass', fp.block)}</div><div class="x">${num(C.units.lToUsg(fp.block / 0.8))} US gal · ${num(fp.block / 0.8)} L of jet fuel</div></div>
          <div class="res"><div class="k">Cruise TAS / GS</div><div class="v">${num(t.tas)}<small>/ ${num(t.gs)} kt</small></div></div>
          <div class="res"><div class="k">Expected landing fuel</div><div class="v">${qv('mass', fp.landingFuel)}</div></div></div>`;
    };
    bindPlan(body, draw); draw();
  }

  function massSourceFields(prefix) {
    const mode = plan[prefix + 'MassMode'];
    const opts = [['plan', 'From the load sheet & fuel plan'], ['sim', 'X-Plane gross weight now'], ['manual', 'Enter it']];
    return fieldHTML({ k: prefix + 'MassMode', label: prefix === 'to' ? 'Take-off mass from' : 'Landing mass from', type: 'select', options: opts }, plan, 'p') +
      (mode === 'manual' ? fieldsWithQ([{ k: prefix + 'Mass', label: prefix === 'to' ? 'Take-off mass' : 'Landing mass', q: 'mass' }]) : '');
  }

  function airportBox(kind) {
    if (!live.bridge) return `<div class="note small">Runway lookup from X-Plane’s airport database works in the app on your PC.</div>`;
    return `<div class="row" style="margin-bottom:12px"><div class="field" style="flex:0 0 130px"><label for="apt-${kind}">Airport (ICAO)</label><div class="inp"><input id="apt-${kind}" type="text" maxlength="4" style="text-transform:uppercase;font-family:var(--font-mono)" placeholder="EETN" value="${esc(plan[kind + 'Icao'] || '')}"></div></div>
      <button class="btn" type="button" id="aptBtn-${kind}" style="align-self:flex-end">Load runways</button>
      <div class="field grow" id="rwyWrap-${kind}" hidden><label for="rwy-${kind}">Runway</label><div class="inp"><select id="rwy-${kind}"></select></div></div></div>
      <div class="small muted" id="aptMsg-${kind}"></div>`;
  }
  function bindAirport(kind, onPick) {
    const btn = $('#aptBtn-' + kind); if (!btn) return;
    const msg = $('#aptMsg-' + kind);
    const load = () => {
      const icao = $('#apt-' + kind).value.trim().toUpperCase();
      if (!icao) return;
      plan[kind + 'Icao'] = icao; savePlan();
      msg.textContent = 'Looking up ' + icao + '…';
      fetch('api/airport?icao=' + encodeURIComponent(icao)).then(r => r.json()).then(res => {
        if (!res.ok) {
          if (res.state === 'indexing' || res.state === 'ready to index') { msg.textContent = 'Reading X-Plane’s airport database for the first time (about 10–20 s)…'; setTimeout(load, 3000); return; }
          msg.textContent = res.error || ('Airport data: ' + res.state + '. Set your X-Plane folder in Settings.'); return;
        }
        const wrap = $('#rwyWrap-' + kind), sel = $('#rwy-' + kind);
        const mv = live.s && isNum(live.s.magVar) ? live.s.magVar : null;
        res.runways.forEach(r => {
          const num = parseInt(r.id, 10);
          let v = mv;
          if (v == null && num > 0) { const e = C.norm180(r.hdgTrue - num * 10); v = Math.abs(e) <= 25 ? e : 0; }
          r.hdgMag = C.norm360(r.hdgTrue - (v || 0));
        });
        sel.innerHTML = res.runways.map((r, i) => `<option value="${i}">${esc(r.id)} · ${hdg(r.hdgMag)}M · ${num(toDisp('rwy', kind === 'dep' ? r.toraM : r.ldaM))} ${esc(qUnit('rwy'))}</option>`).join('');
        wrap.hidden = false;
        msg.textContent = res.name + ' · elevation ' + num(res.elevFt) + ' ft · ' + res.runways.length / 2 + ' runway(s). Slope is not in apt.dat — enter it if known.';
        const pick = () => onPick(res, res.runways[+sel.value]);
        sel.onchange = pick; pick();
      }).catch(() => { msg.textContent = 'Lookup failed — is the app still running?'; });
    };
    btn.onclick = load;
    $('#apt-' + kind).addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  }

  function perfTakeoff(p, body) {
    const flapOpts = p.takeoffFlaps.map(f => [f.id, (p.policy === 'airbus' ? 'CONF ' : 'Flaps ') + f.id]);
    const F = [
      { k: 'toFlap', label: 'Take-off flaps', type: 'select', options: flapOpts },
      { k: 'depSurface', label: 'Runway condition', type: 'select', options: [['dry', 'Dry'], ['wet', 'Wet'], ['contaminated', 'Contaminated']] },
      { k: 'toraM', label: 'Take-off run available', q: 'rwy' }, { k: 'rwyHdg', label: 'Runway heading', unit: '°M' },
      { k: 'depElev', label: 'Airport elevation', unit: 'ft' }, { k: 'slope', label: 'Slope (+ uphill)', unit: '%', step: 0.1 },
      { k: 'depOat', label: 'Outside air temperature', unit: '°C' }, { k: 'depQnh', label: 'QNH', q: 'press' },
      { k: 'depWindDir', label: 'Wind from', unit: '°M' }, { k: 'depWindKt', label: 'Wind speed', unit: 'kt' }
    ];
    body.innerHTML = `<div class="perf-grid">
      <section class="panel pad">
        <fieldset class="fs"><legend>Departure runway</legend>${airportBox('dep')}</fieldset>
        <fieldset class="fs"><legend>Conditions</legend><div class="fields">${massSourceFields('to')}${fieldsWithQ(F)}</div></fieldset>
        <div class="row">${simButtons('dep')}<span class="small muted">${live.s ? 'Fills OAT, QNH, wind' + (live.s.onGround ? ', elevation and runway heading' : '') + ' from the sim.' : ''}</span></div>
      </section>
      <section class="panel pad" id="toOut"></section></div>`;
    const draw = () => {
      const { toMass } = perfCalc(p);
      const wc = C.windComponents(plan.depWindDir, plan.depWindKt, plan.rwyHdg);
      const o = { mass: toMass, flap: plan.toFlap, elevFt: plan.depElev, qnh: plan.depQnh, oatC: plan.depOat, headwind: wc.head, slopePct: plan.slope, surface: plan.depSurface, toraM: plan.toraM };
      const fx = P.flexTemp(p, o);
      const useFlex = fx.flex != null;
      const d = useFlex ? fx.flexDist : fx.toga;
      const sp = d.speeds;
      const fits = fx.toga.tofl <= plan.toraM;
      const over = toMass > p.mtow;
      $('#toOut').innerHTML = `
        <div class="card-h"><h3>Take-off data · ${(p.policy === 'airbus' ? 'CONF ' : 'Flaps ') + esc(sp.flap)}</h3><span class="chip ${fits && !over ? 'live' : 'bad'}">${over ? 'above MTOW' : fits ? 'runway OK' : 'runway too short'}</span></div>
        <div class="speeds">${[['V1', sp.v1], ['VR', sp.vr], ['V2', sp.v2]].map(([k, v]) => `<div class="res main"><div class="k">${k}</div><div class="v">${num(v)}<small>kt</small></div></div>`).join('')}</div>
        ${sp.vmcgLimited ? '<div class="note warn" style="margin-top:10px">V1 raised to VMCG (minimum control speed on the ground).</div>' : ''}
        <div class="results">
          <div class="res ${useFlex ? '' : 'warn'}"><div class="k">${useFlex ? (p.policy === 'airbus' ? 'FLEX temperature' : 'Assumed temperature') : 'Thrust'}</div><div class="v">${useFlex ? num(fx.flex) + '<small>°C</small>' : 'TOGA'}</div><div class="x">${useFlex ? '−' + num(fx.reduction * 100) + ' % thrust · limited by ' + esc(fx.limitedBy) : esc(fx.limitedBy || '')}</div></div>
          <div class="res"><div class="k">Take-off mass</div><div class="v">${qv('mass', toMass)}</div><div class="x">${num(toMass / p.mtow * 100)} % of MTOW</div></div>
          <div class="res"><div class="k">${wc.head >= 0 ? 'Headwind' : 'Tailwind'} / crosswind</div><div class="v">${num(Math.abs(wc.head))}<small>/ ${num(Math.abs(wc.cross))} kt</small></div><div class="x">crosswind from the ${wc.side}</div></div>
          <div class="res"><div class="k">Pressure / density altitude</div><div class="v" style="font-size:18px">${num(d.air.pa)} / ${num(C.densityAltitude(d.air.pa, plan.depOat).ft)}<small>ft</small></div></div>
        </div>
        <div style="margin-top:18px">
          <div class="bar-l"><b style="color:var(--text)">Field length needed (TOGA)</b><span>${qv('rwy', fx.toga.tofl)} of ${qv('rwy', plan.toraM)}</span></div>${bar(fx.toga.tofl, plan.toraM, fits ? 'ok' : 'bad')}
          ${useFlex ? `<div class="bar-l" style="margin-top:10px"><b style="color:var(--text)">Field length needed at ${num(fx.flex)} °C</b><span>${qv('rwy', fx.flexDist.tofl)}</span></div>${bar(fx.flexDist.tofl, plan.toraM, 'ok')}` : ''}
        </div>
        <details class="working" open><summary>Show the working</summary>${stepsHTML([
          { t: '1-g stall speed in take-off configuration (lift equation, sea-level density, CAS ≈ EAS)', tex: String.raw`V_{S1g} = \sqrt{\frac{2W}{\rho_0 S C_{L\max}}} = \sqrt{\frac{2 \times ${num(toMass, 0).replace(/,/g, '')} \times 9.807}{1.225 \times ${p.wingArea} \times ${sp.cl}}} = ${sp.vs1g.toFixed(1)}\ \text{kt}` },
          { t: 'Take-off safety speed: at least 1.13 × the 1-g stall speed (CS/FAR 25.107)', tex: String.raw`V_2 = 1.13\,V_{S1g} = ${sp.v2.toFixed(1)}\ \text{kt} \qquad V_R = V_2 - ${p.vr} \qquad V_1 = V_R - ${plan.depSurface === 'dry' ? p.v1Dry : p.v1Wet}` },
          { t: 'Field length scales with weight², thin air, lower thrust and less flap', tex: String.raw`\text{TOFL} = \text{TOFL}_{ref}\left(\frac{W}{W_{MTOW}}\right)^{2}\frac{1}{\sigma}\,\frac{T_{ref}}{T}\,\frac{C_{L,ref}}{C_L}\,f_{wind}\,f_{slope}\,f_{surface}` },
          { t: 'With your numbers', tex: String.raw`${num(p.toflRef).replace(/,/g, '')} \times ${fx.toga.factors.mass.toFixed(3)} \times ${fx.toga.factors.density.toFixed(3)} \times ${fx.toga.factors.thrust.toFixed(3)} \times ${fx.toga.factors.flap.toFixed(3)} \times ${fx.toga.factors.wind.toFixed(3)} \times ${fx.toga.factors.slope.toFixed(3)} \times ${fx.toga.factors.surface.toFixed(2)} = ${fx.toga.tofl.toFixed(0)}\ \text{m}` },
          { t: 'Assumed temperature: pretend it is hotter until the runway is just long enough (max 25 % reduction)', tex: String.raw`T_{flex} = \max\{T : \text{TOFL}(T) \le \text{TORA},\ 1 - \tfrac{T(T)}{T(OAT)} \le 25\%\} = ${useFlex ? fx.flex + '^\\circ\\text{C}' : '\\text{none}'}` }
        ])}</details>
        <p class="small muted" style="margin-top:12px">Estimate for simulation. Real V-speeds also depend on VMCA, tyre and brake limits and obstacle clearance.</p>`;
    };
    bindPlan(body, k => { if (k === 'toMassMode') { route(); return; } draw(); });
    const sb = $('[data-sim="dep"]', body);
    if (sb) sb.onclick = () => {
      const s = live.s; if (!s) return;
      plan.depOat = Math.round(s.oat); if (s.qnh) plan.depQnh = Math.round(s.qnh);
      plan.depWindDir = Math.round(s.windDirM); plan.depWindKt = Math.round(s.windKt);
      if (s.onGround) { plan.depElev = Math.round(s.altMsl); plan.rwyHdg = Math.round(s.hdgM); }
      if (s.rwyFriction > 0) plan.depSurface = s.rwyFriction <= 3 ? 'wet' : 'contaminated';
      savePlan(); route();
    };
    bindAirport('dep', (apt, r) => { plan.depElev = Math.round(apt.elevFt); plan.rwyHdg = Math.round(r.hdgMag); plan.toraM = r.toraM; savePlan(); $$('input', body).forEach(i => { const k = i.dataset.k; if (k in plan && i.type === 'number') { const q = i.closest('.field').dataset.q; i.value = fmtInput(q ? toDisp(q, plan[k]) : plan[k], 'any'); } }); draw(); });
    draw();
  }

  function perfLanding(p, body) {
    const flapOpts = p.landingFlaps.map(f => [f.id, (p.policy === 'airbus' ? 'CONF ' : 'Flaps ') + f.id]);
    const abOpts = (p.autobrake || []).map(a => [a.id, a.id + ' (' + a.d.toFixed(1) + ' m/s²)']);
    const F = [
      { k: 'ldgFlap', label: 'Landing flaps', type: 'select', options: flapOpts },
      { k: 'ab', label: p.autobrake === A.AB.manual ? 'Braking' : 'Autobrake', type: 'select', options: abOpts },
      { k: 'arrSurface', label: 'Runway condition', type: 'select', options: [['dry', 'Dry'], ['wet', 'Wet'], ['contaminated', 'Contaminated']] },
      { k: 'reverse', label: 'Reverse thrust', type: 'select', options: [['yes', 'Used'], ['no', 'Not used']] },
      { k: 'ldaM', label: 'Landing distance available', q: 'rwy' }, { k: 'arrRwyHdg', label: 'Runway heading', unit: '°M' },
      { k: 'arrElev', label: 'Airport elevation', unit: 'ft' }, { k: 'arrSlope', label: 'Slope (+ uphill)', unit: '%', step: 0.1 },
      { k: 'arrOat', label: 'Outside air temperature', unit: '°C' }, { k: 'arrQnh', label: 'QNH', q: 'press' },
      { k: 'arrWindDir', label: 'Wind from', unit: '°M' }, { k: 'arrWindKt', label: 'Wind speed', unit: 'kt' }, { k: 'arrGust', label: 'Gusting to (0 = none)', unit: 'kt' }
    ];
    body.innerHTML = `<div class="perf-grid">
      <section class="panel pad">
        <fieldset class="fs"><legend>Arrival runway</legend>${airportBox('arr')}</fieldset>
        <fieldset class="fs"><legend>Conditions</legend><div class="fields">${massSourceFields('ld')}${fieldsWithQ(F)}</div></fieldset>
        <div class="row">${simButtons('arr')}<span class="small muted">${live.s ? 'Fills OAT, QNH and wind from the sim' + (isNum(live.s.landingAlt) && live.s.landingAlt > 0 ? ', and the FMS landing elevation.' : '.') : ''}</span></div>
      </section>
      <section class="panel pad" id="ldOut"></section></div>`;
    const draw = () => {
      const { ldMass } = perfCalc(p);
      const wc = C.windComponents(plan.arrWindDir, plan.arrWindKt, plan.arrRwyHdg, plan.arrGust > plan.arrWindKt ? plan.arrGust : undefined);
      const ab = (p.autobrake || []).find(a => a.id === plan.ab) || (p.autobrake || [])[0];
      const o = { mass: ldMass, flap: plan.ldgFlap, elevFt: plan.arrElev, qnh: plan.arrQnh, oatC: plan.arrOat, headwind: wc.head, windSpeed: plan.arrWindKt,
        gust: plan.arrGust > plan.arrWindKt ? plan.arrGust : 0, slopePct: plan.arrSlope, surface: plan.arrSurface, decel: ab ? ab.d : 2, reverse: plan.reverse === 'yes' };
      const ld = P.landingDistance(p, o);
      const rec = P.recommendAutobrake(p, o, plan.ldaM);
      const sp = ld.speeds;
      const fitsDispatch = ld.ldr <= plan.ldaM, fitsOp = ld.factored <= plan.ldaM;
      const over = ldMass > p.mlw;
      $('#ldOut').innerHTML = `
        <div class="card-h"><h3>Landing data · ${(p.policy === 'airbus' ? 'CONF ' : 'Flaps ') + esc(sp.flap)}</h3><span class="chip ${over ? 'bad' : fitsOp ? 'live' : 'bad'}">${over ? 'above max landing weight' : fitsOp ? 'runway OK' : 'runway too short'}</span></div>
        <div class="speeds">
          <div class="res main"><div class="k">${sp.name}</div><div class="v">${num(sp.vref)}<small>kt</small></div></div>
          <div class="res main"><div class="k">Wind additive</div><div class="v">+${num(sp.add)}<small>kt</small></div></div>
          <div class="res main"><div class="k">${p.policy === 'airbus' ? 'VAPP' : 'Vapp'}</div><div class="v">${num(sp.vapp)}<small>kt</small></div></div>
        </div>
        <div class="note" style="margin-top:10px">${esc(sp.rule)}</div>
        <div class="results">
          <div class="res"><div class="k">Landing mass</div><div class="v">${qv('mass', ldMass)}</div><div class="x">${num(ldMass / p.mlw * 100)} % of max landing weight</div></div>
          <div class="res"><div class="k">${wc.head >= 0 ? 'Headwind' : 'Tailwind'} / crosswind</div><div class="v">${num(Math.abs(wc.head))}<small>/ ${num(Math.abs(wc.cross))} kt</small></div><div class="x">${has(wc.gustCross) ? 'gust crosswind ' + num(Math.abs(wc.gustCross)) + ' kt' : 'crosswind from the ' + wc.side}</div></div>
          <div class="res"><div class="k">Touchdown ground speed</div><div class="v">${num(ld.gsTdKt)}<small>kt</small></div></div>
          <div class="res ${rec.pick ? 'ok' : 'bad'}"><div class="k">Suggested ${p.autobrake === A.AB.manual ? 'braking' : 'autobrake'}</div><div class="v">${rec.pick ? esc(rec.pick.id) : 'none fits'}</div><div class="x">lowest setting with 15 % margin</div></div>
        </div>
        <div style="margin-top:18px">
          <div class="bar-l"><b style="color:var(--text)">Actual landing distance × 1.15 (${esc(ab ? ab.id : '')})</b><span>${qv('rwy', ld.factored)} of ${qv('rwy', plan.ldaM)}</span></div>${bar(ld.factored, plan.ldaM, fitsOp ? 'ok' : 'bad')}
          <div class="bar-l" style="margin-top:10px"><b style="color:var(--text)">Dispatch required distance (÷ 0.6${plan.arrSurface === 'dry' ? '' : ' × 1.15'})</b><span>${qv('rwy', ld.ldr)}</span></div>${bar(ld.ldr, plan.ldaM, fitsDispatch ? 'ok' : 'warn')}
        </div>
        <div class="scroll-x" style="margin-top:14px"><table class="t"><thead><tr><th>${p.autobrake === A.AB.manual ? 'Braking' : 'Autobrake'}</th><th class="n">Decel m/s²</th><th class="n">Distance</th><th class="n">× 1.15</th><th>Fits</th></tr></thead><tbody>
          ${rec.rows.map(r => `<tr${rec.pick && r.id === rec.pick.id ? ' class="pick"' : ''}><td>${esc(r.id)}${r.frictionLimited ? ' <span class="small muted">(friction-limited)</span>' : ''}</td><td class="n">${r.achieved.toFixed(2)}</td><td class="n">${qv('rwy', r.ald)}</td><td class="n">${qv('rwy', r.factored)}</td><td>${r.fits ? '✓' : '✗'}</td></tr>`).join('')}
        </tbody></table></div>
        <details class="working"><summary>Show the working</summary>${stepsHTML([
          { t: 'Reference speed: 1.23 × the 1-g stall speed in landing configuration', tex: String.raw`V_{S1g} = \sqrt{\frac{2 \times ${Math.round(ldMass)} \times 9.807}{1.225 \times ${p.wingArea} \times ${sp.cl}}} = ${sp.vs1g.toFixed(1)}\ \text{kt} \;\Rightarrow\; ${sp.name === 'VLS' ? 'V_{LS}' : 'V_{REF}'} = 1.23\,V_{S1g} = ${sp.vref.toFixed(1)}\ \text{kt}` },
          { t: 'Distance = air segment from 50 ft + transition + braking', tex: String.raw`\text{ALD} = ${ld.airDist.toFixed(0)} + ${ld.trans.toFixed(0)} + \frac{V_{td}^2}{2a} = ${ld.airDist.toFixed(0)} + ${ld.trans.toFixed(0)} + \frac{(${(ld.gsTdKt * 0.5144).toFixed(1)})^2}{2 \times ${ld.aBrake.toFixed(2)}} = ${ld.ald.toFixed(0)}\ \text{m}` },
          { t: 'Autobrake holds a set deceleration; reverse thrust only shortens the roll when braking is at the friction limit', tex: String.raw`a = ${ld.frictionLimited ? String.raw`\mu g + a_{rev}` : String.raw`a_{autobrake}`} = ${ld.aBrake.toFixed(2)}\ \text{m/s}^2` }
        ])}</details>
        <p class="small muted" style="margin-top:12px">Estimate for simulation. Contaminated runways need the aircraft’s own data.</p>`;
    };
    bindPlan(body, k => { if (k === 'ldMassMode') { route(); return; } draw(); });
    const sb = $('[data-sim="arr"]', body);
    if (sb) sb.onclick = () => {
      const s = live.s; if (!s) return;
      plan.arrOat = Math.round(s.oat); if (s.qnh) plan.arrQnh = Math.round(s.qnh);
      plan.arrWindDir = Math.round(s.windDirM); plan.arrWindKt = Math.round(s.windKt);
      if (isNum(s.landingAlt) && s.landingAlt > 0) plan.arrElev = Math.round(s.landingAlt);
      if (s.rwyFriction > 0) plan.arrSurface = s.rwyFriction <= 3 ? 'wet' : 'contaminated';
      savePlan(); route();
    };
    bindAirport('arr', (apt, r) => { plan.arrElev = Math.round(apt.elevFt); plan.arrRwyHdg = Math.round(r.hdgMag); plan.ldaM = r.ldaM; savePlan(); $$('input', body).forEach(i => { const k = i.dataset.k; if (k in plan && i.type === 'number') { const q = i.closest('.field').dataset.q; i.value = fmtInput(q ? toDisp(q, plan[k]) : plan[k], 'any'); } }); draw(); });
    draw();
  }
  const has = x => isNum(x);

  function perfCruise(p, body) {
    const F = [
      { k: 'climbCas', label: 'Climb / descent CAS', unit: 'kt' }, { k: 'climbMach', label: 'Cruise Mach', unit: 'M', step: 0.01 },
      { k: 'desFrom', label: 'Descend from', unit: 'ft', step: 1000 }, { k: 'desTo', label: 'To altitude', unit: 'ft', step: 500 },
      { k: 'desGs', label: 'Average descent GS', unit: 'kt' }, { k: 'decelNm', label: 'Slow-down allowance', unit: 'NM' }
    ];
    body.innerHTML = `<div class="perf-grid">
      <section class="panel pad"><fieldset class="fs"><legend>Profile</legend><div class="fields">${fieldsWithQ(F)}</div></fieldset>
        <div class="row">${live.s ? '<button class="btn live" type="button" id="cruiseSim">Use X-Plane now</button><span class="small muted">altitude and ground speed</span>' : ''}</div></section>
      <section class="panel pad" id="crOut"></section></div>`;
    const draw = () => {
      const { ldMass, toMass } = perfCalc(p);
      const xo = C.crossoverAltitude(plan.climbCas, plan.climbMach);
      const des = C.descent({ fromFt: plan.desFrom, toFt: plan.desTo, gs: plan.desGs, angleDeg: 3, decelNm: plan.decelNm });
      const tasCr = C.machToTas(plan.climbMach, C.isaTempC(plan.desFrom));
      const hs = C.holdingSpeeds(plan.desTo);
      const mass = live.s && live.s.mass > 0 ? live.s.mass : (toMass + ldMass) / 2;
      const man = P.maneuverSpeeds(p, mass);
      $('#crOut').innerHTML = `<div class="card-h"><h3>Speeds & descent</h3><span class="chip plain">at ${qv('mass', mass)}</span></div>
        <div class="results">
          <div class="res main"><div class="k">Crossover altitude ${num(plan.climbCas)} kt / M${plan.climbMach.toFixed(2)}</div><div class="v">${fl(xo.ft)}</div><div class="x">${num(xo.ft)} ft — fly the Mach above it</div></div>
          <div class="res main"><div class="k">Top of descent</div><div class="v">${num(des.distNm)}<small>NM out</small></div><div class="x">3° path ${num(des.pathNm)} NM + ${num(plan.decelNm)} NM slowing</div></div>
          <div class="res"><div class="k">Descent rate for 3°</div><div class="v">${num(des.vs)}<small>fpm</small></div></div>
          <div class="res"><div class="k">TAS at M${plan.climbMach.toFixed(2)}, ${fl(plan.desFrom)} (ISA)</div><div class="v">${num(tasCr)}<small>kt</small></div></div>
          ${p.greenDot ? `<div class="res"><div class="k">Green dot (rule of thumb)</div><div class="v">${num(P.greenDot(mass, 0))}<small>kt</small></div><div class="x">2 × mass in tonnes + 85</div></div>` : ''}
          <div class="res"><div class="k">Max holding speed at ${num(plan.desTo)} ft</div><div class="v" style="font-size:20px">${esc(hs.icao)}</div><div class="x">ICAO · FAA ${esc(hs.faa)}</div></div>
        </div>
        ${man ? `<h3 style="margin:18px 0 8px;font-size:15px">Flap manoeuvre speeds</h3><div class="scroll-x"><table class="t"><thead><tr><th>Flaps</th><th class="n">Speed</th></tr></thead><tbody>${man.map(m => `<tr><td>${esc(m.flap)}</td><td class="n">${num(m.speed)} kt</td></tr>`).join('')}</tbody></table></div><p class="small muted">Vref${esc(p.maneuver.ref)} + the usual additives.</p>` : ''}
        <details class="working"><summary>Show the working</summary>${stepsHTML([
          { t: 'Crossover: the static pressure where the CAS impact pressure equals the Mach impact pressure', tex: String.raw`P_x = \frac{q_c(V_c)}{(1 + 0.2M^2)^{3.5} - 1} = ${(xo.P / 100).toFixed(1)}\ \text{hPa} \Rightarrow ${Math.round(xo.ft)}\ \text{ft}` },
          { t: '3° descent: 318 ft per NM; VS = 5.3 × GS', tex: String.raw`D = \frac{${plan.desFrom - plan.desTo}}{318.4} = ${des.pathNm.toFixed(1)}\ \text{NM} \qquad VS = ${plan.desGs} \times 5.31 = ${Math.round(des.vs)}\ \text{fpm}` }
        ])}</details>`;
    };
    bindPlan(body, draw);
    const cs = $('#cruiseSim');
    if (cs) cs.onclick = () => { const s = live.s; if (!s) return; plan.desFrom = Math.round(s.altInd / 100) * 100; if (s.gs > 50) plan.desGs = Math.round(s.gs); savePlan(); route(); };
    draw();
  }

  // ================================================================== STUDY
  function renderStudy(sub) {
    const S = X.study, el = view();
    if (!S) { el.innerHTML = '<p>Study library failed to load.</p>'; return null; }
    const topic = sub && S.topics.find(t => t.id === sub);
    const toc = S.chapters.map(ch => `<div class="navgroup"><h4>${esc(ch.no + ' · ' + ch.title)}</h4>${S.topics.filter(t => t.ch === ch.id).map(t => `<a href="#study.${t.id}"${topic && t.id === topic.id ? ' aria-current="page"' : ''}><span class="n">${esc(t.no)}</span>${esc(t.title)}</a>`).join('')}</div>`).join('');
    if (!topic) {
      el.innerHTML = `<div class="view-head"><div><div class="eyebrow">Study library · ${S.topics.length} topics</div><h1>The theory behind every number</h1>
        <p>Diagrams, the exact equations the calculators use, worked examples computed live, and where to find each value inside X-Plane.</p></div></div>
        ${S.chapters.map(ch => `<h2 style="font-size:15px;margin:22px 0 10px">${esc(ch.no)} · ${esc(ch.title)}</h2><div class="study-index">${S.topics.filter(t => t.ch === ch.id).map(t => `
          <a class="panel tile" href="#study.${t.id}"><div class="thumb">${t.thumb ? t.thumb() : ''}</div><span class="ch">${esc(t.no)}</span><b>${esc(t.title)}</b><span class="small muted">${esc(t.blurb)}</span></a>`).join('')}</div>`).join('')}`;
      return null;
    }
    const idx = S.topics.indexOf(topic);
    const prev = S.topics[idx - 1], next = S.topics[idx + 1];
    const ctx = { s: live.s, ac: live.ac, det: live.det, profile: currentProfile(), tex, num, hdg, esc, C, P, A };
    let html;
    try { html = topic.render(ctx); } catch (e) { html = `<div class="note bad">This topic failed to render: ${esc(e.message)}</div>`; }
    el.innerHTML = `<div class="study"><aside class="side collapsible" id="studySide"><a class="btn ghost" href="#study" style="margin-bottom:8px">← All topics</a>
        <button class="btn ghost" id="tocBtn" type="button" style="display:none;width:100%;justify-content:center;margin-bottom:8px">Show all topics</button>${toc}</aside>
      <article class="lesson"><div class="eyebrow">${esc(topic.no)} · ${esc(S.chapters.find(c => c.id === topic.ch).title)}</div><h1>${esc(topic.title)}</h1>${html}
        <nav class="lesson-nav">${prev ? `<a class="btn" href="#study.${prev.id}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="btn" href="#study.${next.id}">${esc(next.title)} →</a>` : ''}</nav>
      </article></div>`;
    if (window.matchMedia('(max-width: 900px)').matches) { const b = $('#tocBtn'); b.style.display = 'flex'; b.onclick = () => { $('#studySide').classList.toggle('open'); }; }
    $$('.lesson [data-eq]', el).forEach(n => { n.innerHTML = tex(n.dataset.eq, n.dataset.inline !== '1'); });
    view().scrollTop = 0; window.scrollTo(0, 0);
    return null;
  }

  // ================================================================== SETTINGS
  function renderSettings() {
    const el = view();
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-set="${key}" data-v="${v}" aria-pressed="${settings[key] === v}">${l}</button>`).join('')}</div>`;
    const xp = live.raw && live.raw.xp;
    const cfg = live.cfg && live.cfg.config;
    el.innerHTML = `<div class="view-head"><div><div class="eyebrow">Settings</div><h1>Connection, units & display</h1></div></div>
      <div class="settings">
        <section class="panel pad"><div class="card-h"><h3>X-Plane connection</h3><span class="chip ${xp && xp.connected ? 'live' : demo.running() ? 'warn' : 'bad'}">${xp && xp.connected ? 'connected' : demo.running() ? 'demo' : 'not connected'}</span></div>
          ${live.bridge ? `<dl class="kv" id="connKv"></dl>
          <div class="fields" style="margin-top:14px">
            <div class="field"><label for="cfgHost">X-Plane PC (IP or “auto”)</label><div class="inp"><input id="cfgHost" type="text" value="${esc(cfg ? cfg.xpHost : 'auto')}" style="font-family:var(--font-mono)"></div></div>
            <div class="field"><label for="cfgUdp">UDP port</label><div class="inp"><input id="cfgUdp" type="number" value="${esc(cfg ? cfg.udpPort : 49000)}"></div></div>
            <div class="field"><label for="cfgWeb">Web API port</label><div class="inp"><input id="cfgWeb" type="number" value="${esc(cfg ? cfg.webApiPort : 8086)}"></div></div>
          </div>
          <div class="row" style="margin-top:12px"><button class="btn" id="cfgSave" type="button">Save connection</button><span class="small muted" id="cfgMsg"></span></div>`
          : `<p class="muted small">This page is not running inside the XP Flight Computer app, so it cannot reach X-Plane. Download the app and run <b>start.bat</b> on the PC with X-Plane.</p>`}
        </section>
        <section class="panel pad"><div class="card-h"><h3>Runway data</h3></div>
          ${live.bridge ? `<p class="small muted" style="margin-top:0">Runways are read from X-Plane’s own airport database (apt.dat). Point to your X-Plane 12 folder if it was not found.</p>
          <div class="field"><label for="cfgRoot">X-Plane 12 folder</label><div class="inp"><input id="cfgRoot" type="text" placeholder="D:\\SteamLibrary\\steamapps\\common\\X-Plane 12" value="${esc(cfg ? cfg.xpRoot : '')}" style="font-family:var(--font-mono);font-size:13px"></div></div>
          <div class="row" style="margin-top:10px"><button class="btn" id="rootSave" type="button">Save folder</button><span class="small muted" id="rootMsg">${esc(live.cfg && live.cfg.airports ? live.cfg.airports.state + (live.cfg.airports.root ? ' · ' + live.cfg.airports.root : '') : '')}</span></div>`
          : '<p class="small muted">Available in the app on your PC.</p>'}
        </section>
        <section class="panel pad"><div class="card-h"><h3>Units</h3></div>
          <div class="set-row"><span>Mass & fuel</span>${seg('mass', [['kg', 'kg'], ['lb', 'lb']])}</div>
          <div class="set-row"><span>Pressure</span>${seg('press', [['hPa', 'hPa'], ['inHg', 'inHg']])}</div>
          <div class="set-row"><span>Runway length</span>${seg('rwy', [['m', 'm'], ['ft', 'ft']])}</div>
          <div class="set-row"><span>Fuel volume</span>${seg('vol', [['L', 'L'], ['USG', 'US gal']])}</div>
        </section>
        <section class="panel pad"><div class="card-h"><h3>Display</h3></div>
          <div class="set-row"><span>Theme</span>${seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
        </section>
        <section class="panel pad"><div class="card-h"><h3>Demo flight</h3><span class="chip ${demo.running() ? 'warn' : ''}">${demo.running() ? 'running' : 'off'}</span></div>
          <p class="small muted" style="margin-top:0">Simulated data for trying the app without X-Plane. It stops by itself when X-Plane connects.</p>
          <div class="set-row"><span>Aircraft</span>${seg('demo', Object.keys(demo.TYPES).map(k => [k, k]))}</div>
          <div class="row" style="margin-top:10px">${demo.running() ? '<button class="btn" id="demoStop" type="button">Stop the demo</button>' : xp && xp.connected ? '<button class="btn" type="button" disabled>X-Plane is live — no demo needed</button>' : '<button class="btn primary" id="demoStart" type="button">Start the demo</button>'}</div>
        </section>
        <section class="panel pad"><div class="card-h"><h3>About</h3></div>
          <p class="small" style="margin-top:0">XP Flight Computer 1.0 · for flight simulation and study only — not for real-world navigation or aircraft operation. Airliner figures are typical public data and estimates.</p>
          <p class="small muted">Equations rendered with KaTeX (MIT). Type: B612 and B612 Mono (SIL OFL, designed for Airbus cockpit displays), Source Serif 4 (SIL OFL). Runway data comes from your own X-Plane installation.</p>
        </section>
      </div>`;
    $$('[data-set]', el).forEach(b => b.onclick = () => {
      const k = b.dataset.set, v = b.dataset.v;
      settings[k] = v; saveSettings();
      if (k === 'theme') applyTheme();
      if (k === 'demo' && demo.running()) { demo.setType(v); live.sig = null; }
      renderSettings(); updateHeader();
    });
    const ds = $('#demoStart'); if (ds) ds.onclick = () => { startDemo(false); renderSettings(); };
    const dx = $('#demoStop'); if (dx) dx.onclick = () => { stopDemo(); renderSettings(); };
    const post = (body, msgEl) => fetch('api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json()).then(res => { if (!res.ok) throw new Error(res.error); live.cfg.config = res.config; if (res.airports) live.cfg.airports = res.airports; msgEl.textContent = 'Saved.'; return res; })
      .catch(e => { msgEl.textContent = 'Not saved: ' + e.message; });
    const cs = $('#cfgSave');
    if (cs) cs.onclick = () => post({ xpHost: $('#cfgHost').value || 'auto', udpPort: +$('#cfgUdp').value, webApiPort: +$('#cfgWeb').value }, $('#cfgMsg'));
    const rs = $('#rootSave');
    if (rs) rs.onclick = () => post({ xpRoot: $('#cfgRoot').value }, $('#rootMsg')).then(res => { if (res && res.airports) $('#rootMsg').textContent = res.airports.state + (res.airports.root ? ' · ' + res.airports.root : ''); });
    const kv = () => {
      const k = $('#connKv'); if (!k) return;
      const x = live.bridgeState && live.bridgeState.xp;
      if (!x) { k.innerHTML = '<dt>Status</dt><dd>starting…</dd>'; return; }
      k.innerHTML = `<dt>Status</dt><dd>${x.connected ? 'connected via ' + esc(x.via) : 'waiting for X-Plane'}</dd><dt>X-Plane</dt><dd>${esc(x.version || '—')} at ${esc(x.host)}</dd>
        <dt>Web API</dt><dd>${esc(x.webapi)}</dd><dt>UDP</dt><dd>${esc(x.udp)}</dd><dt>Beacon</dt><dd>${esc(x.beacon)}${x.discovered ? ' · found ' + esc(x.discovered.name || '') + ' at ' + esc(x.discovered.ip) : ''}</dd>`;
    };
    kv();
    let lastKv = 0;
    return { tick() { const now = Date.now(); if (now - lastKv > 1000) { lastKv = now; kv(); } } };
  }

  // ================================================================== BOOT
  applyTheme();
  $('#themeBtn').onclick = () => { settings.theme = isDark() ? 'light' : 'dark'; saveSettings(); applyTheme(); if (currentRoute.view === 'settings') renderSettings(); };
  window.addEventListener('hashchange', route);
  if (!plan.forProfile) resetPlanFor(currentProfile());
  route();
  connect();
  X.app = { live, plan, settings, route, toast, tex };
})();

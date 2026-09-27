/* XP Flight Computer — study library
 * Each topic renders HTML with figures, numbered equations, variable tables, a worked example
 * computed with the same functions the calculators use, and where the value lives in X-Plane.
 */
(function (root) {
  'use strict';
  const R = String.raw;
  const Fg = () => root.XFC.figures;

  const chapters = [
    { id: 'pof', no: '1', title: 'Principles of flight' },
    { id: 'atm', no: '2', title: 'Atmosphere & altimetry' },
    { id: 'spd', no: '3', title: 'Airspeed' },
    { id: 'nav', no: '4', title: 'Navigation' },
    { id: 'perf', no: '5', title: 'Airliner performance' }
  ];

  /** Build small HTML helpers bound to the app context (tex renderer, formatters). */
  function kit(ctx) {
    let n = 0;
    const eqNo = [];
    return {
      p: s => `<p>${s}</p>`,
      lead: s => `<p class="lead">${s}</p>`,
      h: s => `<h2>${s}</h2>`,
      fig: (svg, cap) => `<figure class="fig"><div class="draw">${svg}</div><figcaption>${cap}</figcaption></figure>`,
      eq: (t, no) => { n++; eqNo.push(no); return `<div class="eqn"><div class="m">${ctx.tex(t, true)}</div><div class="no">${no ? '(' + no + ')' : ''}</div></div>`; },
      m: t => ctx.tex(t, false),
      vars: rows => `<table class="vars"><tbody>${rows.map(([a, b]) => `<tr><td>${ctx.tex(a, false)}</td><td>${b}</td></tr>`).join('')}</tbody></table>`,
      box: (title, html, cls = '') => `<div class="box ${cls}"><h3>${title}</h3>${html}</div>`,
      ul: items => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`,
      tryit: links => `<div class="tryit">${links.map(([id, l]) => `<a class="btn" href="#calc.${id}">${l} →</a>`).join('')}</div>`,
      code: s => `<code>${s}</code>`,
      n: (x, d = 0) => ctx.num(x, d)
    };
  }

  const topics = [];
  const T = t => topics.push(t);

  // ===================================================================== 1 · POF
  T({ id: 'forces', ch: 'pof', no: '1.1', title: 'The four forces and the lift equation', blurb: 'Lift, weight, thrust and drag — and the one equation behind them.',
    thumb: () => Fg().forces(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const isa = C.isa(35000), V = 450 * C.K.KT, W = 65000 * C.K.g0, S = 124.6;
      const q = 0.5 * isa.rho * V * V, cl = W / (q * S);
      return k.lead('An aircraft in steady flight is in balance: lift equals weight and thrust equals drag. Every performance number in this app starts from that balance.') +
        k.fig(Fg().forces(), '<b>Fig. 1.1</b> — The four forces. In unaccelerated level flight they cancel in pairs.') +
        k.p('Lift and drag both come from the air flowing past the aircraft. Their size depends on the air density, the square of the true airspeed, the wing area, and a coefficient that captures the wing’s shape and angle of attack:') +
        k.eq(R`L = \tfrac12\,\rho\,V^2\,S\,C_L`, '1.1') + k.eq(R`D = \tfrac12\,\rho\,V^2\,S\,C_D`, '1.2') +
        k.vars([[R`\rho`, 'air density, kg/m³ (1.225 at ISA sea level)'], ['V', 'true airspeed, m/s'], ['S', 'wing reference area, m²'], [R`C_L,\ C_D`, 'lift and drag coefficients (no units)'], [R`q = \tfrac12\rho V^2`, 'dynamic pressure, Pa — what the pitot tube feels']]) +
        k.p(`Because ${k.m(R`\tfrac12\rho V^2`)} appears in both, the ratio ${k.m('L/D')} depends only on the coefficients. A modern airliner cruises at ${k.m(R`L/D \approx 17`)}: to hold up 65 tonnes it needs only about 37 kN of thrust.`) +
        k.fig(Fg().airfoil(), '<b>Fig. 1.2</b> — Lift acts at right angles to the relative wind, drag along it. The angle between the chord and the relative wind is the angle of attack α.') +
        k.box('Worked example — 737-800 in cruise', k.p(`At FL350 (ISA density ${k.n(isa.rho, 4)} kg/m³), TAS 450 kt (${k.n(V, 1)} m/s), mass 65 t, wing area ${S} m²:`) +
          k.eq(R`q = \tfrac12 \times ${isa.rho.toFixed(4)} \times ${V.toFixed(1)}^2 = ${Math.round(q)}\ \text{Pa}`) +
          k.eq(R`C_L = \frac{W}{qS} = \frac{65\,000 \times 9.807}{${Math.round(q)} \times ${S}} = ${cl.toFixed(3)}`) +
          k.p('A cruise lift coefficient around 0.5 is typical — the wing flies at only a few degrees angle of attack.'), 'example') +
        k.box('In X-Plane', k.ul([
          `${k.code('sim/flightmodel/weight/m_total')} — the mass the lift has to carry (kg)`,
          `${k.code('sim/flightmodel/position/true_airspeed')} — V in m/s; ${k.code('sim/weather/rho')} — the density`,
          `${k.code('sim/flightmodel2/position/alpha')} — angle of attack. Watch it rise as you slow down in level flight.`]), 'xp');
    } });

  T({ id: 'lift-curve', ch: 'pof', no: '1.2', title: 'Angle of attack, flaps and the lift curve', blurb: 'Why slow flight needs a higher angle of attack, and what flaps and slats change.',
    thumb: () => Fg().liftCurve(),
    render(ctx) {
      const k = kit(ctx);
      return k.lead('For a given wing, the lift coefficient grows almost linearly with angle of attack — until the flow separates and the wing stalls.') +
        k.fig(Fg().liftCurve(), '<b>Fig. 1.3</b> — Lift curves. Flaps shift the curve up (more camber); slats let the wing reach a higher angle before it stalls.') +
        k.eq(R`C_L \approx a\,(\alpha - \alpha_0), \qquad a \approx 0.08\text{–}0.11\ \text{per degree}`, '1.3') +
        k.p(`Rearranging the lift equation for level flight (${k.m('L = W')}) shows why slow flight needs a high angle of attack:`) +
        k.eq(R`C_L = \frac{2W}{\rho V^2 S}`, '1.4') +
        k.p(`Halve the speed and ${k.m('C_L')} must quadruple. The highest value the wing can produce, ${k.m(R`C_{L\max}`)}, sets the stall speed. High-lift devices raise it:`) +
        k.ul(['Clean swept wing: about 1.3–1.6', 'Take-off flaps: about 1.8–2.2', 'Landing flaps with slats: about 2.3–3.0']) +
        k.p('The performance module uses effective values like these for each aircraft and flap setting, tuned so the speeds match typical published figures.') +
        k.box('In X-Plane', k.p(`Plot ${k.code('sim/flightmodel2/position/alpha')} against speed during a slow deceleration in level flight, then repeat with flaps: the same speed needs a lower α. The flap handle is ${k.code('sim/cockpit2/controls/flap_handle_request_ratio')}.`), 'xp');
    } });

  T({ id: 'stall', ch: 'pof', no: '1.3', title: 'Stall speed, weight and load factor', blurb: 'Stall speed rises with weight and with g — by the square root.',
    thumb: () => Fg().stallBank(),
    render(ctx) {
      const k = kit(ctx), s = ctx.s;
      const v1 = 48 * Math.sqrt(900 / 1157);
      const live = s && s.vsEst ? k.box('Right now in your aircraft', k.p(`Estimated stall speed ${k.n(s.vsEst)} kt at the current mass, ${k.n(s.vsTurn)} kt with the present bank (${k.n(s.nz, 2)} g). Indicated airspeed ${k.n(s.ias)} kt.`), 'xp') : '';
      return k.lead('The stall speed is the speed at which the wing, at its maximum lift coefficient, can just support the aircraft. It is not fixed.') +
        k.eq(R`V_S = \sqrt{\frac{2\,n\,W}{\rho_0\,S\,C_{L\max}}}`, '1.5') +
        k.vars([['n', 'load factor, g (1 in level flight)'], ['W', 'weight, N'], [R`\rho_0`, 'sea-level density — gives the speed as EAS ≈ CAS, which is why the stall IAS hardly changes with altitude'], [R`C_{L\max}`, 'maximum lift coefficient for the configuration']]) +
        k.h('Weight') + k.p('Only the square root of weight matters:') + k.eq(R`V_{S2} = V_{S1}\sqrt{W_2 / W_1}`, '1.6') +
        k.p(`A light single with ${k.m('V_{S0} = 48')} kt at 1157 kg stalls at ${k.n(v1, 1)} kt at 900 kg. Every airliner speed — V2, Vref, green dot — scales the same way.`) +
        k.h('Load factor') + k.p(`In a level turn the lift must be ${k.m(R`n = 1/\cos\phi`)} times the weight, so the stall speed grows by ${k.m(R`\sqrt n`)}:`) +
        k.fig(Fg().stallBank(), '<b>Fig. 1.4</b> — Load factor (magenta) and the stall-speed multiplier (blue) against bank angle, drawn to scale.') +
        k.ul(['30° bank: 1.15 g, stall speed +7 %', '45° bank: 1.41 g, stall speed +19 %', '60° bank: 2 g, stall speed +41 %']) +
        k.box('Certification speeds built on it', k.ul([`Take-off safety speed ${k.m(R`V_2 \ge 1.13\,V_{S1g}`)}`, `Landing reference speed ${k.m(R`V_{REF} = 1.23\,V_{S1g}`)} in the landing configuration`, 'Airbus VLS is the same 1.23 margin, computed live by the flight computers'])) +
        live + k.box('In X-Plane', k.p(`The app scales the aircraft file’s ${k.code('sim/aircraft/view/acf_Vs')} / ${k.code('acf_Vso')} (quoted at maximum weight) by ${k.m(R`\sqrt{W/W_{max}}`)} and the bank from ${k.code('sim/flightmodel/position/phi')}.`), 'xp') +
        k.tryit([['turn', 'Turn performance']]);
    } });

  T({ id: 'turning', ch: 'pof', no: '1.4', title: 'Turning flight', blurb: 'Rate, radius and the standard-rate turn.',
    thumb: () => Fg().turn(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const t = C.turn({ tas: 250, bank: 25 });
      return k.lead('To turn, the aircraft banks so that part of the lift pulls it sideways. The rest must still hold up the weight.') +
        k.fig(Fg().turn(), '<b>Fig. 1.5</b> — Left: the lift vector split into a vertical part that balances weight and a horizontal part that provides the turn. Right: the resulting circle.') +
        k.eq(R`L\cos\phi = W, \qquad L\sin\phi = \frac{m V^2}{r}`, '1.7') +
        k.p('Dividing one by the other removes the mass and gives the radius and rate of turn:') +
        k.eq(R`r = \frac{V^2}{g\tan\phi}, \qquad \omega = \frac{V}{r} = \frac{g\tan\phi}{V}`, '1.8') +
        k.p(`Radius grows with the square of speed: double the TAS and the circle is four times as wide. A rate-one (standard-rate) turn is ${k.m(R`3^\circ/\text{s}`)}, two minutes for a full circle; its bank angle is`) +
        k.eq(R`\phi_{3^\circ/s} = \arctan\!\left(\frac{3^\circ\cdot\frac{\pi}{180}\,V}{g}\right) \approx \frac{V_{TAS}}{10} + 7^\circ`, '1.9') +
        k.box('Worked example', k.p(`TAS 250 kt at 25° bank: radius ${k.n(t.radiusNm, 2)} NM (${k.n(t.radiusM)} m), rate ${k.n(t.rateDps, 2)} °/s, a full circle in ${k.n(t.time360s / 60, 1)} min, load factor ${k.n(t.n, 2)} g. Airliners limit bank to 25–30°, so above about 200 kt they turn slower than rate one.`), 'example') +
        k.tryit([['turn', 'Turn performance'], ['holding', 'Holding']]);
    } });

  T({ id: 'glide', ch: 'pof', no: '1.5', title: 'Gliding and the lift-to-drag ratio', blurb: 'How far you go from a height — and why weight does not change it.',
    thumb: () => Fg().glide(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const g = C.glide({ heightFt: 35000, ld: 17 });
      return k.lead('Without thrust, drag has to be balanced by a component of weight: the aircraft trades height for distance.') +
        k.fig(Fg().glide(), '<b>Fig. 1.6</b> — The glide triangle. The glide ratio is simply the lift-to-drag ratio.') +
        k.eq(R`\tan\gamma = \frac{D}{L} = \frac{1}{L/D} \quad\Rightarrow\quad d = h \cdot \frac{L}{D}`, '1.10') +
        k.p('Best range comes at the speed of maximum L/D (best-glide speed). A heavier aircraft has the same maximum L/D — it just reaches it at a higher speed — so still-air glide distance does not depend on weight. Wind changes the ground distance in proportion to GS/TAS.') +
        k.box('Worked example', k.p(`An airliner at 35 000 ft with ${k.m(R`L/D = 17`)} glides about ${k.n(g.distNm)} NM in still air, descending at ${k.n(g.angle, 1)}°.`), 'example') +
        k.tryit([['glide', 'Glide distance']]);
    } });

  // ===================================================================== 2 · ATM
  T({ id: 'isa', ch: 'atm', no: '2.1', title: 'The International Standard Atmosphere', blurb: 'The reference atmosphere every altimeter, airspeed indicator and chart assumes.',
    thumb: () => Fg().isa(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C, s = ctx.s;
      const i10 = C.isa(10000);
      const live = s && Number.isFinite(s.isaDev) ? k.box('Right now', k.p(`At pressure altitude ${k.n(s.pa)} ft ISA is ${k.n(s.isaT, 1)} °C; outside it is ${k.n(s.oat, 1)} °C, so ISA ${s.isaDev >= 0 ? '+' : ''}${k.n(s.isaDev, 1)} °C.`), 'xp') : '';
      return k.lead('ISA is an agreed model of an average atmosphere. Real air differs from it every day; the differences are exactly what the calculators correct for.') +
        k.fig(Fg().isa(), '<b>Fig. 2.1</b> — ISA temperature and pressure, plotted from the formulas below.') +
        k.ul(['Sea level: 15 °C, 1013.25 hPa, 1.225 kg/m³', 'Temperature falls 6.5 °C per km (1.98 °C per 1000 ft) up to the tropopause at 11 km (36 089 ft)', 'Above it, −56.5 °C constant to 20 km']) +
        k.h('Troposphere') + k.eq(R`T = T_0 - L\,h`, '2.1') + k.eq(R`P = P_0\left(\frac{T}{T_0}\right)^{\frac{g_0}{R L}} = P_0\left(1 - \frac{L h}{T_0}\right)^{5.2559}`, '2.2') +
        k.h('Above the tropopause') + k.eq(R`P = P_{11}\,\exp\!\left(-\frac{g_0\,(h - 11\,000)}{R\,T_{11}}\right)`, '2.3') +
        k.h('Density and the speed of sound') + k.eq(R`\rho = \frac{P}{R\,T}, \qquad a = \sqrt{\gamma R T}`, '2.4') +
        k.vars([['T_0,\ P_0', '288.15 K, 101 325 Pa'], ['L', 'lapse rate 0.0065 K/m'], ['R', '287.05 J/(kg·K), gas constant of dry air'], [R`g_0`, '9.80665 m/s²'], [R`\gamma`, '1.4 for air']]) +
        k.box('Worked example — 10 000 ft', k.p(`T = ${k.n(i10.Tc, 2)} °C, P = ${k.n(i10.hPa, 1)} hPa, ρ = ${k.n(i10.rho, 4)} kg/m³ (σ = ${k.n(i10.sigma, 3)}), speed of sound ${k.n(i10.akt, 1)} kt.`), 'example') +
        k.box('Rules of thumb', k.ul(['Pressure falls about 1 hPa per 27–30 ft near sea level', 'Pressure is half the sea-level value at about 18 000 ft', 'ISA temperature ≈ 15 − 2 × (altitude in thousands of feet)'])) +
        live + k.tryit([['isa', 'ISA at any altitude'], ['altitudes', 'Pressure & density altitude']]);
    } });

  T({ id: 'altimetry', ch: 'atm', no: '2.2', title: 'Altimeter settings: QNH, QFE and standard', blurb: 'What the altimeter really measures, and why the setting matters.',
    thumb: () => Fg().altimetry(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const pa = C.pressureAltitude(3000, 1003);
      return k.lead('An altimeter is a barometer with a scale in feet. It converts the static pressure to a height using the standard atmosphere, measured from whatever pressure level you set in the window.') +
        k.eq(R`h_{ind} = h_{ISA}(P_{static}) - h_{ISA}(P_{set}), \qquad h_{ISA}(P) = 145\,366\left[1 - \left(\tfrac{P}{1013.25}\right)^{0.1903}\right]\ \text{ft}`, '2.5') +
        k.fig(Fg().altimetry(), '<b>Fig. 2.2</b> — The same aircraft, three different readings depending on the setting.') +
        k.ul(['<b>QNH</b> — reads altitude above mean sea level (on the ground it shows airfield elevation). Used below the transition altitude.',
          '<b>QFE</b> — reads height above the airfield (zero on the runway).',
          '<b>Standard (1013.25 hPa / 29.92 inHg)</b> — reads pressure altitude; flight levels are pressure altitude in hundreds of feet. Used above the transition level so everyone shares one datum.']) +
        k.p(`Pressure altitude from an altimeter reading: ${k.m(R`PA = h_{ind} + h_{ISA}(\text{QNH})`)}. With QNH 1003 hPa and 3000 ft indicated, PA = ${k.n(pa)} ft — about 27 ft per hPa.`) +
        k.fig(Fg().highLow(), '<b>Fig. 2.3</b> — Flying towards low pressure without resetting the altimeter: the aircraft follows the sloping pressure surface down.') +
        k.box('In X-Plane', k.ul([`Your setting: ${k.code('sim/cockpit2/gauges/actuators/barometer_setting_in_hg_pilot')}`, `Actual QNH at the aircraft: ${k.code('sim/weather/aircraft/qnh_pas')}`, `Pressure altitude: ${k.code('sim/flightmodel2/position/pressure_altitude')}`, 'Press B for standard in most aircraft; the live panel shows STD when it is set.']), 'xp') +
        k.tryit([['altitudes', 'Pressure & density altitude']]);
    } });

  T({ id: 'density-altitude', ch: 'atm', no: '2.3', title: 'Density altitude and performance', blurb: 'Hot and high: the altitude the wing and engine actually feel.',
    thumb: () => Fg().densityAlt(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const d = C.densityAltitude(5000, 30);
      return k.lead('Density altitude is the height in the standard atmosphere where the density equals what you actually have. Wings and engines respond to density, so this is the altitude your aircraft performs at.') +
        k.eq(R`\rho = \frac{P(PA)}{R\,(OAT + 273.15)}, \qquad DA = \frac{T_0}{L}\left[1 - \left(\frac{\rho}{\rho_0}\right)^{0.2350}\right]`, '2.6') +
        k.eq(R`DA \approx PA + 118.8\,(OAT - T_{ISA})\ \text{ft}`, '2.7') +
        k.fig(Fg().densityAlt(), '<b>Fig. 2.4</b> — Density altitude against temperature for five pressure altitudes, from equation 2.6.') +
        k.p('Higher density altitude means the wing needs more true airspeed for the same lift, a normally aspirated engine makes less power, and a propeller bites less air. Take-off roll and climb both suffer.') +
        k.box('Worked example — hot day at a high airfield', k.p(`Pressure altitude 5000 ft, OAT 30 °C (ISA +${k.n(d.isaDev, 1)}): density altitude ${k.n(d.ft)} ft exactly, ${k.n(d.approxFt)} ft by the rule of thumb. The air is ${k.n((1 - d.sigma) * 100, 1)} % thinner than at ISA sea level.`), 'example') +
        k.box('Light-aircraft rules (UK CAA Safety Sense 7)', k.ul(['+1000 ft elevation: take-off distance ×1.10, landing ×1.05', '+10 °C: take-off ×1.10, landing ×1.05', '+10 % mass: take-off ×1.20, landing ×1.10', 'Dry grass: take-off ×1.20; wet grass ×1.30'])) +
        k.tryit([['altitudes', 'Density altitude'], ['ga-runway', 'Runway distances']]);
    } });

  T({ id: 'temperature-error', ch: 'atm', no: '2.4', title: 'Temperature error and cold-weather corrections', blurb: 'Cold air squeezes the pressure levels together — and your true altitude drops.',
    thumb: () => Fg().tempError(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const ct = C.coldTempCorrection({ heightFt: 1000, aerodromeTempC: -10, aerodromeElevFt: 0 });
      return k.lead('The altimeter assumes the air column below you has ISA temperatures. Cold air is denser, so the same pressure difference spans fewer feet: you are lower than indicated.') +
        k.fig(Fg().tempError(), '<b>Fig. 2.5</b> — Three air columns, each with the altimeter reading 3000 ft. In cold air the aircraft is lower than a ridge the chart says it clears.') +
        k.p('Integrating the hydrostatic equation through a layer that is ΔT warmer or colder than ISA gives the true height above the station:') +
        k.eq(R`\Delta h_{true} = \Delta h + \frac{\Delta T}{\lambda}\ln\!\left(1 + \frac{\lambda\,\Delta h}{T_0 + \lambda h_s}\right), \qquad \lambda = -0.0065\ \text{K/m}`, '2.8') +
        k.p('ICAO Doc 8168 publishes the simplified correction to add to minimum altitudes when the aerodrome is cold:') +
        k.eq(R`\text{Correction} = H\,\frac{15 - t_0}{273 + t_0 - 0.5\,L_0\,(H + H_{ss})}`, '2.9') +
        k.vars([['H', 'height above the altimeter-setting source'], ['t_0', 'aerodrome temperature reduced to sea level, °C'], ['L_0', '0.0065 °C/m'], ['H_{ss}', 'elevation of the altimeter-setting source']]) +
        k.box('Worked example', k.p(`Aerodrome at sea level, −10 °C (ISA −25). For a height of 1000 ft the accurate correction is ${k.n(ct.correctionFt)} ft (simplified formula ${k.n(ct.simplifiedFt)} ft; rule of thumb 4 % per 10 °C gives ${k.n(ct.ruleOfThumbFt)} ft).`), 'example') +
        k.box('In X-Plane', k.p(`X-Plane 12 models a real, non-standard atmosphere, so this error appears in the sim. It even exposes it: ${k.code('sim/weather/aircraft/altimeter_temperature_error')}. Compare the altimeter with ${k.code('sim/flightmodel/position/elevation')} on a cold day.`), 'xp') +
        k.tryit([['cold-temp', 'Cold temperature correction'], ['true-alt', 'True altitude']]);
    } });

  // ===================================================================== 3 · SPEED
  T({ id: 'airspeeds', ch: 'spd', no: '3.1', title: 'IAS, CAS, EAS, TAS and ground speed', blurb: 'Five speeds, one aircraft — what each one is for.',
    thumb: () => Fg().speedChain(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C, s = ctx.s;
      const r = C.casToTas(250, 10000, C.isaTempC(10000));
      const live = s && Number.isFinite(s.tasCalc) ? k.box('Right now', k.p(`CAS ${k.n(s.cas ?? s.ias)} kt at PA ${k.n(s.pa)} ft and ${k.n(s.oat, 1)} °C gives TAS ${k.n(s.tasCalc)} kt; X-Plane reports ${k.n(s.tas)} kt.`), 'xp') : '';
      return k.lead('The airspeed indicator measures a pressure, not a speed. Turning that pressure into the speed you move through the air takes three corrections.') +
        k.fig(Fg().pitot(), '<b>Fig. 3.1</b> — The pitot tube senses total pressure, the static port static pressure; their difference is the impact pressure q<sub>c</sub>.') +
        k.fig(Fg().speedChain(), '<b>Fig. 3.2</b> — From indicated to ground speed.') +
        k.ul(['<b>IAS</b> — what the needle shows.', '<b>CAS</b> — IAS corrected for instrument and position error. The indicator is calibrated so that CAS = TAS at ISA sea level.',
          '<b>EAS</b> — CAS corrected for compressibility of the air in the pitot (noticeable above about 200 kt and 10 000 ft).',
          '<b>TAS</b> — the real speed through the air. Navigation and the wind triangle use TAS.', '<b>GS</b> — TAS plus the wind: speed over the ground.']) +
        k.h('The exact relationship') + k.p('Subsonic compressible flow (Saint-Venant) links impact pressure to CAS, using sea-level values:') +
        k.eq(R`q_c = P_0\left[\left(1 + 0.2\left(\frac{V_c}{a_0}\right)^2\right)^{3.5} - 1\right]`, '3.1') +
        k.p('and to the Mach number, using the actual static pressure:') +
        k.eq(R`M = \sqrt{5\left[\left(\frac{q_c}{P} + 1\right)^{2/7} - 1\right]}, \qquad V_{TAS} = M\,a = M\sqrt{\gamma R T}`, '3.2') +
        k.eq(R`V_{EAS} = V_{TAS}\sqrt{\rho/\rho_0}`, '3.3') +
        k.box('Worked example', k.p(`CAS 250 kt at FL100 in ISA: Mach ${r.mach.toFixed(4)}, TAS ${k.n(r.tas, 1)} kt, EAS ${k.n(r.eas, 1)} kt. The rule of thumb (TAS = CAS + 2 % per 1000 ft) gives 300 kt — close, but 11 kt high.`), 'example') +
        live + k.box('In X-Plane', k.ul([`${k.code('sim/cockpit2/gauges/indicators/airspeed_kts_pilot')} — IAS`, `${k.code('sim/cockpit2/gauges/indicators/calibrated_airspeed_kts_pilot')} — CAS`, `${k.code('sim/flightmodel/position/true_airspeed')} — TAS (m/s)`, `${k.code('sim/flightmodel/position/groundspeed')} — GS (m/s)`]), 'xp') +
        k.tryit([['airspeed', 'Airspeed converter']]);
    } });

  T({ id: 'mach', ch: 'spd', no: '3.2', title: 'Mach number, TAT and the crossover altitude', blurb: 'Why jets climb on CAS and cruise on Mach.',
    thumb: () => Fg().crossover(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const xo = C.crossoverAltitude(290, 0.78).ft;
      const a0 = C.speedOfSoundKt(15), a11 = C.speedOfSoundKt(-56.5);
      return k.lead('The speed of sound depends only on temperature. At high altitude it is lower, so the same TAS is a higher Mach number — and the wing’s limits are set by Mach.') +
        k.eq(R`a = \sqrt{\gamma R T} \;\approx\; 38.94\sqrt{T}\ \text{kt}, \qquad M = \frac{V_{TAS}}{a}`, '3.4') +
        k.p(`At ISA sea level ${k.m('a')} = ${k.n(a0, 1)} kt; at the tropopause (−56.5 °C) only ${k.n(a11, 1)} kt.`) +
        k.h('Crossover altitude') +
        k.p('Climbing at a constant CAS, the TAS rises while the speed of sound falls, so Mach climbs quickly. At some altitude the chosen Mach is reached; above it the aircraft holds Mach instead. Both speeds need the same impact pressure there, which gives a closed form:') +
        k.eq(R`P_x = \frac{P_0\left[\left(1 + 0.2 (V_c/a_0)^2\right)^{3.5} - 1\right]}{(1 + 0.2 M^2)^{3.5} - 1}`, '3.5') +
        k.fig(Fg().crossover(), `<b>Fig. 3.3</b> — Constant 290 kt CAS and constant M0.78, with the crossover at about FL${Math.round(xo / 100)}. Temperature does not move it: it is a pressure altitude.`) +
        k.h('Total air temperature') +
        k.p('A temperature probe brings the air to rest, turning kinetic energy into heat. It reads the total air temperature, higher than the static (outside) temperature:') +
        k.eq(R`TAT = SAT\,(1 + 0.2\,r\,M^2)\quad (\text{Kelvin, recovery factor } r \approx 1)`, '3.6') +
        k.p('At M0.80 and −50 °C, the ram rise is about 29 °C. The FMS needs SAT for TAS and performance, so it uses this equation in reverse.') +
        k.box('In X-Plane', k.ul([`${k.code('sim/flightmodel/misc/machno')} — Mach`, `${k.code('sim/weather/aircraft/temperature_ambient_deg_c')} — SAT`, `${k.code('sim/weather/aircraft/temperature_leadingedge_deg_c')} — close to TAT`]), 'xp') +
        k.tryit([['crossover', 'Crossover altitude'], ['tat-sat', 'TAT ⇄ SAT']]);
    } });

  // ===================================================================== 4 · NAV
  T({ id: 'wind-triangle', ch: 'nav', no: '4.1', title: 'The wind triangle', blurb: 'Heading, track, drift and ground speed — vector addition in the sky.',
    thumb: () => Fg().windTriangle(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const w = C.windTriangle({ tas: 120, course: 90, windFrom: 40, windSpeed: 25 });
      return k.lead('The aircraft moves through the air, and the air moves over the ground. Your path over the ground is the sum of the two vectors.') +
        k.fig(Fg().windTriangle(), '<b>Fig. 4.1</b> — Air vector (heading, TAS) plus wind vector equals ground vector (track, GS). Drawn to scale.') +
        k.p('Let θ be the angle between the wind direction (where it blows from) and the course. The sine rule in the triangle gives the wind correction angle, and the along-track components give the ground speed:') +
        k.eq(R`\mathrm{WCA} = \arcsin\!\left(\frac{V_w\sin(\theta_w - \theta_c)}{V_{TAS}}\right)`, '4.1') +
        k.eq(R`GS = V_{TAS}\cos\mathrm{WCA} - V_w\cos(\theta_w - \theta_c)`, '4.2') +
        k.eq(R`\mathrm{HDG} = \theta_c + \mathrm{WCA}, \qquad \text{drift} = \mathrm{TRK} - \mathrm{HDG}`, '4.3') +
        k.box('Worked example', k.p(`TAS 120 kt, course 090°, wind 040°/25 kt: WCA ${k.n(w.wca, 1)}°, heading ${ctx.hdg(w.heading)}, ground speed ${k.n(w.gs, 1)} kt. The largest drift this wind can cause is ${k.m(R`\arcsin(25/120)`)} = ${k.n(C.deg(Math.asin(25 / 120)), 1)}°.`), 'example') +
        k.box('Rules of thumb', k.ul(['Max drift ≈ wind speed × 60 / TAS (degrees)', 'Actual drift ≈ max drift × sin(wind angle)', 'Winds in METARs and forecasts are true; ATIS and tower winds are magnetic'])) +
        k.box('In X-Plane', k.p(`Heading ${k.code('sim/flightmodel/position/psi')} and track ${k.code('sim/flightmodel/position/hpath')} differ by the drift; the live panel shows it. The wind at the aircraft is ${k.code('sim/weather/aircraft/wind_now_direction_degt')} / ${k.code('wind_now_speed_msc')}.`), 'xp') +
        k.tryit([['wind-triangle', 'Wind triangle'], ['find-wind', 'Find the wind']]);
    } });

  T({ id: 'crosswind', ch: 'nav', no: '4.2', title: 'Headwind and crosswind components', blurb: 'Splitting the wind along and across the runway.',
    thumb: () => Fg().crosswind(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const w = C.windComponents(303, 20, 263);
      return k.lead('For take-off and landing only two parts of the wind matter: along the runway (head or tail) and across it.') +
        k.fig(Fg().crosswind(), '<b>Fig. 4.2</b> — Resolving a 20 kt wind 40° off the runway.') +
        k.eq(R`HW = V_w\cos\alpha, \qquad XW = V_w\sin\alpha`, '4.4') +
        k.p(`α is the angle between the wind and the runway heading. For wind 303°/20 kt on runway 26 (263°): headwind ${k.n(w.head, 1)} kt, crosswind ${k.n(w.cross, 1)} kt from the right. With gusts, use the gust value for the crosswind check.`) +
        k.ul(['Runway numbers are magnetic heading ÷ 10, rounded.', 'Most aircraft are limited to about 10 kt of tailwind; crosswind limits are in the flight manual (“maximum demonstrated”).', 'Airliner performance counts only 50 % of a headwind but 150 % of a tailwind — a built-in safety margin.']) +
        k.tryit([['crosswind', 'Runway wind components']]);
    } });

  T({ id: 'great-circle', ch: 'nav', no: '4.3', title: 'Great circles and the 1-in-60 rule', blurb: 'The shortest way round the Earth, and a mental-maths shortcut.',
    thumb: () => Fg().greatCircle(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const g = C.greatCircle(40.6398, -73.7789, 51.47, -0.4543);
      return k.lead('The shortest path between two points on a sphere is an arc of a great circle — a circle whose centre is the centre of the Earth. Its course changes as you fly it.') +
        k.fig(Fg().greatCircle(), '<b>Fig. 4.3</b> — On a Mercator chart the great circle bows towards the pole; the straight line (rhumb line) keeps one course but is longer.') +
        k.eq(R`a = \sin^2\frac{\Delta\varphi}{2} + \cos\varphi_1\cos\varphi_2\sin^2\frac{\Delta\lambda}{2}, \qquad d = 2R\,\operatorname{atan2}\!\left(\sqrt a, \sqrt{1-a}\right)`, '4.5') +
        k.eq(R`\theta_0 = \operatorname{atan2}\!\left(\sin\Delta\lambda\cos\varphi_2,\ \cos\varphi_1\sin\varphi_2 - \sin\varphi_1\cos\varphi_2\cos\Delta\lambda\right)`, '4.6') +
        k.vars([[R`\varphi,\ \lambda`, 'latitude, longitude'], ['R', 'mean Earth radius, 3440 NM'], ['1\\ \\text{NM}', '1852 m = one minute of latitude']]) +
        k.box('Worked example', k.p(`New York JFK to London Heathrow: ${k.n(g.distNm)} NM great circle, initial course ${ctx.hdg(g.initial)} true, arriving on ${ctx.hdg(g.final)}.`), 'example') +
        k.h('The 1-in-60 rule') + k.p(`Because ${k.m(R`\sin 1^\circ \approx 1/57`)}, an error of 1 NM after 60 NM is about 1°. To regain track at the destination, turn back by the track error plus the closing angle:`) +
        k.eq(R`\Delta\mathrm{HDG} = \frac{60\,x}{d_{flown}} + \frac{60\,x}{d_{to\,go}}`, '4.7') +
        k.tryit([['great-circle', 'Great-circle distance'], ['one-in-sixty', '1-in-60'], ['tsd', 'Time · speed · distance']]);
    } });

  T({ id: 'holding', ch: 'nav', no: '4.4', title: 'Holding patterns and entries', blurb: 'Racetracks, entry sectors, timing and wind correction.',
    thumb: () => Fg().holding(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const e = C.holdingEntry({ inbound: 90, heading: 210, turn: 'R' });
      return k.lead('A hold is a racetrack around a fix: an inbound leg to the fix, a 180° turn, an outbound leg and another turn. Standard holds turn right.') +
        k.fig(Fg().holding(), '<b>Fig. 4.4</b> — A right-hand hold with inbound course 360°. The shaded sectors show the direction you arrive <b>from</b> (your heading points from the sector to the fix). Within 5° of a boundary either entry is allowed.') +
        k.h('Choosing the entry') +
        k.p(`The entry depends on your heading when you reach the fix. Take the difference ${k.m(R`\Delta = \mathrm{HDG} - \mathrm{INB}`)} (0–360°). For a right-hand hold:`) +
        k.ul([`${k.m(R`110^\circ \le \Delta \le 180^\circ`)} — <b>teardrop</b>: fly outbound 30° into the holding side, then turn in.`, `${k.m(R`180^\circ < \Delta \le 290^\circ`)} — <b>parallel</b>: fly outbound on the non-holding side, then turn back through more than 180°.`, 'otherwise — <b>direct</b>: turn straight onto the outbound leg.']) +
        k.p('For a left-hand hold the picture is mirrored: parallel 70°–180°, teardrop 180°–250°. ICAO allows ±5° either side of a sector boundary.') +
        k.box('Worked example', k.p(`Right-hand hold, inbound 090°, arriving on heading 210°: Δ = ${k.n(e.diff)}°, so a ${e.entry} entry. Outbound course ${ctx.hdg(e.outbound)}, teardrop heading ${ctx.hdg(e.teardropHeading)}.`), 'example') +
        k.h('Timing, speed and wind') + k.ul(['Inbound leg 1 minute at or below 14 000 ft, 1½ minutes above (ICAO)', 'Maximum speeds (ICAO): 230 kt to 14 000 ft, 240 kt to 20 000 ft, 265 kt to 34 000 ft, then M0.83', 'Outbound heading: apply three times the inbound wind correction angle', 'Outbound time: adjust by about 1 s per knot of wind along the inbound course']) +
        k.tryit([['holding', 'Holding entry & timing']]);
    } });

  T({ id: 'descent', ch: 'nav', no: '4.5', title: 'Climb and descent planning', blurb: 'Top of descent, 3° paths and climb gradients.',
    thumb: () => Fg().descent(),
    render(ctx) {
      const k = kit(ctx), C = ctx.C;
      const d = C.descent({ fromFt: 36000, toFt: 3000, gs: 380, angleDeg: 3, decelNm: 10 });
      return k.lead('A descent is a path in the vertical plane. Pick an angle, and the distance and the rate follow from the geometry.') +
        k.fig(Fg().descent(), '<b>Fig. 4.5</b> — Top of descent, a 3° path and a level segment to slow down.') +
        k.eq(R`D = \frac{\Delta H}{6076\,\tan\gamma}\ \text{NM}, \qquad VS = GS \cdot \frac{6076}{60}\tan\gamma\ \text{fpm}`, '4.8') +
        k.p(`For 3°, ${k.m(R`\tan 3^\circ = 0.0524`)}: 318 ft per NM, and ${k.m(R`VS \approx 5.3 \times GS`)}. That is where the “3 NM per 1000 ft” and “5 × ground speed” rules come from.`) +
        k.box('Worked example', k.p(`From FL360 to 3000 ft at 380 kt ground speed: the 3° path is ${k.n(d.pathNm)} NM; with 10 NM to slow down, start ${k.n(d.distNm)} NM out and descend at about ${k.n(d.vs)} fpm for ${k.n(d.timeMin)} minutes.`), 'example') +
        k.h('Climb gradients') + k.p('Departure procedures give a minimum climb gradient. Convert it to a rate for your ground speed:') +
        k.eq(R`\text{ft/NM} = \frac{\%}{100} \times 6076, \qquad ROC = \text{ft/NM} \times \frac{GS}{60}`, '4.9') +
        k.p('A 3.3 % gradient (the standard obstacle surface plus margin) is 200 ft/NM: 533 fpm at 160 kt.') +
        k.box('In X-Plane', k.p(`The default FMS publishes its distance to top of descent in ${k.code('sim/cockpit2/radios/indicators/fms_distance_to_tod_pilot')}; the live panel shows it next to the 3° rate for your current ground speed.`), 'xp') +
        k.tryit([['descent', 'Top of descent'], ['vpath', 'Vertical path to a fix'], ['climb-gradient', 'Climb gradient']]);
    } });

  // ===================================================================== 5 · PERF
  T({ id: 'mass-balance', ch: 'perf', no: '5.1', title: 'Mass and balance', blurb: 'Weights, limits and where the centre of gravity sits.',
    thumb: () => Fg().massBalance(),
    render(ctx) {
      const k = kit(ctx);
      return k.lead('Two questions before every flight: is the aircraft too heavy, and is the weight in the right place?') +
        k.fig(Fg().massBalance(), '<b>Fig. 5.1</b> — Each load acts at its arm from the datum. The CG is where the whole aircraft would balance.') +
        k.eq(R`x_{CG} = \frac{\sum m_i\,x_i}{\sum m_i}`, '5.1') + k.eq(R`\%\mathrm{MAC} = \frac{x_{CG} - x_{LEMAC}}{\bar c} \times 100`, '5.2') +
        k.p('A forward CG makes the aircraft more stable but needs more tail download, which raises the stall speed and fuel burn. An aft CG is lighter on the controls and less stable. Both have limits.') +
        k.h('Airliner weights') +
        k.ul(['<b>DOW</b> — dry operating weight: empty aircraft plus crew, catering, water', '<b>ZFW</b> — DOW + payload. Limited by <b>MZFW</b>: fuel in the wings relieves bending, so above this, extra weight must be fuel.', '<b>TOW</b> — ZFW + take-off fuel. Limited by <b>MTOW</b> (structure and performance).', '<b>LW</b> — TOW − trip fuel. Limited by <b>MLW</b> (landing gear and structure).']) +
        k.p('The allowed take-off weight is the smallest of MTOW, MZFW + take-off fuel and MLW + trip fuel; the gap to the actual weight is the underload you could still carry. EASA standard masses: 84 kg per adult passenger including hand baggage.') +
        k.tryit([['wb', 'Mass & balance']]) + '<div class="tryit"><a class="btn" href="#perf.load">Load sheet →</a></div>';
    } });

  T({ id: 'takeoff', ch: 'perf', no: '5.2', title: 'Take-off: V1, VR, V2 and field length', blurb: 'The speeds that decide go or stop, and how long the runway must be.',
    thumb: () => Fg().takeoff(),
    render(ctx) {
      const k = kit(ctx), P = ctx.P, p = ctx.profile;
      const m = Math.round(p.mtow * 0.88);
      const sp = P.takeoffSpeeds(p, m, null);
      return k.lead('A multi-engine take-off is planned so that an engine failure at any moment leaves a safe choice: stop on the runway, or continue and climb away.') +
        k.fig(Fg().takeoff(), '<b>Fig. 5.2</b> — Take-off speeds and what happens if an engine fails before or after V1.') +
        k.ul(['<b>V1</b> — decision speed. The fastest you can start a rejected take-off and stop in the distance available, and the slowest at which you can continue.', '<b>VR</b> — rotation speed.', '<b>V2</b> — take-off safety speed, reached by 35 ft with one engine out: at least 1.13 × the 1-g stall speed and 1.1 × VMCA.', '<b>VMCG / VMCA</b> — minimum control speeds on the ground and in the air with the critical engine failed.']) +
        k.eq(R`V_{S1g} = \sqrt{\frac{2W}{\rho_0 S C_{L\max,TO}}}, \qquad V_2 \ge 1.13\,V_{S1g}`, '5.3') +
        k.h('Field length') + k.p('The runway must cover the take-off distance (to 35 ft, all engines ×1.15 or one engine out) and the accelerate-stop distance. The ground roll grows with the square of lift-off speed and falls with acceleration, which gives the classic scaling the app uses:') +
        k.eq(R`\text{TOFL} \propto \frac{W^2}{\sigma\,S\,C_{L\max}\,T}`, '5.4') +
        k.ul(['Heavier: ×(W/W₀)² — 10 % heavier ≈ 21 % longer', 'Hot or high: thinner air needs more TAS and the engines give less thrust', 'More flap: lower speeds, shorter run (but worse climb)', 'Wind: 50 % of headwind, 150 % of tailwind; uphill slope and wet runways lengthen it']) +
        k.box(`Worked example — ${p.name}`, k.p(`At ${k.n(m / 1000, 1)} t with ${p.policy === 'airbus' ? 'CONF' : 'flaps'} ${sp.flap}: ${k.m(R`V_{S1g}`)} = ${k.n(sp.vs1g)} kt → V1 ${k.n(sp.v1)}, VR ${k.n(sp.vr)}, V2 ${k.n(sp.v2)} kt.`), 'example') +
        '<div class="tryit"><a class="btn" href="#perf.takeoff">Take-off calculator →</a></div>';
    } });

  T({ id: 'flex', ch: 'perf', no: '5.3', title: 'Reduced thrust: assumed temperature and FLEX', blurb: 'Using less thrust when the runway allows — and why it saves engines.',
    thumb: () => Fg().flex(),
    render(ctx) {
      const k = kit(ctx), P = ctx.P, p = ctx.profile;
      const fx = P.flexTemp(p, { mass: Math.round(p.mtow * 0.82), flap: null, elevFt: 0, qnh: 1013.25, oatC: 15, headwind: 5, slopePct: 0, surface: 'dry', toraM: Math.round(p.toflRef * 1.35) });
      return k.lead('Most take-offs do not need full thrust. Telling the engines it is hotter than it is gives exactly the thrust the runway requires — and much less engine wear.') +
        k.fig(Fg().flex(), '<b>Fig. 5.3</b> — A flat-rated engine gives constant thrust up to its flat-rating temperature, then less. The assumed temperature is where available thrust meets the thrust needed.') +
        k.p(`Jet engines are flat-rated: thrust is held constant up to a temperature (about ISA+15, 30 °C at sea level), then falls — roughly ${(P.THRUST_LAPSE_PER_C * 100).toFixed(2)} % per °C in this app’s model. The performance calculation is also done at the assumed temperature, so the thinner air makes it conservative.`) +
        k.eq(R`T_{flex} = \max\left\{T : \text{TOFL}(W, T) \le \text{TORA},\ \ 1 - \frac{\text{Thrust}(T)}{\text{Thrust}(OAT)} \le 25\,\%\right\}`, '5.5') +
        k.ul(['Must be above the OAT and the flat-rating temperature, and below T MAX FLEX (about ISA + 55)', 'Maximum reduction 25 % of full thrust', 'Not allowed on contaminated runways', 'Airbus calls it FLEX; Boeing uses assumed temperature, often combined with fixed derates (TO-1, TO-2)']) +
        k.box(`Worked example — ${p.name}`, k.p(fx.flex != null ? `At 82 % of MTOW on a ${k.n(Math.round(p.toflRef * 1.35))} m runway at sea level, 15 °C: full-thrust field length ${k.n(fx.toga.tofl)} m; assumed temperature ${fx.flex} °C cuts thrust by ${k.n(fx.reduction * 100)} % and still needs only ${k.n(fx.flexDist.tofl)} m (limited by ${fx.limitedBy}).` : 'No reduced thrust possible in this example.'), 'example') +
        '<div class="tryit"><a class="btn" href="#perf.takeoff">Take-off calculator →</a></div>';
    } });

  T({ id: 'landing', ch: 'perf', no: '5.4', title: 'Landing: Vref, Vapp and landing distance', blurb: 'Approach speeds, wind additives and stopping on the runway.',
    thumb: () => Fg().landing(),
    render(ctx) {
      const k = kit(ctx), P = ctx.P, p = ctx.profile;
      const m = Math.round(p.mlw * 0.9);
      const ls = P.landingSpeeds(p, m, null, { headwind: 15 });
      const ab = (p.autobrake || [])[1] || (p.autobrake || [])[0];
      const ld = P.landingDistance(p, { mass: m, flap: null, elevFt: 0, qnh: 1013.25, oatC: 15, headwind: 15, slopePct: 0, surface: 'dry', decel: ab ? ab.d : 2, reverse: true });
      return k.lead('Landing speeds are margins above the stall; landing distances are margins on top of physics.') +
        k.eq(R`V_{REF} = 1.23\,V_{S1g,\,LDG}`, '5.6') +
        k.p('Airbus calls this VLS. The approach speed adds a wind margin for gusts and shear:') +
        k.ul([`Boeing: ${k.m(R`V_{app} = V_{REF} + \max\!\left(5,\ \tfrac12 HW + \text{gust}\right)`)}, at most +20 kt`, `Airbus: ${k.m(R`V_{APP} = V_{LS} + \max\!\left(5,\ \tfrac13 HW\right)`)}, at most +15 kt`]) +
        k.fig(Fg().landing(), '<b>Fig. 5.4</b> — From 50 ft over the threshold to a stop.') +
        k.eq(R`\text{ALD} = d_{air} + d_{transition} + \frac{V_{td}^2}{2a}`, '5.7') +
        k.p('Autobrake holds a set deceleration, so reverse thrust only reduces brake wear — unless braking is already at the friction limit (MAX or manual on a slippery runway), where reversers do shorten the stop.') +
        k.ul(['<b>At dispatch</b>: certified distance ÷ 0.6 (×1.67) must fit; wet runway ×1.15 more', '<b>In flight</b>: actual landing distance × 1.15 must fit the runway']) +
        k.box(`Worked example — ${p.name}`, k.p(`At ${k.n(m / 1000, 1)} t, ${p.policy === 'airbus' ? 'CONF' : 'flaps'} ${ls.flap}, 15 kt headwind: ${ls.name} ${k.n(ls.vref)} kt + ${k.n(ls.add)} = ${k.n(ls.vapp)} kt. With ${ab ? ab.id : 'braking'} (${ab ? ab.d.toFixed(2) : '—'} m/s²) the actual landing distance is about ${k.n(ld.ald)} m (${k.n(ld.factored)} m with the 15 % margin).`), 'example') +
        '<div class="tryit"><a class="btn" href="#perf.landing">Landing calculator →</a></div>';
    } });

  T({ id: 'fuel', ch: 'perf', no: '5.5', title: 'Fuel planning', blurb: 'Trip, contingency, alternate, final reserve — and why each exists.',
    thumb: () => Fg().fuel(),
    render(ctx) {
      const k = kit(ctx), P = ctx.P, p = ctx.profile;
      const fp = P.fuelPlan(p, { distNm: 500, cruiseFt: Math.min(35000, p.ceilingFt - 3000), altNm: 100, contPct: 5, finalResMin: 30 });
      return k.lead('Fuel is planned in layers, each covering a different risk. ICAO Annex 6 and EASA use the same structure.') +
        k.fig(Fg().fuel(), '<b>Fig. 5.5</b> — Block fuel for a short 737 sector.') +
        k.ul(['<b>Taxi</b> — start-up and taxi to the runway', '<b>Trip</b> — take-off, climb, cruise, descent, approach and landing at destination', '<b>Contingency</b> — 5 % of trip (at least 5 min holding) for the unforeseen: winds, reroutes, levels', '<b>Alternate</b> — go-around at destination, climb, cruise and landing at the alternate', '<b>Final reserve</b> — 30 min holding at 1500 ft for turbine aircraft (45 min for piston)', '<b>Extra</b> — the commander’s choice: weather, traffic, tankering']) +
        k.eq(R`\text{Block} = \text{Taxi} + \text{Trip} + \text{Cont} + \text{Alt} + \text{Final} + \text{Extra}`, '5.8') +
        k.eq(R`\text{Trip} \approx t_{climb}\,\dot m_{climb} + \frac{D_{cruise}}{GS}\,\dot m_{cruise} + t_{desc}\,\dot m_{idle} + \text{approach}`, '5.9') +
        k.box(`Worked example — ${p.name}`, k.p(`500 NM with a 100 NM alternate: trip ${k.n(fp.trip.fuel)} kg in ${k.n(fp.trip.time)} min, contingency ${k.n(fp.contingency)} kg, alternate ${k.n(fp.alternate.fuel)} kg, final reserve ${k.n(fp.finalReserve)} kg, taxi ${k.n(fp.taxi)} kg → block ${k.n(fp.block)} kg.`), 'example') +
        k.box('Handy numbers', k.ul(['Jet fuel ≈ 0.80 kg/L (6.7 lb/US gal); AvGas ≈ 0.72 kg/L (6.0 lb/US gal)', 'Carrying extra fuel burns fuel: roughly 3–4 % of the extra per flight hour']), '') +
        k.box('In X-Plane', k.p(`Fuel on board ${k.code('sim/flightmodel/weight/m_fuel_total')} (kg) and flow ${k.code('sim/cockpit2/engine/indicators/fuel_flow_kg_sec')} (per engine) give the live endurance and range.`), 'xp') +
        '<div class="tryit"><a class="btn" href="#perf.fuel">Fuel plan →</a><a class="btn" href="#calc.fuel">Endurance & range →</a></div>';
    } });

  root.XFC.study = { chapters, topics };
})(typeof self !== 'undefined' ? self : this);

/* XP Flight Computer — airliner performance models
 * First-principles estimates tuned to typical published figures. For simulation and study only.
 * Masses kg, speeds kt (CAS unless noted), distances m (runway) / NM (route), temperatures °C.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const calc = isNode ? require('./calc.js') : root.XFC.calc;
  const mod = factory(calc);
  if (isNode) module.exports = mod;
  if (root) { root.XFC = root.XFC || {}; root.XFC.perf = mod; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (C) {
  'use strict';
  const K = C.K;
  const G = K.g0;
  const THRUST_LAPSE_PER_C = 0.0063;   // thrust loss per °C above the flat-rating temperature
  const MAX_FLEX_REDUCTION = 0.25;     // assumed-temperature thrust reduction limit
  const MAX_FLEX_ISA_PLUS = 55;        // typical T_MAX FLEX = ISA + 55 °C
  const SURFACE = {
    dry: { name: 'Dry', mu: 0.40, toF: 1.0 },
    wet: { name: 'Wet', mu: 0.20, toF: 1.10 },
    contaminated: { name: 'Contaminated (snow/slush/water)', mu: 0.12, toF: 1.25 }
  };

  const flapOf = (list, id) => (list || []).find(f => f.id === id) || (list || []).find(f => f.def) || (list || [])[0];

  /** 1-g stall speed (kt EAS≈CAS) from the lift equation: Vs = √(2W / (ρ0·S·CLmax)). */
  function stallSpeed(massKg, wingArea, cl) {
    return Math.sqrt(2 * massKg * G / (K.rho0 * wingArea * cl)) / K.KT;
  }

  /** Field air density from elevation, QNH and temperature. */
  function fieldAir(elevFt, qnhHPa, tempC) {
    const pa = C.pressureAltitude(elevFt, qnhHPa);
    const P = C.isa(pa).P;
    const rho = P / (K.R * (tempC + 273.15));
    return { pa, P, delta: P / K.P0, rho, sigma: rho / K.rho0, isaT: C.isaTempC(pa) };
  }

  // ------------------------------------------------------------------ take-off
  function takeoffSpeeds(p, mass, flapId, opts = {}) {
    const f = flapOf(p.takeoffFlaps, flapId);
    const vs = stallSpeed(mass, p.wingArea, f.cl);
    const vmcg = p.vmcg || 100, vmca = vmcg + 5;
    const v2 = Math.max(1.13 * vs, 1.10 * vmca);
    const vr = Math.max(v2 - (p.vr || 5), 1.05 * vmca);
    let v1 = vr - (opts.wet ? (p.v1Wet ?? 6) : (p.v1Dry ?? 2));
    const vmcgLimited = v1 < vmcg;
    v1 = Math.min(vr, Math.max(v1, vmcg));
    return { flap: f.id, cl: f.cl, vs1g: vs, v1, vr, v2, vmcg, vmcgLimited, vlof: vr + 0.5 * (v2 - vr) };
  }

  /** Relative thrust at a temperature (1 = flat-rated thrust at sea level). */
  function thrustRatio(p, air, thrustTempC) {
    const kink = air.isaT + ((p.flatC ?? 30) - 15);
    const tempF = thrustTempC > kink ? Math.max(0.3, 1 - THRUST_LAPSE_PER_C * (thrustTempC - kink)) : 1;
    return { ratio: air.delta * tempF, tempF, kink };
  }

  /**
   * Take-off field length estimate by similarity scaling from the profile's reference field length
   * (MTOW, sea level, ISA, default take-off flap):  TOFL ∝ W² / (σ · CL · T)
   */
  function takeoffDistance(p, o) {
    const surface = SURFACE[o.surface] || SURFACE.dry;
    const f = flapOf(p.takeoffFlaps, o.flap);
    const fRef = flapOf(p.takeoffFlaps, null);
    const perfTemp = Number.isFinite(o.assumedC) ? o.assumedC : o.oatC;
    const air = fieldAir(o.elevFt, o.qnh, perfTemp);
    const thr = thrustRatio(p, air, perfTemp);
    const spd = takeoffSpeeds(p, o.mass, f.id, { wet: o.surface !== 'dry' });
    const fMass = Math.pow(o.mass / p.mtow, 2);
    const fDensity = 1 / air.sigma;
    const fThrust = 1 / thr.ratio;
    const fFlap = fRef.cl / f.cl;
    const vlofTas = spd.vlof / Math.sqrt(air.sigma);
    const hw = o.headwind || 0;
    const vwEff = hw >= 0 ? 0.5 * hw : 1.5 * hw;          // 50 % headwind / 150 % tailwind (regulatory)
    const fWind = 0.15 + 0.85 * Math.pow(Math.max(0.2, (vlofTas - vwEff) / vlofTas), 2);
    const fSlope = Math.max(0.85, 1 + 0.045 * (o.slopePct || 0));
    const fSurface = surface.toF;
    const tofl = p.toflRef * fMass * fDensity * fThrust * fFlap * fWind * fSlope * fSurface;
    return { tofl, air, thrust: thr, speeds: spd, vlofTas,
             factors: { mass: fMass, density: fDensity, thrust: fThrust, flap: fFlap, wind: fWind, slope: fSlope, surface: fSurface } };
  }

  /** Highest assumed temperature (FLEX) that still fits the runway, within the thrust-reduction limit. */
  function flexTemp(p, o) {
    const toga = takeoffDistance(p, Object.assign({}, o, { assumedC: undefined }));
    const res = { toga, flex: null, tMax: null, reduction: 0, limitedBy: null, allowed: o.surface !== 'contaminated' };
    const airOat = toga.air;
    res.tMax = Math.round(airOat.isaT + MAX_FLEX_ISA_PLUS);
    if (toga.tofl > o.toraM) { res.limitedBy = 'runway too short for full thrust'; return res; }
    if (!res.allowed) { res.limitedBy = 'reduced thrust not allowed on a contaminated runway'; return res; }
    const thrOat = toga.thrust.ratio;
    const start = Math.max(Math.ceil(o.oatC) + 1, Math.ceil(toga.thrust.kink) + 1);
    let best = null;
    for (let t = start; t <= res.tMax; t++) {
      const d = takeoffDistance(p, Object.assign({}, o, { assumedC: t }));
      const red = 1 - d.thrust.ratio / thrOat;
      if (red > MAX_FLEX_REDUCTION) { res.limitedBy = 'maximum 25 % thrust reduction'; break; }
      if (d.tofl > o.toraM) { res.limitedBy = 'runway length'; break; }
      best = { t, d, red };
    }
    if (best) { res.flex = best.t; res.flexDist = best.d; res.reduction = best.red; if (!res.limitedBy) res.limitedBy = 'T MAX FLEX (ISA+55)'; }
    else if (!res.limitedBy) res.limitedBy = 'OAT above flat-rating — no margin for flex';
    return res;
  }

  // ------------------------------------------------------------------- landing
  function landingSpeeds(p, mass, flapId, o = {}) {
    const f = flapOf(p.landingFlaps, flapId);
    const vs = stallSpeed(mass, p.wingArea, f.cl);
    const vref = 1.23 * vs;
    const hw = Math.max(0, o.headwind || 0);
    const gustInc = Math.max(0, (o.gust || 0) - (o.windSpeed || 0));
    let add, rule;
    if (p.policy === 'airbus') {
      add = Math.min(15, Math.max(5, hw / 3));
      rule = 'VAPP = VLS + max(5, ⅓ headwind), max +15 kt';
    } else {
      add = Math.min(20, Math.max(5, hw / 2 + gustInc));
      rule = 'Vapp = Vref + max(5, ½ headwind + gust), max +20 kt';
    }
    return { flap: f.id, cl: f.cl, vs1g: vs, vref, add, vapp: vref + add, rule,
             name: p.policy === 'airbus' ? 'VLS' : 'Vref' };
  }

  /**
   * Landing distance from 50 ft.  ALD = air + transition + braking.  Autobrake holds a target
   * deceleration; reverse thrust only shortens the roll when braking is friction-limited (MAX / manual).
   */
  function landingDistance(p, o) {
    const surface = SURFACE[o.surface] || SURFACE.dry;
    const air = fieldAir(o.elevFt, o.qnh, o.oatC);
    const spd = landingSpeeds(p, o.mass, o.flap, o);
    const tasF = 1 / Math.sqrt(air.sigma);
    const hw = o.headwind || 0;
    const muLimit = surface.mu * G;
    const slopeA = G * (o.slopePct || 0) / 100;                  // uphill (+) helps
    const target = o.decel;                                      // m/s², autobrake target or manual effort
    const frictionLimited = !(target < muLimit);
    const aBrake = (frictionLimited ? muLimit + (o.reverse ? 0.8 : 0) : target) + slopeA;
    const vtd = spd.vapp - 5;
    const gsApp = (spd.vapp * tasF - hw) * K.KT;
    const gsTd = Math.max(5, (vtd * tasF - hw)) * K.KT;
    const airDist = 305 + 1.0 * gsApp;
    const trans = 2 * gsTd;
    const braking = gsTd * gsTd / (2 * Math.max(0.3, aBrake));
    const ald = airDist + trans + braking;
    // Dispatch (certified-style) distance: Vref, max manual braking on dry, 50 % headwind / 150 % tailwind
    const hwReg = hw >= 0 ? 0.5 * hw : 1.5 * hw;
    const gsCert = Math.max(5, ((spd.vref - 3) * tasF - hwReg)) * K.KT;
    const cert = 305 + gsCert + gsCert * gsCert / (2 * (4.4 + slopeA));
    const ldr = cert / 0.6 * (o.surface === 'dry' ? 1 : 1.15);
    return { speeds: spd, air, ald, factored: ald * 1.15, ldr, airDist, trans, braking, aBrake, frictionLimited,
             gsTdKt: gsTd / K.KT, muLimit };
  }

  /** Lowest autobrake setting whose factored distance (ALD × 1.15) fits the landing distance available. */
  function recommendAutobrake(p, o, ldaM) {
    const list = p.autobrake || [];
    const rows = list.map(ab => {
      const d = landingDistance(p, Object.assign({}, o, { decel: ab.d }));
      return { id: ab.id, decel: ab.d, achieved: d.aBrake, ald: d.ald, factored: d.factored, fits: d.factored <= ldaM, frictionLimited: d.frictionLimited };
    });
    const pick = rows.find(r => r.fits) || null;
    return { rows, pick };
  }

  // ------------------------------------------------------------ speeds & rules
  /** Airbus green-dot rule of thumb (A320 family): 2 × mass(t) + 85 kt, +1 kt per 1000 ft above FL200. */
  const greenDot = (massKg, altFt = 0) => 2 * massKg / 1000 + 85 + Math.max(0, (altFt - 20000) / 1000);

  /** Boeing flap manoeuvre speeds from the profile table (Vref of the reference flap + additive). */
  function maneuverSpeeds(p, massKg) {
    if (!p.maneuver) return null;
    const ref = landingSpeeds(p, massKg, p.maneuver.ref).vref;
    const list = Array.isArray(p.maneuver.add) ? p.maneuver.add : Object.entries(p.maneuver.add);
    return list.map(([flap, add]) => ({ flap, speed: ref + add }));
  }

  // ---------------------------------------------------------------------- fuel
  /** Cruise TAS: the planned Mach, but never faster than the cruise CAS (≈290 kt for jets) at lower levels. */
  function cruiseTas(p, altFt, isaDev, mach, tasKt) {
    if (Number.isFinite(tasKt) && tasKt > 0) return tasKt;
    const m = Number.isFinite(mach) && mach > 0 ? mach : p.cruiseMach;
    const oat = C.isaTempC(altFt) + (isaDev || 0);
    if (m) {
      const byMach = C.machToTas(m, oat);
      const byCas = C.casToTas(p.cruiseCas || 290, altFt, oat).tas;
      return Math.min(byMach, byCas);
    }
    return p.cruiseTas || 250;
  }

  function sector(p, o) {
    const tp = p.engine === 'turboprop';
    const roc = o.rocFpm || (tp ? 1300 : 2000);
    const climbF = tp ? 1.35 : 1.45, descF = 0.35;
    let alt = o.altFt;
    const build = altFt => {
      const tas = cruiseTas(p, altFt, o.isaDev, o.mach, o.tas);
      const cTime = altFt / roc;                                // min
      const cDist = cTime / 60 * (0.75 * tas + o.wind);
      const dDist = altFt / 1000 * 3;
      const dTime = dDist / (0.8 * tas + o.wind) * 60;
      return { tas, cTime, cDist, dDist, dTime };
    };
    let b = build(alt), reduced = false;
    for (let i = 0; i < 12 && b.cDist + b.dDist > o.distNm * 0.95; i++) {
      alt = Math.max(3000, Math.round(alt * 0.8 / 1000) * 1000);
      b = build(alt); reduced = true;
      if (alt === 3000) break;
    }
    const crDist = Math.max(0, o.distNm - b.cDist - b.dDist);
    const gs = b.tas + o.wind;
    const crTime = crDist / gs * 60;
    const fClimb = b.cTime / 60 * o.ff * climbF;
    const fCruise = crTime / 60 * o.ff;
    const fDesc = b.dTime / 60 * o.ff * descF;
    const fAppr = 5 / 60 * o.ffHold;                            // approach & landing allowance
    const time = b.cTime + crTime + b.dTime + 5;
    return { altFt: alt, reduced, tas: b.tas, gs,
             climb: { time: b.cTime, dist: b.cDist, fuel: fClimb },
             cruise: { time: crTime, dist: crDist, fuel: fCruise },
             descent: { time: b.dTime, dist: b.dDist, fuel: fDesc },
             approach: { time: 5, fuel: fAppr },
             time, fuel: fClimb + fCruise + fDesc + fAppr };
  }

  /** Fuel plan (EASA/ICAO structure): taxi + trip + contingency + alternate + final reserve + extra. */
  function fuelPlan(p, o) {
    const ff = o.ffCruise || p.ffCruise, ffHold = o.ffHold || p.ffHold;
    const trip = sector(p, { distNm: o.distNm, altFt: o.cruiseFt, wind: o.windKt || 0, mach: o.mach, tas: o.tas, isaDev: o.isaDev, ff, ffHold });
    const contPct = o.contPct ?? 5;
    const contingency = Math.max(trip.fuel * contPct / 100, 5 / 60 * ffHold);
    const alternate = o.altNm > 0
      ? sector(p, { distNm: o.altNm, altFt: Math.min(o.altAltFt || 20000, o.cruiseFt), wind: 0, mach: o.mach, tas: o.tas, isaDev: o.isaDev, ff, ffHold })
      : null;
    if (alternate) {                                            // go-around and climb-out at destination
      alternate.missed = 3 / 60 * ff * (p.engine === 'turboprop' ? 1.35 : 1.45);
      alternate.fuel += alternate.missed;
      alternate.time += 3;
    }
    const finalReserve = (o.finalResMin ?? 30) / 60 * ffHold;
    const extra = o.extraKg || 0;
    const taxi = o.taxiKg ?? p.taxiKg;
    const takeoffFuel = trip.fuel + contingency + (alternate ? alternate.fuel : 0) + finalReserve + extra;
    const block = takeoffFuel + taxi;
    return { trip, contingency, alternate, finalReserve, extra, taxi, takeoffFuel, block,
             landingFuel: takeoffFuel - trip.fuel, ff, ffHold, overCapacity: block > p.maxFuel };
  }

  // ---------------------------------------------------------------- load sheet
  function loadsheet(p, o) {
    const dow = o.oew + (o.crewKg || 0);
    const paxMass = (o.pax || 0) * (o.paxKg || 84);
    const bagMass = (o.pax || 0) * (o.bagKg || 0);
    const payload = paxMass + bagMass + (o.cargoKg || 0);
    const zfw = dow + payload;
    const tow = zfw + o.takeoffFuel;
    const lw = tow - o.tripKg;
    const lims = [
      { key: 'MTOW', value: p.mtow },
      { key: 'MZFW + take-off fuel', value: p.mzfw + o.takeoffFuel },
      { key: 'MLW + trip fuel', value: p.mlw + o.tripKg }
    ];
    const lim = lims.reduce((a, b) => (b.value < a.value ? b : a));
    return { dow, paxMass, bagMass, payload, zfw, tow, lw, maxTow: lim.value, limitedBy: lim.key,
             underload: lim.value - tow,
             checks: { zfw: zfw <= p.mzfw, tow: tow <= p.mtow, lw: lw <= p.mlw, fuel: o.takeoffFuel + (o.taxiKg || 0) <= p.maxFuel } };
  }

  return { SURFACE, THRUST_LAPSE_PER_C, MAX_FLEX_REDUCTION, MAX_FLEX_ISA_PLUS, stallSpeed, fieldAir, takeoffSpeeds, thrustRatio,
           takeoffDistance, flexTemp, landingSpeeds, landingDistance, recommendAutobrake, greenDot, maneuverSpeeds,
           cruiseTas, sector, fuelPlan, loadsheet, flapOf };
});

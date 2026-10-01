/* XP Flight Computer — values derived from the live X-Plane data.
 * Shared by the web app and the X-Plane plugin. f = raw values from X-Plane (see build_state in
 * xpfc.py or the plugin's reader), ac = aircraft info, det = aircraft.detect(ac).
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const mod = factory(isNode ? require('./calc.js') : root.XFC.calc, isNode ? require('./aircraft.js') : root.XFC.aircraft);
  if (isNode) module.exports = mod;
  if (root) { root.XFC = root.XFC || {}; root.XFC.derive = mod; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (C, A) {
  'use strict';
  const isNum = x => typeof x === 'number' && isFinite(x);

  return function derive(f, ac, det) {
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
  };
});

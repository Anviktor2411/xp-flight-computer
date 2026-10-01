/* XP Flight Computer — small polyfills for the plugin's embedded JavaScript engine (QuickJS).
 * QuickJS has no Intl, so Number.prototype.toLocaleString ignores its options. The calculators use it
 * for thousands separators and fixed decimals, so give it the en-US behaviour they expect.
 */
(function () {
  'use strict';
  let ok = false;
  try { ok = (1234.5).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) === '1,234.50'; } catch (e) { ok = false; }
  if (ok) return;
  Number.prototype.toLocaleString = function (locales, o) {
    const x = Number(this);
    if (!isFinite(x)) return String(x);
    o = o || {};
    let minD = o.minimumFractionDigits, maxD = o.maximumFractionDigits;
    if (minD == null) minD = 0;
    if (maxD == null) maxD = Math.max(minD, 3);
    if (maxD < minD) maxD = minD;
    const s = Math.abs(x).toFixed(maxD);
    let [ip, fp = ''] = s.split('.');
    fp = fp.replace(/0+$/, '');
    while (fp.length < minD) fp += '0';
    ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const neg = x < 0 && Number(s) !== 0;
    return (neg ? '-' : '') + ip + (fp ? '.' + fp : '');
  };
})();

/* Technical indicator helpers (null-safe) */
(function () {
  const EPF = (window.EPF = window.EPF || {});

  function sma(a, n) {
    const o = new Array(a.length).fill(null);
    let s = 0, nulls = 0;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (v == null) nulls++; else s += v;
      if (i >= n) { const w = a[i - n]; if (w == null) nulls--; else s -= w; }
      if (i >= n - 1 && nulls === 0) o[i] = s / n;
    }
    return o;
  }

  function rsi(c, n = 14) {
    const o = new Array(c.length).fill(null);
    let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
      if (i <= n) {
        g += up; l += dn;
        if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
      } else {
        g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;
        o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      }
    }
    return o;
  }

  function pctChange(a, n) {
    return a.map((v, i) => (i >= n && v != null && a[i - n] != null && a[i - n] !== 0 ? v / a[i - n] - 1 : null));
  }

  function returns(a) { return pctChange(a, 1); }

  function rollingMax(a, n) {
    const o = new Array(a.length).fill(null);
    for (let i = 0; i < a.length; i++) {
      let m = null;
      for (let j = Math.max(0, i - n + 1); j <= i; j++) if (a[j] != null && (m == null || a[j] > m)) m = a[j];
      o[i] = m;
    }
    return o;
  }

  function rollingStd(a, n) {
    const o = new Array(a.length).fill(null);
    for (let i = n - 1; i < a.length; i++) {
      let s = 0, s2 = 0, k = 0;
      for (let j = i - n + 1; j <= i; j++) if (a[j] != null) { s += a[j]; s2 += a[j] * a[j]; k++; }
      if (k >= n * 0.8) { const m = s / k; o[i] = Math.sqrt(Math.max(0, s2 / k - m * m)); }
    }
    return o;
  }

  function rollingBeta(rs, rb, n = 252) {
    const o = new Array(rs.length).fill(null);
    let sx = 0, sy = 0, sxy = 0, sxx = 0, k = 0;
    const ok = i => rs[i] != null && rb[i] != null;
    for (let i = 0; i < rs.length; i++) {
      if (ok(i)) { sx += rb[i]; sy += rs[i]; sxy += rb[i] * rs[i]; sxx += rb[i] * rb[i]; k++; }
      if (i >= n && ok(i - n)) {
        const j = i - n; sx -= rb[j]; sy -= rs[j]; sxy -= rb[j] * rs[j]; sxx -= rb[j] * rb[j]; k--;
      }
      if (k >= 120) {
        const v = sxx - (sx * sx) / k;
        if (v > 1e-12) o[i] = (sxy - (sx * sy) / k) / v;
      }
    }
    return o;
  }

  function weekKey(d) {
    const t = new Date(d + 'T00:00:00Z');
    const back = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - back);
    return t.toISOString().slice(0, 10);
  }

  /* Weekly MACD(12,26,9) evaluated each day using the current (partial) week's close.
     Uses only data up to that day: no look-ahead. */
  function weeklyMacd(dates, c) {
    const n = c.length, macd = new Array(n).fill(null), signal = new Array(n).fill(null);
    const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
    let e12 = null, e26 = null, es = null, weeks = 0, prevWk = null, lastClose = null;
    for (let i = 0; i < n; i++) {
      const wk = weekKey(dates[i]);
      if (prevWk !== null && wk !== prevWk) {
        e12 = e12 == null ? lastClose : e12 + k12 * (lastClose - e12);
        e26 = e26 == null ? lastClose : e26 + k26 * (lastClose - e26);
        const m = e12 - e26;
        es = es == null ? m : es + k9 * (m - es);
        weeks++;
      }
      prevWk = wk; lastClose = c[i];
      const p12 = e12 == null ? c[i] : e12 + k12 * (c[i] - e12);
      const p26 = e26 == null ? c[i] : e26 + k26 * (c[i] - e26);
      const m = p12 - p26;
      const ps = es == null ? m : es + k9 * (m - es);
      if (weeks >= 35) { macd[i] = m; signal[i] = ps; }
    }
    return { macd, signal };
  }

  function maxDrawdown(series) {
    let peak = -Infinity, mdd = 0;
    const dd = series.map(v => {
      if (v == null) return null;
      if (v > peak) peak = v;
      const d = peak > 0 ? v / peak - 1 : 0;
      if (d < mdd) mdd = d;
      return d;
    });
    return { mdd, dd };
  }

  EPF.ind = { sma, rsi, pctChange, returns, rollingMax, rollingStd, rollingBeta, weeklyMacd, weekKey, maxDrawdown };
})();

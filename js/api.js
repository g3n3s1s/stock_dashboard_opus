/* Storage + Twelve Data client (rate-limited, cached) */
(function () {
  const EPF = (window.EPF = window.EPF || {});
  const PFX = 'epf:';

  EPF.store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(PFX + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, val) {
      const s = JSON.stringify(val);
      try { localStorage.setItem(PFX + key, s); return true; }
      catch (e) {
        // Storage full: evict oldest cached price series, then retry once
        EPF.store.evictCache(key);
        try { localStorage.setItem(PFX + key, s); return true; }
        catch (e2) { console.warn('Storage full; not cached:', key); return false; }
      }
    },
    remove(key) { localStorage.removeItem(PFX + key); },
    cacheKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PFX + 'ts:')) out.push(k);
      }
      return out;
    },
    evictCache(keep) {
      const items = EPF.store.cacheKeys()
        .filter(k => k !== PFX + keep)
        .map(k => { let t = 0; try { t = JSON.parse(localStorage.getItem(k)).t; } catch (e) {} return { k, t }; })
        .sort((a, b) => a.t - b.t);
      items.slice(0, Math.max(1, Math.ceil(items.length / 2))).forEach(x => localStorage.removeItem(x.k));
    },
    clearCache() { EPF.store.cacheKeys().forEach(k => localStorage.removeItem(k)); }
  };

  const BASE = 'https://api.twelvedata.com';
  const CACHE_HOURS = 12;
  let stamps = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function throttle() {
    const limit = Number(EPF.store.get('ratePerMin', 8)) || 8;
    for (;;) {
      const now = Date.now();
      stamps = stamps.filter(t => now - t < 60000);
      if (stamps.length < limit) { stamps.push(now); return; }
      const wait = 60000 - (now - stamps[0]) + 300;
      EPF.ui && EPF.ui.status(`API rate limit (${limit}/min) — waiting ${Math.ceil(wait / 1000)}s…`, 'warn');
      await sleep(Math.min(wait, 5000));
    }
  }

  async function call(path, params) {
    const key = EPF.store.get('apikey', '');
    if (!key) throw new Error('Add your Twelve Data API key in Settings (gear icon).');
    await throttle();
    const url = new URL(BASE + path);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    url.searchParams.set('apikey', key);
    const res = await fetch(url.toString());
    const j = await res.json();
    if (j && (j.status === 'error' || (j.code && j.code >= 400))) {
      const err = new Error(j.message || 'Twelve Data error');
      err.code = j.code;
      throw err;
    }
    return j;
  }

  async function search(q) {
    const j = await call('/symbol_search', { symbol: q, outputsize: 15 });
    return (j.data || []).filter(x => !x.instrument_type || /stock|etf|depositary|reit|fund/i.test(x.instrument_type));
  }

  function cacheId(symbol, mic) { return 'ts:' + symbol.toUpperCase() + (mic ? '@' + mic : ''); }

  async function timeSeries(symbol, mic, force) {
    const ck = cacheId(symbol, mic);
    const cached = EPF.store.get(ck, null);
    if (!force && cached && Date.now() - cached.t < CACHE_HOURS * 3600e3) return cached.d;
    EPF.ui && EPF.ui.status(`Downloading ${symbol} history…`);
    const j = await call('/time_series', {
      symbol, mic_code: mic, interval: '1day', outputsize: 5000, order: 'ASC'
    });
    const vals = (j.values || []).slice().sort((a, b) => (a.datetime < b.datetime ? -1 : 1));
    const d = { meta: j.meta || {}, date: [], o: [], h: [], l: [], c: [], v: [] };
    const r = x => Math.round(parseFloat(x) * 10000) / 10000;
    vals.forEach(v => {
      const close = parseFloat(v.close);
      if (!isFinite(close)) return;
      d.date.push(v.datetime.slice(0, 10));
      d.o.push(r(v.open)); d.h.push(r(v.high)); d.l.push(r(v.low)); d.c.push(r(v.close));
      d.v.push(Math.round(parseFloat(v.volume) || 0));
    });
    if (!d.date.length) throw new Error(`No daily data returned for ${symbol}.`);
    EPF.store.set(ck, { t: Date.now(), d });
    return d;
  }

  // /earnings needs a paid Twelve Data plan; caller must handle failure.
  async function earnings(symbol, mic) {
    const j = await call('/earnings', { symbol, mic_code: mic, outputsize: 100 });
    return (j.earnings || [])
      .filter(e => e.eps_actual != null && e.eps_actual !== '')
      .map(e => ({
        date: e.date,
        actual: parseFloat(e.eps_actual),
        estimate: e.eps_estimate == null || e.eps_estimate === '' ? null : parseFloat(e.eps_estimate)
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  EPF.api = { search, timeSeries, earnings, cacheId };
})();

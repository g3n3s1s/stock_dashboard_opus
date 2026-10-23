/* Equity Position Protection Framework Rev. 5 — engine
   Systems 0,1,2,2E,3,4,5 + fair-value engine + Buy&Hold + user ledger. */
(function () {
  const EPF = (window.EPF = window.EPF || {});
  const I_ = () => EPF.ind;

  /* ---------- Defaults ---------- */
  EPF.defaultProfile = function (symbol) {
    return {
      symbol, mic: '', name: '',
      businessClass: 'cyclical',
      benchmark: 'SPY', peers: [],
      startDate: '', initialCapital: 100000, s0Shares: 0,
      feePct: 0.1, cashYieldPct: 0,
      sys0: { enabled: false, otherAssets: 0, targetPct: 15 },
      p: {
        lagPct: 10, watchN: 5, confirmN: 10, magK: 1.5, betaResidPct: 10,
        s2Init: 10, s2Ext: 5, s2Cap: 15, s2ExtN: 10, s2Cooldown: 5,
        eRsi: 80, eAbove50: 25, eAbove20: 15, eRet20: 40, eExpiry: 20, eCand: 12.5, eWindow: 3,
        eCatDD: 20, eCatWin: 10, eCatDown: 8, eCatVol: 1.5, eFirst: 10, eSecond: 10, eCap: 20,
        techFloor: 65, fundFloor: 25, m1: 80, m2: 70, m3: 60, episodeGap: 60
      },
      fv: { multiple: 12, confidence: 'medium', haircut: 75, wTTM: 70, fcfYield: 7 },
      fvSchedule: [],   // {date, fv, note, reunderwrite}
      s3Events: [],     // {date, result: beat|inline|miss, guidance: raised|maintained|cut, context: normal|sector|alone}
      s4Events: [],     // {date, type: thesis|distress|peerDet|clean|clear, note}
      userTrades: []    // {date, side: buy|sell, shares, price}
    };
  };

  /* ---------- Fair value engine ---------- */
  const CONF = { high: 1, medium: 0.9, low: 0.75, speculative: 0.6 };
  const CONF_ORDER = ['high', 'medium', 'low', 'speculative'];
  const median = a => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

  EPF.fairValue = function (inp) {
    const q = (inp.q || []).filter(isFinite), a = (inp.a || []).filter(isFinite);
    if (q.length < 4) return { error: 'Need 4 quarterly diluted EPS values.' };
    const haircut = (inp.haircut ?? 75) / 100, w = (inp.wTTM ?? 70) / 100;
    const ttm = q.slice(-4).reduce((s, x) => s + x, 0);
    const adjTTM = Math.max(0, ttm) * haircut;
    const cycle = Math.max(0, a.length ? median(a.slice(-5)) : ttm);
    const sust = w * adjTTM + (1 - w) * cycle;
    const out = { ttm, adjTTM, cycle, sust, bear: sust * 10, base: sust * 12, high: sust * 15 };
    out.earningsFV = sust * (inp.multiple || 12);
    let conf = inp.confidence || 'medium', composite = out.earningsFV, flags = [];
    if (inp.fcfTTM && inp.dilutedShares) {
      const fcfps = 0.75 * inp.fcfTTM / inp.dilutedShares;
      out.fcfFV = fcfps / ((inp.fcfYield || 7) / 100);
      composite = 0.6 * out.earningsFV + 0.4 * out.fcfFV;
      const diff = Math.abs(out.earningsFV - out.fcfFV) / Math.max(1e-9, Math.max(out.earningsFV, out.fcfFV));
      out.disagreement = diff;
      if (diff > 0.3) {
        conf = CONF_ORDER[Math.min(3, CONF_ORDER.indexOf(conf) + 1)];
        flags.push('EPS vs FCF differ >30%: confidence lowered one grade — review required');
      }
    }
    out.composite = composite; out.confidence = conf; out.factor = CONF[conf];
    out.adjustedFV = composite * CONF[conf]; out.flags = flags;
    return out;
  };

  /* Build point-in-time FV schedule + optional S3 events from /earnings data */
  EPF.fvFromEarnings = function (earn, prof, makeS3) {
    const sched = [], s3 = [];
    for (let k = 3; k < earn.length; k++) {
      const q = earn.slice(k - 3, k + 1).map(e => e.actual);
      const blocks = [];
      for (let b = 0; b < 5; b++) {
        const hi = k - 4 * b, lo = hi - 3;
        if (lo < 0) break;
        blocks.push(earn.slice(lo, hi + 1).reduce((s, e) => s + e.actual, 0));
      }
      const r = EPF.fairValue({ q, a: blocks, multiple: prof.fv.multiple, confidence: prof.fv.confidence, haircut: prof.fv.haircut, wTTM: prof.fv.wTTM });
      if (!r.error) sched.push({ date: earn[k].date, fv: +r.adjustedFV.toFixed(2), note: 'auto (reported EPS)', reunderwrite: false, auto: true });
    }
    if (makeS3) earn.forEach(e => {
      if (e.estimate == null || e.estimate === 0) return;
      const s = (e.actual - e.estimate) / Math.abs(e.estimate);
      const result = s < -0.02 ? 'miss' : s > 0 ? 'beat' : 'inline';
      s3.push({ date: e.date, result, guidance: 'maintained', context: 'normal', auto: true });
    });
    return { sched, s3 };
  };

  /* ---------- Data alignment ---------- */
  EPF.align = function (stock, bench, peers) {
    const ff = src => {
      if (!src) return stock.date.map(() => null);
      const m = new Map(); src.date.forEach((d, i) => m.set(d, src.c[i]));
      let last = null; const firstDate = src.date[0];
      return stock.date.map(d => { if (m.has(d)) last = m.get(d); return d >= firstDate ? last : null; });
    };
    return {
      date: stock.date, open: stock.o, high: stock.h, low: stock.l, close: stock.c, vol: stock.v,
      bench: ff(bench), peers: (peers || []).map(ff), peerNames: (peers || []).map(p => p.meta && p.meta.symbol)
    };
  };

  /* ---------- Indicator preparation ---------- */
  EPF.prepare = function (D) {
    const ind = I_(), c = D.close, n = c.length, I = {};
    I.sma20 = ind.sma(c, 20); I.sma50 = ind.sma(c, 50); I.sma200 = ind.sma(c, 200);
    I.rsi = ind.rsi(c, 14); I.ret20 = ind.pctChange(c, 20);
    I.volAvg20 = ind.sma(D.vol, 20);
    const r = ind.returns(c);
    I.dayRet = r;
    I.vol20 = ind.rollingStd(r, 20);
    I.high60 = ind.rollingMax(c, 60);
    I.mag = c.map((v, i) => (I.high60[i] && I.vol20[i] ? ((I.high60[i] - v) / I.high60[i]) / (I.vol20[i] * Math.sqrt(20)) : null));
    const wm = ind.weeklyMacd(D.date, c); I.wmacd = wm.macd; I.wsig = wm.signal;

    // Peer basket (equal-weight daily returns), else benchmark
    let ref = null; I.refName = 'none';
    if (D.peers.length) {
      const pr = D.peers.map(p => ind.returns(p));
      ref = new Array(n).fill(null);
      for (let i = 0; i < n; i++) {
        const avail = D.peers.filter(p => p[i] != null).length;
        if (ref[i - 1] == null) { ref[i] = avail ? 1 : null; continue; }
        const rr = pr.map(x => x[i]).filter(x => x != null);
        ref[i] = rr.length ? ref[i - 1] * (1 + rr.reduce((s, x) => s + x, 0) / rr.length) : ref[i - 1];
      }
      I.refName = 'peers';
      const pSma50 = D.peers.map(p => ind.sma(p, 50));
      I.breadth = c.map((_, i) => {
        let k = 0, up = 0;
        D.peers.forEach((p, j) => { if (p[i] != null && pSma50[j][i] != null) { k++; if (p[i] > pSma50[j][i]) up++; } });
        return k ? up / k : null;
      });
    } else if (D.bench.some(x => x != null)) {
      ref = D.bench; I.refName = 'benchmark'; I.breadth = c.map(() => null);
    } else I.breadth = c.map(() => null);
    I.ref = ref;
    I.ref60 = ref ? ind.pctChange(ref, 60) : c.map(() => null);
    I.rs = c.map((v, i) => (ref && ref[i] ? v / ref[i] : null));
    I.rsSma20 = ind.sma(I.rs, 20); I.rsSma50 = ind.sma(I.rs, 50);
    I.rs60 = ind.pctChange(I.rs, 60);

    // Market lens + beta residual
    const b = D.bench;
    I.benchSma200 = ind.sma(b, 200);
    const bMax = ind.rollingMax(b, 252);
    I.benchDD = b.map((v, i) => (v != null && bMax[i] ? v / bMax[i] - 1 : null));
    const rb = ind.returns(b);
    I.beta = ind.rollingBeta(r, rb, 252);
    const s60 = ind.pctChange(c, 60), b60 = ind.pctChange(b, 60);
    I.resid60 = c.map((_, i) => (I.beta[i] != null && s60[i] != null && b60[i] != null ? s60[i] - I.beta[i] * b60[i] : null));
    // Volatility profile (display)
    I.annVol = I.vol20.map(v => (v == null ? null : v * Math.sqrt(252)));
    return I;
  };

  /* ---------- Helpers ---------- */
  function idxOnOrAfter(dates, d) {
    let lo = 0, hi = dates.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; }
    return lo;
  }
  EPF.idxOnOrAfter = idxOnOrAfter;
  const qKey = d => d.slice(0, 4) + 'Q' + (Math.floor((+d.slice(5, 7) - 1) / 3) + 1);
  const STEPS = [0, 5, 10, 15, 25];
  const S3_MATRIX = {
    raised: { beat: 0, inline: 0, miss: 1 },
    maintained: { beat: 0, inline: 0, miss: 2 },
    cut: { beat: 2, inline: 3, miss: 4 }
  };
  EPF.s3Step = function (ev) {
    let step = S3_MATRIX[ev.guidance][ev.result];
    let review = ev.guidance === 'cut';
    const weak = ev.result === 'miss' || ev.guidance === 'cut';
    if (weak && ev.context === 'sector') step = Math.max(0, step - 1);
    if (weak && ev.context === 'alone') { step = Math.min(4, step + 1); review = true; }
    const reset = ev.result === 'beat' && ev.guidance === 'raised';
    const s4Review = step === 4 || (weak && ev.context === 'alone');
    return { pct: STEPS[step], review, reset, s4Review };
  };
  EPF.defaultStartIndex = n => Math.min(252, Math.max(0, n - 2));

  /* ---------- Main simulation ---------- */
  EPF.simulate = function (D, I, P) {
    const n = D.close.length, c = D.close, o = D.open, p = P.p;
    let start = P.startDate ? idxOnOrAfter(D.date, P.startDate) : EPF.defaultStartIndex(n);
    if (start >= n) start = n - 1;
    const px0 = c[start];
    const S0 = P.s0Shares > 0 ? +P.s0Shares : Math.floor(P.initialCapital / px0);
    if (!(S0 > 0)) throw new Error('Initial capital is too small to buy one share at the start date.');
    const startCash = P.s0Shares > 0 ? 0 : P.initialCapital - S0 * px0;
    const fee = (P.feePct || 0) / 100;
    const dRate = Math.pow(1 + (P.cashYieldPct || 0) / 100, 1 / 252) - 1;

    // Map events to trading indices (signal at close of that session, execute next)
    const evAt = (list) => {
      const m = new Map();
      (list || []).forEach(e => {
        if (!e.date) return;
        const i = idxOnOrAfter(D.date, e.date);
        if (i < start || i >= n) return;
        if (!m.has(i)) m.set(i, []);
        m.get(i).push(e);
      });
      return m;
    };
    const s3Map = evAt(P.s3Events), s4Map = evAt(P.s4Events);
    const fvSorted = (P.fvSchedule || []).filter(x => x.date && x.fv > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
    const fvAt = d => { let v = null; for (const x of fvSorted) { if (x.date <= d) v = x; else break; } return v; };
    const fvReMap = evAt(fvSorted.filter(x => x.reunderwrite));

    const st = { shares: S0, cash: startCash };
    const trades = [], log = [];
    const out = {
      start, S0, nw: new Array(n).fill(null), shares: new Array(n).fill(null), cash: new Array(n).fill(null),
      tl: { s0: [], s1: [], s2: [], e2: [], s3: [], s4: [], s5: [] }, tlIdx: []
    };
    // System states
    let lagCount = 0;
    const s2 = { used: 0, lastSell: -1e9, inEpisode: false, initSig: -1, rsAtInit: null, extDone: false };
    const e2 = { used: 0, armed: false, peak: 0, peakIdx: -1, cand: -1, firstDone: false, vetoed: false, catDone: false, sale: false, belowSma20: 0, needNewHigh: false };
    const s3 = { pending: null, last: null, review: false };
    const s4 = { det: 0, broken: false, pending: null, last: null };
    const s0 = { gliding: false, tranche: 0, left: 0, q: null, pendingQty: 0, credit: 0, creditQ: null };
    const episodes = [];
    let pending = null;

    const addLog = (i, sys, code, msg) => log.push({ date: D.date[i], sys, code, msg });

    function openOrJoinEpisode(i, qty, px) {
      let ep = episodes[episodes.length - 1];
      if (!ep || ep.bought > 0 || i - ep.lastSell > p.episodeGap) {
        const f = fvAt(D.date[i]);
        ep = { id: episodes.length + 1, openDate: D.date[i], fv: f ? f.fv : null, fvNote: f ? f.note : 'no fair value on file',
          sold: 0, proceeds: 0, bought: 0, locks: [false, false, false], lastSell: i };
        episodes.push(ep);
        addLog(i, 'S5', ep.fv ? 'armed' : 'off', `Sell episode #${ep.id} opened; frozen FV ${ep.fv ? ep.fv.toFixed(2) : 'n/a'}`);
      }
      ep.sold += qty; ep.proceeds += qty * px; ep.lastSell = i;
    }

    function execute(i) {
      if (!pending) return;
      const ord = pending; pending = null;
      const px = o[i] || c[i];
      if (ord.side === 'sell') {
        const qty = Math.min(ord.qty, st.shares);
        if (qty <= 1e-6) return;
        st.shares -= qty; st.cash += qty * px * (1 - fee);
        trades.push({ date: D.date[i], idx: i, side: 'sell', qty, price: px, sys: ord.sys, reason: ord.reason, sigDate: D.date[ord.sig] });
        ord.fill && ord.fill(qty, i);
        if (ord.sys !== 'S0') { if (s0.creditQ !== qKey(D.date[i])) { s0.credit = 0; s0.creditQ = qKey(D.date[i]); } if (['S2', 'S2E', 'S3', 'S4'].includes(ord.sys.replace(/-.*/, ''))) s0.credit += qty; }
        openOrJoinEpisode(i, qty, px);
      } else {
        let qty = Math.min(ord.qty, st.cash / (px * (1 + fee)));
        if (P.sys0.enabled) {
          const nwv = st.shares * px + st.cash + (+P.sys0.otherAssets || 0);
          const maxVal = nwv * P.sys0.targetPct / 100 - st.shares * px;
          qty = Math.min(qty, Math.max(0, maxVal / px));
        }
        if (qty <= 1e-6) return; // not executed -> level stays unlocked
        ord.fill && ord.fill(qty, i);
        st.shares += qty; st.cash -= qty * px * (1 + fee);
        trades.push({ date: D.date[i], idx: i, side: 'buy', qty, price: px, sys: 'S5', reason: ord.reason, sigDate: D.date[ord.sig] });
      }
    }

    for (let i = start; i < n; i++) {
      if (i > start) { st.cash *= 1 + dRate; execute(i); }
      const ci = c[i], date = D.date[i];
      const sells = [];
      const techRoom = st.shares - (p.techFloor / 100) * S0;
      const fundRoom = st.shares - (p.fundFloor / 100) * S0;

      /* ---- System 1: noise filter (diagnostic) ---- */
      const has = v => v != null;
      const t1 = has(I.sma50[i]) && ci < I.sma50[i];
      const t2 = has(I.sma200[i]) && ci < I.sma200[i];
      const sma50Falling = has(I.sma50[i - 5]) && I.sma50[i] < I.sma50[i - 5];
      const vTrend = t1 && (t2 || sma50Falling);
      const vMacd = has(I.wmacd[i]) && I.wmacd[i] < I.wsig[i];
      const vMag = has(I.mag[i]) && I.mag[i] >= p.magK;
      const vBeta = has(I.resid60[i]) && I.resid60[i] <= -p.betaResidPct / 100;
      const lag = has(I.rs60[i]) && I.rs60[i] <= -p.lagPct / 100;
      lagCount = lag ? lagCount + 1 : 0;
      const stockWeak = t1 || t2 || vMacd || vMag;
      const marketWeak = (has(I.benchSma200[i]) && D.bench[i] < I.benchSma200[i]) || (has(I.benchDD[i]) && I.benchDD[i] <= -0.10);
      const marketBear = has(I.benchDD[i]) && I.benchDD[i] <= -0.20;
      const sectorWeak = (has(I.breadth[i]) && I.breadth[i] < 0.5) || (I.refName === 'peers' && has(I.ref60[i]) && I.ref60[i] <= -0.10);
      let s1;
      if (!has(I.rs60[i]) && !has(I.sma50[i])) s1 = 'off';
      else if (lagCount >= p.confirmN) s1 = 'sell';
      else if (lagCount >= p.watchN) s1 = 'watch';
      else if (stockWeak && sectorWeak) s1 = 'sector';
      else if (stockWeak && marketWeak) s1 = 'market';
      else if (stockWeak || lag) s1 = 'weak';
      else s1 = 'ok';
      const votes = [vTrend, vMacd, vMag, vBeta];
      const voteCount = votes.filter(Boolean).length;

      /* ---- System 2: ordinary company-specific deterioration ---- */
      let s2s = 'ok';
      if (!lag) { s2.inEpisode = false; s2.extDone = false; }
      if (!has(I.rs60[i])) s2s = 'off';
      if (s2.used >= p.s2Cap / 100 - 1e-9) s2s = 'exhausted';
      else if (techRoom <= 1e-6 && lagCount >= p.confirmN) s2s = 'floor';
      else if (lagCount >= p.confirmN && voteCount >= 2) {
        const cool = i - s2.lastSell >= p.s2Cooldown;
        const left = p.s2Cap / 100 - s2.used;
        if (!s2.inEpisode) {
          if (cool) {
            const pct = Math.min(p.s2Init / 100, left);
            sells.push({ prio: 2, sys: 'S2', qty: Math.min(pct * S0, techRoom), reason: `S2 initial ${(pct * 100).toFixed(1)}% S0 (lag ${lagCount}d, ${voteCount}/4 confirmations)`,
              fill: (q, k) => { s2.used += q / S0; s2.lastSell = k; s2.inEpisode = true; s2.initSig = i; s2.rsAtInit = I.rs[i]; } });
            s2s = 'sell';
          } else s2s = 'watch';
        } else if (!s2.extDone) {
          if (i - s2.initSig >= p.s2ExtN && I.rs[i] < s2.rsAtInit && cool) {
            const pct = Math.min(p.s2Ext / 100, left);
            sells.push({ prio: 2, sys: 'S2', qty: Math.min(pct * S0, techRoom), reason: `S2 extension ${(pct * 100).toFixed(1)}% S0 (RS still worsening)`,
              fill: (q, k) => { s2.used += q / S0; s2.lastSell = k; s2.extDone = true; } });
            s2s = 'sell';
          } else s2s = 'watch';
        } else s2s = 'watch';
      } else if (lagCount >= p.watchN) s2s = 'watch';
      else if (lag) s2s = 'weak';

      /* ---- System 2E: extreme reversal overlay ---- */
      const armConds = [
        has(I.rsi[i]) && I.rsi[i] >= p.eRsi,
        has(I.sma50[i]) && ci >= I.sma50[i] * (1 + p.eAbove50 / 100),
        has(I.sma20[i]) && ci >= I.sma20[i] * (1 + p.eAbove20 / 100),
        has(I.ret20[i]) && I.ret20[i] >= p.eRet20 / 100
      ];
      let e2s = 'off';
      const eLeft = p.eCap / 100 - e2.used;
      if (eLeft <= 1e-9) e2s = 'exhausted';
      else {
        if (!e2.armed && armConds.every(Boolean)) {
          Object.assign(e2, { armed: true, peak: ci, peakIdx: i, cand: -1, firstDone: false, vetoed: false, catDone: false, sale: false, belowSma20: 0, needNewHigh: false });
          addLog(i, 'S2E', 'armed', `Extreme advance armed at ${ci.toFixed(2)}`);
        }
        if (e2.armed) {
          e2s = 'armed';
          if (ci > e2.peak) { e2.peak = ci; e2.peakIdx = i; e2.needNewHigh = false; if (e2.cand >= 0 && !e2.sale) e2.cand = -1; }
          if (!e2.sale && e2.cand < 0 && i - e2.peakIdx >= p.eExpiry) {
            e2.armed = false; e2s = 'off'; addLog(i, 'S2E', 'off', 'Disarmed: no new closing high for 20 sessions');
          }
        }
        if (e2.armed) {
          const dd = 1 - ci / e2.peak;
          if (e2.cand < 0 && !e2.needNewHigh && dd >= p.eCand / 100) { e2.cand = i; e2.belowSma20 = 0; e2.vetoed = false; addLog(i, 'S2E', 'watch', `Reversal candidate: ${(dd * 100).toFixed(1)}% below peak`); }
          if (e2.cand >= 0) {
            e2s = 'watch';
            if (has(I.sma20[i]) && ci < I.sma20[i]) e2.belowSma20++;
            const age = i - e2.cand;
            const room = Math.min(techRoom, eLeft * S0);
            // Catastrophic confirmation
            const bigDown = has(I.dayRet[i]) && I.dayRet[i] <= -p.eCatDown / 100 && has(I.volAvg20[i - 1]) && D.vol[i] >= p.eCatVol * I.volAvg20[i - 1];
            if (!e2.catDone && age < p.eCatWin && dd >= p.eCatDD / 100 && (e2.belowSma20 >= 2 || bigDown)) {
              if (room > 1e-6) {
                sells.push({ prio: 4, sys: 'S2E-cat', qty: Math.min((p.eSecond / 100) * S0, room), reason: `2E catastrophic (${(dd * 100).toFixed(1)}% below peak)`,
                  fill: q => { e2.used += q / S0; e2.catDone = true; e2.sale = true; } });
                e2s = 'sell';
              } else e2s = 'floor';
            }
            // First sale (3-session confirmation window)
            if (!e2.firstDone && !e2.vetoed && age < p.eWindow) {
              const v3 = [has(I.sma20[i]) && ci < I.sma20[i], has(I.rsi[i]) && I.rsi[i] < 65, has(I.rsSma20[i]) && I.rs[i] < I.rsSma20[i]].filter(Boolean).length;
              if (v3 >= 2) {
                const veto = has(I.sma50[i - 5]) && ci > I.sma50[i] && I.sma50[i] > I.sma50[i - 5] && has(I.rsSma50[i]) && I.rs[i] > I.rsSma50[i];
                if (veto) { e2.vetoed = true; e2s = 'veto'; addLog(i, 'S2E', 'veto', 'Trend veto: first sale cancelled (catastrophic rule still active)'); }
                else if (room > 1e-6) {
                  sells.push({ prio: 3, sys: 'S2E-first', qty: Math.min((p.eFirst / 100) * S0, room), reason: `2E first sale (${v3}/3 confirmations)`,
                    fill: q => { e2.used += q / S0; e2.firstDone = true; e2.sale = true; } });
                  if (e2s !== 'sell') e2s = 'sell';
                } else e2s = 'floor';
              }
            }
            // Window management
            if (age >= p.eCatWin - 1) {
              if (e2.sale || e2.catDone) { e2.armed = false; addLog(i, 'S2E', 'off', 'Reversal episode closed'); }
              else { e2.cand = -1; e2.needNewHigh = true; }
            }
          }
        }
      }

      /* ---- System 4: full exit protocol (events) ---- */
      (s4Map.get(i) || []).forEach(ev => {
        s4.last = ev;
        if (ev.type === 'thesis' || ev.type === 'distress') {
          s4.broken = true; s4.pending = { kind: 'full', reason: `S4 full exit (${ev.type === 'thesis' ? 'thesis invalidation' : 'company distress'})` };
        } else if (ev.type === 'peerDet') {
          s4.det++;
          s4.pending = s4.det >= 2 ? { kind: 'full', reason: 'S4 peer-relative deterioration #2: exit rest' } : { kind: 'half', reason: 'S4 peer-relative deterioration #1: sell 50% of holding' };
        } else if (ev.type === 'clean') { s4.det = 0; addLog(i, 'S4', 'ok', 'Clean report: deterioration count reset'); }
        else if (ev.type === 'clear') { s4.det = 0; s4.broken = false; s4.pending = null; addLog(i, 'S4', 'ok', 'Thesis re-underwritten: System 4 cleared'); }
      });
      let s4s = (P.s4Events || []).length ? 'ok' : 'off';
      if (s4.det === 1) s4s = 'watch';
      if (s4.broken || s4.det >= 2) s4s = 'blocked';
      if (s4.pending) {
        const qty = s4.pending.kind === 'full' ? st.shares : st.shares * 0.5;
        if (qty > 1e-6) {
          sells.push({ prio: 6, sys: 'S4', qty, reason: s4.pending.reason, fill: () => { s4.pending = null; } });
          s4s = 'sell';
        } else s4.pending = null;
      }

      /* ---- System 3: fundamental confirmation (events) ---- */
      (s3Map.get(i) || []).forEach(ev => {
        const r = EPF.s3Step(ev);
        s3.last = Object.assign({ date: D.date[i] }, ev, r);
        if (r.reset) { s4.det = 0; }
        s3.review = r.review || r.s4Review; s3.reviewUntil = i + 63;
        s3.pending = r.pct > 0 ? { pct: r.pct, reason: `S3 ${ev.result}/${ev.guidance}${ev.context !== 'normal' ? '/' + ev.context : ''}: sell ${r.pct}% S0` } : null;
        addLog(i, 'S3', r.pct > 0 ? 'sell' : r.review ? 'watch' : 'ok', `Report ${ev.result}, guidance ${ev.guidance} → ${r.pct ? 'sell ' + r.pct + '% S0' : 'hold'}${r.s4Review ? ' + System 4 review' : ''}`);
      });
      let s3s = (P.s3Events || []).length ? (s3.review && i <= s3.reviewUntil ? 'watch' : 'ok') : 'off';
      if (s3.pending) {
        if (fundRoom > 1e-6) {
          sells.push({ prio: 5, sys: 'S3', qty: Math.min((s3.pending.pct / 100) * S0, fundRoom), reason: s3.pending.reason, fill: () => { s3.pending = null; } });
          s3s = 'sell';
        } else { s3s = 'floor'; s3.pending = null; }
      }

      /* ---- System 0: concentration glide ---- */
      let s0s = 'off';
      if (P.sys0.enabled) {
        const stockVal = st.shares * ci, nwv = stockVal + st.cash + (+P.sys0.otherAssets || 0);
        const target = P.sys0.targetPct / 100, exposure = nwv > 0 ? stockVal / nwv : 0;
        const qk = qKey(date);
        s0s = exposure > target ? 'watch' : 'ok';
        if (exposure <= target) { s0.gliding = false; s0.pendingQty = 0; }
        else if (qk !== s0.q) {
          const excessSh = (stockVal - target * nwv) / ci;
          if (!s0.gliding) { s0.gliding = true; s0.tranche = excessSh / 8; s0.left = 8; addLog(i, 'S0', 'watch', `Exposure ${(exposure * 100).toFixed(1)}% > target: 8-quarter glide started`); }
          const credit = s0.creditQ && s0.creditQ !== qk ? s0.credit : 0;
          s0.pendingQty = Math.max(0, Math.min(s0.tranche, excessSh) - credit);
          s0.left = Math.max(0, s0.left - 1);
          if (s0.left === 0) s0.gliding = false;
          s0.credit = 0; s0.creditQ = qk;
        }
        s0.q = qk;
        if (s0.pendingQty > 1e-6 && exposure > target) {
          sells.push({ prio: 1, sys: 'S0', qty: Math.min(s0.pendingQty, (stockVal - target * nwv) / ci), reason: `S0 concentration tranche (exposure ${(exposure * 100).toFixed(1)}%)`, fill: q => { s0.pendingQty -= q; } });
          s0s = 'sell';
        }
      }

      /* ---- System 5: Mr Market buy engine ---- */
      let s5s = episodes.length ? 'armed' : 'off';
      const blocked = s4.broken || s4.det > 0;
      (fvReMap.get(i) || []).forEach(x => episodes.forEach(ep => {
        if (ep.locks.some(l => !l)) { addLog(i, 'S5', 'armed', `Episode #${ep.id} re-underwritten: FV ${ep.fv ? ep.fv.toFixed(2) : 'n/a'} → ${x.fv.toFixed(2)} (${x.note || 'new fundamentals'})`); ep.fv = x.fv; }
      }));
      const levels = [p.m1, p.m2, p.m3].map(x => x / 100);
      let buy = null;
      if (episodes.length && blocked) s5s = 'blocked';
      else if (!sells.length) {
        for (const ep of episodes) {
          if (!ep.fv || ep.sold <= 0) continue;
          const wsp = ep.proceeds / ep.sold;
          let qty = 0; const hit = [];
          levels.forEach((lv, k) => {
            if (ep.locks[k]) return;
            if (ci <= lv * ep.fv && ci <= lv * wsp) {
              hit.push(k);
              if (k < 2) qty += 0.25 * ep.sold;
            }
          });
          if (!hit.length) continue;
          if (hit.includes(2)) qty = Math.max(0, ep.sold - ep.bought); // M3 = all remaining
          // Cash and concentration-ceiling room checked at signal time
          let room = st.cash / (ci * (1 + fee));
          if (P.sys0.enabled) {
            const nwv = st.shares * ci + st.cash + (+P.sys0.otherAssets || 0);
            room = Math.min(room, Math.max(0, (nwv * P.sys0.targetPct / 100 - st.shares * ci) / ci));
          }
          if (room < 0.01) { s5s = 'floor'; continue; }
          buy = { side: 'buy', sys: 'S5', qty, sig: i, reason: `S5 ${hit.map(k => 'M' + (k + 1)).join('+')} (episode #${ep.id}, FV ${ep.fv.toFixed(2)})`,
            fill: q => { hit.forEach(k => (ep.locks[k] = true)); ep.bought += q; } };
          break;
        }
        if (buy) s5s = 'buy';
      }
      const floorHit = s5s === 'floor';
      const anyWaiting = episodes.some(ep => ep.fv && ep.locks.some(l => !l));
      if (floorHit) s5s = 'floor';
      else if (s5s === 'armed' && !anyWaiting) s5s = episodes.some(ep => !ep.fv) ? 'off' : 'exhausted';

      /* ---- Order selection: one sell per day, priority S4>S3>2Ecat>2Efirst>S2>S0 ---- */
      if (sells.length) {
        sells.sort((a, b) => b.prio - a.prio);
        const s = sells[0];
        pending = { side: 'sell', sys: s.sys, qty: s.qty, reason: s.reason, fill: s.fill, sig: i, deferred: sells.slice(1).map(x => x.sys) };
        if (sells.length > 1) addLog(i, 'Exec', 'watch', `${s.sys} executes; deferred & revalidated next session: ${pending.deferred.join(', ')}`);
      } else if (buy) pending = buy;
      else pending = null;

      out.nw[i] = st.shares * ci + st.cash;
      out.shares[i] = st.shares; out.cash[i] = st.cash;
      out.tl.s0.push(s0s); out.tl.s1.push(s1); out.tl.s2.push(s2s); out.tl.e2.push(e2s);
      out.tl.s3.push(s3s); out.tl.s4.push(s4s); out.tl.s5.push(s5s); out.tlIdx.push(i);

      if (i === n - 1) {
        out.now = {
          date, close: ci, lagCount, votes, voteCount, armConds, s1, s2s, e2s, s3s, s4s, s0s, s5s,
          lenses: { stock: stockWeak ? (lag ? 'sell' : 'weak') : 'ok', peers: I.refName === 'none' ? 'off' : lag ? (lagCount >= p.confirmN ? 'sell' : 'watch') : sectorWeak ? 'sector' : 'ok',
            market: !has(I.benchSma200[i]) ? 'off' : marketBear ? 'sell' : marketWeak ? 'market' : 'ok',
            persist: lagCount >= p.confirmN ? 'sell' : lagCount >= p.watchN ? 'watch' : lagCount > 0 ? 'weak' : 'ok' },
          s2Used: s2.used, e2Used: e2.used, e2Peak: e2.armed ? e2.peak : null, e2Armed: e2.armed,
          s3Last: s3.last, s4Last: s4.last, s4Det: s4.det, s4Broken: s4.broken,
          exposure: P.sys0.enabled ? (st.shares * ci) / (st.shares * ci + st.cash + (+P.sys0.otherAssets || 0)) : null,
          episodes: episodes.map(ep => ({ ...ep, wsp: ep.sold ? ep.proceeds / ep.sold : null })),
          blocked, pending: pending ? { side: pending.side, sys: pending.sys, qty: pending.qty, reason: pending.reason } : null,
          holdingPctS0: st.shares / S0, rs60: I.rs60[i], breadth: I.breadth[i], benchDD: I.benchDD[i], beta: I.beta[i], annVol: I.annVol[i], refName: I.refName
        };
      }
    }
    out.trades = trades; out.log = log; out.episodes = episodes;
    return out;
  };

  /* ---------- Buy & Hold and User ledger ---------- */
  EPF.buyHold = function (D, sim, P) {
    const n = D.close.length, nw = new Array(n).fill(null);
    const cash0 = P.s0Shares > 0 ? 0 : P.initialCapital - sim.S0 * D.close[sim.start];
    const dRate = Math.pow(1 + (P.cashYieldPct || 0) / 100, 1 / 252) - 1;
    let cash = cash0;
    for (let i = sim.start; i < n; i++) { if (i > sim.start) cash *= 1 + dRate; nw[i] = sim.S0 * D.close[i] + cash; }
    return { nw };
  };

  EPF.userPortfolio = function (D, sim, P) {
    const n = D.close.length, nw = new Array(n).fill(null), sh = new Array(n).fill(null);
    const fee = (P.feePct || 0) / 100, dRate = Math.pow(1 + (P.cashYieldPct || 0) / 100, 1 / 252) - 1;
    let shares = sim.S0, cash = P.s0Shares > 0 ? 0 : P.initialCapital - sim.S0 * D.close[sim.start];
    const byIdx = new Map(), applied = [];
    (P.userTrades || []).forEach((t, k) => {
      if (!t.date) return;
      const i = idxOnOrAfter(D.date, t.date);
      if (i < sim.start || i >= n) return;
      if (!byIdx.has(i)) byIdx.set(i, []);
      byIdx.get(i).push({ ...t, k });
    });
    let minCash = cash;
    for (let i = sim.start; i < n; i++) {
      if (i > sim.start) cash *= 1 + dRate;
      (byIdx.get(i) || []).forEach(t => {
        const px = +t.price > 0 ? +t.price : D.close[i];
        const q = Math.max(0, +t.shares || 0);
        if (t.side === 'sell') { const qq = Math.min(q, shares); shares -= qq; cash += qq * px * (1 - fee); applied.push({ ...t, idx: i, price: px, qty: qq }); }
        else { shares += q; cash -= q * px * (1 + fee); applied.push({ ...t, idx: i, price: px, qty: q }); }
      });
      minCash = Math.min(minCash, cash);
      nw[i] = shares * D.close[i] + cash; sh[i] = shares;
    }
    return { nw, shares: sh, applied, minCash };
  };

  EPF.metrics = function (D, series, start, tradesCount) {
    const n = D.close.length, v0 = series[start], v1 = series[n - 1];
    const years = Math.max(1 / 252, (new Date(D.date[n - 1]) - new Date(D.date[start])) / (365.25 * 864e5));
    const { mdd } = EPF.ind.maxDrawdown(series.slice(start));
    return { final: v1, ret: v1 / v0 - 1, cagr: Math.pow(Math.max(1e-9, v1 / v0), 1 / years) - 1, mdd, trades: tradesCount };
  };
})();

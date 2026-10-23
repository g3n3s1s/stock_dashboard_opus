/* Extras (load after framework.js):
   1) EPS-table import -> fair value schedule
   2) My Actions with RSU, cash dividend and reinvested-dividend transactions */
(function () {
  const EPF = (window.EPF = window.EPF || {});

  /* ---------- Date / number parsing for pasted EPS tables ---------- */
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const mk = (y, m, d) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
  };
  const addDays = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

  function extractDate(s) {
    let m;
    if ((m = s.match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/))) return { date: mk(+m[1], +m[2], +m[3]), rest: s.replace(m[0], ' ') };
    if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/))) {
      let a = +m[1], b = +m[2];
      if (a > 12 && b <= 12) { const t = a; a = b; b = t; }   // 30/07/2025 -> day/month
      return { date: mk(+m[3], a, b), rest: s.replace(m[0], ' ') };
    }
    if ((m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/)) && MON[m[1].slice(0, 3).toLowerCase()])
      return { date: mk(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]), rest: s.replace(m[0], ' ') };
    if ((m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/)) && MON[m[2].slice(0, 3).toLowerCase()])
      return { date: mk(+m[3], MON[m[2].slice(0, 3).toLowerCase()], +m[1]), rest: s.replace(m[0], ' ') };
    return null;
  }

  function numbers(s) {
    const t = s.replace(/[−–—]/g, '-')
      .replace(/\b(Q[1-4]|H[12]|FY\s?\d{2,4}|\d{4}\s?Q[1-4])\b/gi, ' ')   // fiscal labels
      .replace(/\b(19|20)\d{2}\b/g, ' ');                                   // stray years
    const out = [], re = /(\()?\s*(-?)\s*\$?\s*(\d+\.?\d*|\.\d+)\s*(\))?/g;
    let m;
    while ((m = re.exec(t))) {
      let v = parseFloat(m[3]);
      if (!isFinite(v)) continue;
      if (m[2] === '-' || (m[1] && m[4])) v = -v;                          // -0.45 or (0.45)
      out.push(v);
    }
    return out;
  }

  /* Returns { rows: [{date, actual, estimate|null}] sorted by date, errors: [text] } */
  EPF.parseEpsTable = function (text) {
    const map = new Map(), errors = [];
    String(text || '').split(/\r?\n/).forEach((raw, ix) => {
      const line = raw.trim();
      if (!line || line[0] === '#') return;
      const d = extractDate(line);
      if (!d) { if (!/^(date|period|quarter)/i.test(line)) errors.push(`Line ${ix + 1}: no date found`); return; }
      if (!d.date) { errors.push(`Line ${ix + 1}: not a real calendar date`); return; }
      const nums = numbers(d.rest);
      if (!nums.length) { errors.push(`Line ${ix + 1}: no EPS value`); return; }
      map.set(d.date, { date: d.date, actual: nums[0], estimate: nums.length > 1 ? nums[1] : null });
    });
    return { rows: Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1)), errors };
  };

  /* Pasted EPS rows -> point-in-time fair value schedule (uses the Profile's multiple,
     confidence, haircut and weight; FCF is not used). lagDays shifts every date later. */
  EPF.scheduleFromEps = function (rows, lagDays, prof, makeS3) {
    const lag = Math.max(0, Math.round(+lagDays || 0));
    const shifted = rows.map(r => ({ date: lag ? addDays(r.date, lag) : r.date, actual: r.actual, estimate: r.estimate }));
    const out = EPF.fvFromEarnings(shifted, prof, makeS3);
    out.sched.forEach(s => { s.note = 'imported EPS table'; });
    return out;
  };

  /* ---------- My Actions ledger ----------
     side: buy | sell | rsu | divcash | divreinv
     buy/sell : shares + price (blank = close); cash moves
     rsu      : net shares credited; price = reference only; no cash
     divcash  : amount = net cash received; shares unchanged
     divreinv : shares credited (or amount / price); no cash change
     RSU and dividends are external inflows. `nw` is actual wealth; `adj` removes the
     inflows with time-weighted returns so it compares fairly with price-only
     Buy & Hold and Framework. */
  EPF.userPortfolio = function (D, sim, P) {
    const n = D.close.length, nw = new Array(n).fill(null), adj = new Array(n).fill(null), sh = new Array(n).fill(null);
    const fee = (P.feePct || 0) / 100, dRate = Math.pow(1 + (P.cashYieldPct || 0) / 100, 1 / 252) - 1;
    let shares = sim.S0, cash = P.s0Shares > 0 ? 0 : P.initialCapital - sim.S0 * D.close[sim.start];
    const byIdx = new Map(), applied = [];
    (P.userTrades || []).forEach((t, k) => {
      if (!t.date) return;
      const i = EPF.idxOnOrAfter(D.date, t.date);
      if (i < sim.start || i >= n) return;
      if (!byIdx.has(i)) byIdx.set(i, []);
      byIdx.get(i).push(Object.assign({}, t, { k }));
    });
    let minCash = cash, hasFlows = false, flowTotal = 0, tradeCount = 0;
    const f2 = v => (+v).toFixed(2), f4 = v => (+v).toFixed(4).replace(/\.?0+$/, '');

    for (let i = sim.start; i < n; i++) {
      if (i > sim.start) cash *= 1 + dRate;
      const close = D.close[i];
      let flow = 0;
      (byIdx.get(i) || []).forEach(t => {
        const side = t.side || 'buy';
        const px = +t.price > 0 ? +t.price : close;
        const q = Math.max(0, +t.shares || 0);
        const amt = Math.max(0, +t.amount || 0);
        if (side === 'sell') {
          const qq = Math.min(q, shares); shares -= qq; cash += qq * px * (1 - fee); tradeCount++;
          applied.push(Object.assign({}, t, { idx: i, price: px, qty: qq, label: `Sell ${f4(qq)} @ ${f2(px)}` }));
        } else if (side === 'rsu') {
          shares += q; flow += q * close;
          applied.push(Object.assign({}, t, { idx: i, price: px, qty: q, label: `RSU received ${f4(q)} sh (ref ${f2(px)})` }));
        } else if (side === 'divcash') {
          cash += amt; flow += amt;
          applied.push(Object.assign({}, t, { idx: i, price: close, qty: 0, label: `Cash dividend ${f2(amt)}` }));
        } else if (side === 'divreinv') {
          const qq = q > 0 ? q : (amt > 0 ? amt / px : 0);
          shares += qq; flow += qq * close;
          applied.push(Object.assign({}, t, { idx: i, price: px, qty: qq, label: `Dividend reinvested ${f4(qq)} sh @ ${f2(px)}` }));
        } else {
          shares += q; cash -= q * px * (1 + fee); tradeCount++;
          applied.push(Object.assign({}, t, { idx: i, price: px, qty: q, label: `Buy ${f4(q)} @ ${f2(px)}` }));
        }
      });
      minCash = Math.min(minCash, cash);
      const val = shares * close + cash;
      nw[i] = val; sh[i] = shares;
      if (flow) { hasFlows = true; flowTotal += flow; }
      if (i === sim.start) adj[i] = val - flow;                       // starting capital excludes inflows
      else {
        const prev = nw[i - 1], r = prev > 0 ? (val - flow) / prev - 1 : 0;
        adj[i] = adj[i - 1] * (1 + r);
      }
    }
    return { nw, adj, shares: sh, applied, minCash, hasFlows, flowTotal, tradeCount };
  };
})();

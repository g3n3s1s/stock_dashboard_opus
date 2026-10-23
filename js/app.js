/* UI controller */
(function () {
  const EPF = (window.EPF = window.EPF || {});
  const $ = id => document.getElementById(id);
  const store = EPF.store;

  /* ---------- Colour language (single source for dots, timeline and legend) ---------- */
  const COLORS = {
    ok:        { c: '#22c55e', l: 'Healthy / hold' },
    weak:      { c: '#facc15', l: 'Weakness observed (diagnostic only)' },
    watch:     { c: '#fb923c', l: 'Watch / candidate / review' },
    sell:      { c: '#ef4444', l: 'Sell signal (executes next session)', pulse: true },
    buy:       { c: '#2dd4bf', l: 'Buy signal (value level reached)', pulse: true },
    armed:     { c: '#3b82f6', l: 'Armed / waiting for value' },
    market:    { c: '#f472b6', l: 'Market-wide weakness' },
    sector:    { c: '#a855f7', l: 'Sector-wide weakness' },
    veto:      { c: '#a3e635', l: 'Trend veto applied (sale cancelled)' },
    floor:     { c: '#e5e7eb', l: 'Floor or ceiling reached' },
    exhausted: { c: '#475569', l: 'Reserve used / level locked' },
    blocked:   { c: '#7f1d1d', l: 'Blocked — System 4 condition active' },
    off:       { c: 'transparent', ring: '#94a3b8', l: 'Inactive / no data' }
  };
  EPF.COLORS = COLORS;

  const dotHtml = (code, size, tip) => {
    const k = COLORS[code] || COLORS.off;
    const style = k.ring ? `border-color:${k.ring};background:transparent` : `background:${k.c};color:${k.c}`;
    return `<span class="dot ${size || ''} ${k.pulse && size === 'lg' ? 'pulse' : ''}" style="${style}" title="${(tip || k.l).replace(/"/g, '&quot;')}"></span>`;
  };

  const S = { sym: null, prof: null, raw: null, D: null, I: null, sim: null, bh: null, user: null };
  const fmt = (v, d = 2) => (v == null || !isFinite(v) ? '–' : (+v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d) + '%');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  EPF.ui = {
    dotHtml,
    status(msg, type) { const el = $('status'); el.textContent = msg || ''; el.className = 'status ' + (type || ''); }
  };
  const status = EPF.ui.status;
  
  /* ---------- Signal detail popup ---------- */

  function openSignalDetail(name, code, text) {
    const popup = $('signalDetail');

    if (!popup) return;

    $('signalDetailName').textContent = name || 'Signal';
    $('signalDetailText').textContent = text || 'No additional information available.';
    $('signalDetailDot').innerHTML = dotHtml(code || 'off', 'lg');

    popup.classList.remove('hidden');

    /*
     * Prevent the mobile page behind the bottom sheet from moving while
     * the user reads the explanation.
     */
    document.body.dataset.signalScrollY = String(window.scrollY);
    document.body.style.overflow = 'hidden';
  }

  function closeSignalDetail() {
    const popup = $('signalDetail');

    if (!popup || popup.classList.contains('hidden')) return;

    popup.classList.add('hidden');
    document.body.style.overflow = '';
  }
  
  /* ---------- Profiles & watchlist ---------- */
  const loadProfile = sym => {
    const p = store.get('profile:' + sym, null);
    const d = EPF.defaultProfile(sym);
    if (!p) return d;
    return Object.assign(d, p, { sys0: Object.assign(d.sys0, p.sys0), p: Object.assign(d.p, p.p), fv: Object.assign(d.fv, p.fv) });
  };
  const saveProfile = () => S.prof && store.set('profile:' + S.sym, S.prof);
  const watchlist = () => store.get('watchlist', []);

  function renderWatchlist() {
    const wl = watchlist();
    $('watchlist').innerHTML = wl.length ? wl.map(w => `<span class="chip ${w.symbol === S.sym ? 'active' : ''}" data-s="${esc(w.symbol)}" title="${esc(w.name || '')} ${esc(w.exchange || '')}">${esc(w.symbol)}<span class="x" data-x="${esc(w.symbol)}">✕</span></span>`).join('') : '<span class="muted">empty — search a stock to add it</span>';
    $('watchlist').querySelectorAll('.chip').forEach(ch => ch.onclick = e => {
      const x = e.target.dataset.x;
      if (x) {
        e.stopPropagation();
        store.set('watchlist', watchlist().filter(w => w.symbol !== x));
        if (S.sym === x) { S.sym = null; showEmpty(true); }
        renderWatchlist(); return;
      }
      selectStock(ch.dataset.s);
    });
    const active = $('watchlist').querySelector('.chip.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function addStock(meta) {
    const sym = meta.symbol.toUpperCase();
    const wl = watchlist().filter(w => w.symbol !== sym);
    wl.push({ symbol: sym, mic: meta.mic_code || '', name: meta.instrument_name || '', exchange: meta.exchange || '' });
    store.set('watchlist', wl);
    const prof = loadProfile(sym);
    prof.mic = meta.mic_code || prof.mic || ''; prof.name = meta.instrument_name || prof.name || '';
    store.set('profile:' + sym, prof);
    selectStock(sym);
  }

  /* ---------- Search ---------- */
  async function doSearch() {
    const q = $('searchInput').value.trim();
    if (!q) return;
    $('searchInput').blur(); // closes the iPhone keyboard so results are visible
    const box = $('searchResults');
    try {
      status('Searching…');
      const res = await EPF.api.search(q);
      status('');
      if (!res.length) { box.innerHTML = `<div data-i="-1"><b>${esc(q.toUpperCase())}</b> Load this ticker directly</div>`; }
      else box.innerHTML = res.map((r, i) => `<div data-i="${i}"><b>${esc(r.symbol)}</b>${esc(r.instrument_name)} <small>· ${esc(r.exchange)} · ${esc(r.country || '')} · ${esc(r.currency || '')}</small></div>`).join('');
      box.classList.remove('hidden');
      box.querySelectorAll('div').forEach(d => d.onclick = () => {
        const i = +d.dataset.i; box.classList.add('hidden'); $('searchInput').value = '';
        addStock(i < 0 ? { symbol: q } : res[i]);
      });
    } catch (e) { status(e.message, 'err'); }
  }

  /* ---------- Load & run ---------- */
  async function selectStock(sym, force) {
    S.sym = sym; S.prof = loadProfile(sym);
    store.set('active', sym);
    renderWatchlist();
    try {
      const P = S.prof;
      const stock = await EPF.api.timeSeries(sym, P.mic, force);
      let bench = null; const peers = [];
      if (P.benchmark) { try { bench = await EPF.api.timeSeries(P.benchmark, '', force); } catch (e) { status(`Benchmark ${P.benchmark}: ${e.message}`, 'warn'); } }
      for (const ps of P.peers) { try { peers.push(await EPF.api.timeSeries(ps, '', force)); } catch (e) { status(`Peer ${ps}: ${e.message}`, 'warn'); } }
      S.raw = { stock, bench, peers };
      run();
      status(`${sym}: ${stock.date.length} sessions loaded (${stock.date[0]} → ${stock.date[stock.date.length - 1]}).`, 'ok');
    } catch (e) { status(e.message, 'err'); }
  }

  function run() {
    if (!S.raw) return;
    try {
      const { stock, bench, peers } = S.raw;
      S.D = EPF.align(stock, bench, peers);
      S.I = EPF.prepare(S.D);
      S.sim = EPF.simulate(S.D, S.I, S.prof);
      S.bh = EPF.buyHold(S.D, S.sim, S.prof);
      S.user = EPF.userPortfolio(S.D, S.sim, S.prof);
      showEmpty(false);
      renderAll();
    } catch (e) { console.error(e); status('Engine error: ' + e.message, 'err'); }
  }

  function showEmpty(on) {
    $('empty').classList.toggle('hidden', !on);
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', on || t.id !== 'tab-' + activeTab));
  }

  /* ---------- Tabs ---------- */
  let activeTab = 'dash';
  $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    activeTab = b.dataset.tab;
    if (b.scrollIntoView) b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 'tab-' + activeTab || (!S.sim && activeTab !== 'guide')));
    if (activeTab === 'guide') $('empty').classList.add('hidden');
    if (S.sim) renderAll();
  });

  function renderAll() {
    renderDashboard();
    renderNetWorth();
    renderProfile();
    renderUserTable();
    renderLog();
  }

  /* ---------- Dashboard ---------- */
  function gaugeHtml(value, max, color, marks) {
    const w = Math.max(0, Math.min(100, (value / max) * 100));
    return `<div class="fill" style="width:${w}%;background:${color}"></div>` + (marks || []).map(m => `<div class="mark" style="left:${(m / max) * 100}%"></div>`).join('');
  }
  const bar = (used, cap, color) => `<div class="minibar" title="Reserve used ${(used * 100).toFixed(1)}% of ${cap}% S0"><div style="width:${Math.min(100, (used * 100 / cap) * 100)}%;background:${color}"></div></div>`;

  function renderDashboard() {
    const { D, sim, bh, prof, I } = S, now = sim.now, n = D.close.length, i = n - 1;
    const P = prof.p;
    const chg = D.close[n - 1] / D.close[n - 2] - 1;
    $('kLast').innerHTML = `${esc(S.sym)} ${fmt(now.close)}`;
    $('kLastSub').textContent = `${now.date} · ${chg >= 0 ? '+' : ''}${pct(chg, 2)} · β ${fmt(now.beta)} · vol ${pct(now.annVol, 0)}`;
    const h = now.holdingPctS0;
    $('kHold').textContent = `${pct(h, 1)} (${fmt(sim.shares[n - 1], 2)} sh)`;
    const hc = h >= 0.65 ? COLORS.ok.c : h >= 0.25 ? COLORS.watch.c : COLORS.sell.c;
    $('gHold').innerHTML = gaugeHtml(h * 100, Math.max(100, h * 100), hc, [25, 65]);
    if (now.pending) {
      const p = now.pending, code = p.side === 'sell' ? 'sell' : 'buy';
      $('kAction').innerHTML = `${dotHtml(code, 'lg', p.reason)}<div><b>${p.side.toUpperCase()} ${fmt(p.qty, 2)} sh</b><br><small>${esc(p.reason)}</small></div>`;
    } else $('kAction').innerHTML = `${dotHtml('ok', 'lg', 'No order for the next session')}<div><b>No order</b><br><small>Hold</small></div>`;
    const fw = sim.nw[n - 1], b = bh.nw[n - 1];
    $('kNw').innerHTML = `${fmt(fw, 0)} <small>vs</small> ${fmt(b, 0)}`;
    $('kNwSub').innerHTML = `${dotHtml(fw >= b ? 'ok' : 'watch', 'sm', fw >= b ? 'Framework ahead of buy & hold' : 'Framework behind buy & hold')} difference ${fw >= b ? '+' : ''}${fmt(fw - b, 0)} (${pct(fw / b - 1)})`;

    /* Registry of tappable items (small dots, status lines, M1/M2/M3 pills) */
    const subs = [];
    const cl = code => 'Colour now: ' + (COLORS[code] || COLORS.off).l;
    const sub = (code, label, name, detail) => {
      subs.push({ code, name, detail: `${detail}\n\n${cl(code)}` });
      return `<span class="subsig" data-sub="${subs.length - 1}" role="button" tabindex="0" aria-label="${esc(name)} details">${dotHtml(code, 'xs', name + ' (tap for details)')}${label}</span>`;
    };
    const line = (code, text, name, detail) => {
      subs.push({ code, name, detail: `${detail}\n\n${cl(code)}` });
      return `<div class="subline subsig" data-sub="${subs.length - 1}" role="button" tabindex="0" aria-label="${esc(name)} details">${dotHtml(code, 'xs', name + ' (tap for details)')}<span>${esc(text)}</span></div>`;
    };

    const v = now.votes, a = now.armConds;
    const vc = x => (x ? 'sell' : 'ok');
    const ac = x => (x ? 'armed' : 'off');
    const refTxt = now.refName === 'peers' ? 'your peer basket' : now.refName === 'benchmark' ? 'the benchmark' : 'nothing (add peers or a benchmark in Profile)';
    const gap = (x, ma) => (x != null && ma ? x / ma - 1 : null);
    const s2tail = `\n\nSystem 2 needs confirmed relative lag (${P.confirmN} closes in a row) plus at least 2 of these 4 votes. Votes ON now: ${now.voteCount} of 4. Lag closes now: ${now.lagCount}.`;
    const e2tail = `\n\nAll four conditions must be true at the same time to arm the extreme-reversal overlay. Armed now: ${now.e2Armed ? 'yes' : 'no'}. Arming alone never sells; it only starts tracking the peak.`;

    /* Reserve / recovery state (kept separate from the current evidence) */
    const s2done = now.s2Used >= P.s2Cap / 100 - 1e-9, e2done = now.e2Used >= P.eCap / 100 - 1e-9;
    const soldSh = now.episodes.reduce((t, e) => t + (e.sold || 0), 0);
    const boughtSh = now.episodes.reduce((t, e) => t + (e.bought || 0), 0);
    const evClear = now.voteCount === 0 && now.lagCount === 0;
    const evCode = now.lagCount >= P.confirmN && now.voteCount >= 2 ? 'sell' : evClear ? 'ok' : 'weak';

    const cards = [];
    cards.push({ name: 'S0 · Concentration', code: now.s0s,
      tip: prof.sys0.enabled ? `Exposure ${pct(now.exposure)} vs target ${prof.sys0.targetPct}%` : 'Disabled (enable in profile; needs other investable assets)',
      extra: prof.sys0.enabled ? `<div class="gauge">${gaugeHtml(now.exposure * 100, Math.max(prof.sys0.targetPct * 2, now.exposure * 100), now.exposure * 100 > prof.sys0.targetPct ? COLORS.watch.c : COLORS.ok.c, [prof.sys0.targetPct])}</div>` : '' });

    cards.push({ name: 'S1 · Noise filter', code: now.s1, tip: `Relative lag ${now.lagCount} closes · RS 60d ${pct(now.rs60)} vs ${now.refName}`,
      extra: `<div class="sub">` +
        sub(now.lenses.stock, 'Stock', 'Stock lens',
          `Close ${fmt(now.close)} · SMA50 ${fmt(I.sma50[i])} · SMA200 ${fmt(I.sma200[i])}\nWeekly MACD ${fmt(I.wmacd[i], 3)} vs signal ${fmt(I.wsig[i], 3)}\nVolatility-adjusted drawdown ${fmt(I.mag[i])} (vote at ${P.magK})\n\nLooks at the stock on its own: price below its averages, weekly MACD below signal, or a large drawdown for its volatility. Weakness is only observed here; it never sells by itself.`) +
        sub(now.lenses.peers, 'Peers', 'Peer lens',
          `Relative strength (stock ÷ ${refTxt}) over 60 sessions: ${pct(now.rs60)}\nPeers above their SMA50: ${pct(now.breadth, 0)}\nLag closes in a row: ${now.lagCount}\n\nSeparates company weakness from a sector-wide move. Lag means relative strength fell ${P.lagPct}% or more over 60 sessions.`) +
        sub(now.lenses.market, 'Market', 'Market lens',
          `Benchmark close ${fmt(D.bench[i])} vs its SMA200 ${fmt(I.benchSma200[i])}\nBenchmark drawdown from its 252-session high: ${pct(now.benchDD)}\n\nSeparates company weakness from market-wide risk: benchmark below its 200-day average, or down 10% (weak market) or 20% (bear market) from its high.`) +
        sub(now.lenses.persist, 'Persist', 'Persistence',
          `${now.lagCount} closes in a row of relative lag.\nWatch at ${P.watchN} closes, confirmed candidate at ${P.confirmN}.\n\nFilters brief noise: weakness must persist before System 2 is allowed to act.`) +
        `</div><div class="minibar" title="Persistence ${now.lagCount}/${P.confirmN}"><div style="width:${Math.min(100, now.lagCount / P.confirmN * 100)}%;background:${now.lagCount >= P.confirmN ? COLORS.sell.c : now.lagCount >= P.watchN ? COLORS.watch.c : COLORS.weak.c}"></div></div>` });

    cards.push({ name: 'S2 · Ordinary protection', code: now.s2s,
      tip: `Evidence: ${now.voteCount}/4 votes, ${now.lagCount} lag closes.\nReserve: ${pct(now.s2Used)} of ${P.s2Cap}% S0 used${s2done ? ' (EXHAUSTED: S2 cannot sell again, and nothing refills it, including S5 buy-backs).' : '.'}\nAfter any sale, re-entry is by System 5 valuation only.`,
      extra: `<div class="sub">` +
        sub(vc(v[0]), 'Trend', 'Trend vote',
          `Close ${fmt(now.close)} · SMA50 ${fmt(I.sma50[i])} · SMA200 ${fmt(I.sma200[i])}\n\nVote is ON when the close is below SMA50 and either below SMA200 or SMA50 has fallen over the last 5 sessions.${s2tail}`) +
        sub(vc(v[1]), 'wMACD', 'Weekly MACD vote',
          `Weekly MACD ${fmt(I.wmacd[i], 3)} vs signal line ${fmt(I.wsig[i], 3)}\n\nVote is ON when weekly MACD is below its signal line.${s2tail}`) +
        sub(vc(v[2]), 'Magn.', 'Magnitude vote',
          `Value ${fmt(I.mag[i])} (vote ON at ${P.magK} or more)\n\nHow far price is below its 60-session high, measured in units of recent volatility. A big fall in a calm stock counts for more than the same fall in a wild one.${s2tail}`) +
        sub(vc(v[3]), 'β-resid', 'Beta-residual vote',
          `60-session return not explained by the benchmark: ${pct(I.resid60[i])}\nVote is ON at −${P.betaResidPct}% or worse.\n\nRemoves the part of the move that the market explains, leaving the company-specific part.${s2tail}`) +
        `</div>` +
        line(evCode, evClear ? 'Evidence: cleared (0/4)' : `Evidence: ${now.voteCount}/4 · lag ${now.lagCount}d`, 'S2 evidence',
          `Evidence is re-checked every trading day and can clear on its own.\n\nVotes ON now: ${now.voteCount} of 4. Relative-lag closes in a row: ${now.lagCount} (confirmed at ${P.confirmN}).\n\nS2 may sell only when lag is confirmed and at least 2 of 4 votes are ON, and only while it still has reserve left.`) +
        line(s2done ? 'exhausted' : 'ok', s2done ? `Reserve: EXHAUSTED ${pct(now.s2Used)} / ${P.s2Cap}% S0` : `Reserve: ${pct(now.s2Used)} of ${P.s2Cap}% S0 used`, 'S2 reserve',
          s2done
            ? `S2 has sold its full ${P.s2Cap}% of S0 (initial ${P.s2Init}% + extension ${P.s2Ext}%).\n\nThis reserve does NOT refill when the evidence clears, when the price recovers, or when System 5 buys shares back. It resets only if you change the backtest start date, which starts a new simulation.\n\nOther systems can still sell: S2E (its own ${P.eCap}% reserve), S3 and S4, and S0 if enabled. S2 and S2E together can never take the holding below the ${P.techFloor}% technical floor.`
            : `S2 has used ${pct(now.s2Used)} of its ${P.s2Cap}% of S0 reserve. Every S2 sale permanently uses reserve; it is never refilled.`) +
        (soldSh > 0 ? line('armed', 'Re-entry: S5 valuation only', 'Re-entry rule',
          `Technical recovery (price back above SMA50, MACD turning up, RSI rebound, new highs) never triggers a buy.\n\nOnly System 5 can buy back, when the price reaches M1/M2/M3: below both the frozen fair value and the average sell price of the episode.\n\nShares sold by the framework so far: ${fmt(soldSh, 2)} · bought back: ${fmt(boughtSh, 2)}.`) : '') +
        bar(now.s2Used, P.s2Cap, COLORS.exhausted.c) });

    cards.push({ name: 'S2E · Extreme reversal', code: now.e2s,
      tip: (now.e2Armed ? `Armed · tracked peak ${fmt(now.e2Peak)} · ${pct(1 - now.close / now.e2Peak)} below.` : 'Not armed.') + `\nReserve: ${pct(now.e2Used)} of ${P.eCap}% S0 used${e2done ? ' (EXHAUSTED).' : '.'}`,
      extra: `<div class="sub">` +
        sub(ac(a[0]), `RSI≥${P.eRsi}`, 'RSI condition',
          `RSI(14) now ${fmt(I.rsi[i], 1)} · needs ${P.eRsi} or more.${e2tail}`) +
        sub(ac(a[1]), '>SMA50', 'Above SMA50 condition',
          `Price is ${pct(gap(now.close, I.sma50[i]))} versus SMA50 ${fmt(I.sma50[i])} · needs +${P.eAbove50}% or more.${e2tail}`) +
        sub(ac(a[2]), '>SMA20', 'Above SMA20 condition',
          `Price is ${pct(gap(now.close, I.sma20[i]))} versus SMA20 ${fmt(I.sma20[i])} · needs +${P.eAbove20}% or more.${e2tail}`) +
        sub(ac(a[3]), `20d≥${P.eRet20}%`, '20-session return condition',
          `20-session return ${pct(I.ret20[i])} · needs +${P.eRet20}% or more.${e2tail}`) +
        `</div>` +
        line(e2done ? 'exhausted' : 'ok', e2done ? `Reserve: EXHAUSTED ${pct(now.e2Used)} / ${P.eCap}% S0` : `Reserve: ${pct(now.e2Used)} of ${P.eCap}% S0 used`, 'S2E reserve',
          `S2E has its own reserve of ${P.eCap}% of S0, separate from S2's ${P.s2Cap}%. ${e2done ? 'It is used up and does not refill (S5 buy-backs do not reset it).' : 'Every S2E sale permanently uses reserve.'}\n\nS2 and S2E together can never take the holding below the ${P.techFloor}% technical floor.`) +
        bar(now.e2Used, P.eCap, COLORS.exhausted.c) });

    const s3l = now.s3Last;
    cards.push({ name: 'S3 · Fundamentals', code: now.s3s, tip: s3l ? `Last report ${s3l.date}: ${s3l.result}, guidance ${s3l.guidance} → ${s3l.pct ? 'sell ' + s3l.pct + '% S0' : 'hold'}` : 'No earnings events entered', extra: '' });
    cards.push({ name: 'S4 · Full exit', code: now.s4s, tip: now.s4Broken ? 'Thesis broken / distress' : now.s4Det ? `Peer-relative deterioration count ${now.s4Det}` : (now.s4Last ? 'Thesis intact' : 'No System 4 events entered'), extra: '' });

    const eps = now.episodes.filter(e => e.locks.some(l => !l)).slice(-3);
    const lv = [P.m1, P.m2, P.m3];
    const epHtml = eps.map(ep => {
      const pills = ep.locks.map((l, k) => {
        const thr = ep.fv ? Math.min(lv[k] / 100 * ep.fv, lv[k] / 100 * ep.wsp) : null;
        const code = !ep.fv ? 'off' : l ? 'exhausted' : now.close <= thr ? 'buy' : 'armed';
        const col = COLORS[code];
        const state = !ep.fv ? 'No fair value was on file when this episode opened, so no buy is possible.'
          : l ? 'Already used. This level is permanently locked.'
          : now.close <= thr ? 'Both conditions are met now: buy signal for the next session.'
          : 'Waiting: the price is still above the buy threshold.';
        const size = k < 2 ? '25% of the shares sold in this episode' : 'all remaining shares from this episode (about 50%)';
        subs.push({ code, name: `M${k + 1} buy level · episode #${ep.id}`,
          detail: `Opened ${ep.openDate}\nFrozen fair value ${fmt(ep.fv)} · average sell price ${fmt(ep.wsp)}\nBuy threshold ${thr ? fmt(thr) : 'n/a'} (${lv[k]}% of the lower of those two)\nLast close ${fmt(now.close)}\n\n${state}\n\nBuys ${size}. Each level can be used only once.\n\n${cl(code)}` });
        return `<span class="pill" data-sub="${subs.length - 1}" role="button" tabindex="0" style="background:${col.ring ? 'transparent' : col.c};${col.ring ? 'border:1px solid ' + col.ring + ';color:#94a3b8' : ''}" title="M${k + 1}: buy when ≤ ${thr ? fmt(thr) : 'n/a'} (tap for details)">M${k + 1}</span>`;
      }).join(' ');
      return `<div style="margin-top:8px" title="Episode #${ep.id} opened ${ep.openDate}">#${ep.id} ${pills}</div>`;
    }).join('');
    const recovered = soldSh > 0 ? line(boughtSh >= soldSh - 1e-6 ? 'ok' : 'armed', `Recovered: ${fmt(boughtSh, 1)} / ${fmt(soldSh, 1)} sh`, 'S5 recovery',
      `Shares sold by the framework in all episodes: ${fmt(soldSh, 2)}\nShares bought back by System 5: ${fmt(boughtSh, 2)}\n\nBuy-backs happen only at the M1/M2/M3 value levels. They do not refill the S2 or S2E reserves.`) : '';
    cards.push({ name: 'S5 · Mr Market buys', code: now.s5s, tip: now.blocked ? 'Buying blocked while System 4 condition active' : `${eps.length} episode(s) with unused levels`,
      extra: (epHtml || '<div class="sub muted" style="font-size:11px">no open reserve</div>') + recovered });

    $('signalGrid').innerHTML = cards.map((c, idx) =>
      `<div class="sys">
        <div class="head" data-signal-index="${idx}" role="button" tabindex="0" aria-label="${esc(c.name)} signal details">
          ${dotHtml(c.code, 'lg', c.tip)}
          <div class="name">${c.name}</div>
        </div>
        ${c.extra}
      </div>`).join('');

    /* Tap / click / keyboard handlers */
    const bindTap = (el, fn) => {
      el.addEventListener('click', fn);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    };
    const grid = $('signalGrid');
    grid.querySelectorAll('[data-signal-index]').forEach(el => bindTap(el, () => {
      const c = cards[+el.dataset.signalIndex];
      if (c) openSignalDetail(c.name, c.code, c.tip);
    }));
    grid.querySelectorAll('[data-sub]').forEach(el => bindTap(el, () => {
      const s = subs[+el.dataset.sub];
      if (s) openSignalDetail(s.name, s.code, s.detail);
    }));

    renderLegend('legend');
    if (activeTab === 'dash') {
      EPF.charts.timeline($('timeline'), $('tlTip'), D, sim, COLORS, +$('tlRange').value);
      EPF.charts.price($('priceChart'), D, S.I, sim, S.user);
    }
  }
  
  function renderLegend(id) {
    $(id).innerHTML = Object.entries(COLORS).map(([k, c]) => `<span>${dotHtml(k, 'sm')}${c.l}</span>`).join('') +
      `<span><b style="color:#ef4444">▼</b>/<b style="color:#2dd4bf">▲</b> trade executed</span>`;
  }

  /* ---------- Net worth ---------- */
  function renderNetWorth() {
    const { D, sim, bh, user } = S;
    const mineLabel = user.hasFlows ? 'My Actions (excl. RSU & dividends)' : 'My Actions';
    const actualLabel = 'My Actions (actual, incl. RSU & dividends)';
    const series = [
      { label: 'Buy & Hold', data: bh.nw, color: '#94a3b8' },
      { label: 'Framework', data: sim.nw, color: '#3b82f6', width: 2.2 },
      { label: mineLabel, data: user.adj, color: '#f472b6' }
    ];
    if (user.hasFlows) series.push({ label: actualLabel, data: user.nw, color: '#fbbf24', width: 1.2 });
    if (activeTab === 'nw') EPF.charts.netWorth($('nwChart'), $('ddChart'), D, sim.start, series);

    const rows = [
      ['Buy & Hold', EPF.metrics(D, bh.nw, sim.start, 0), '#94a3b8', true],
      ['Framework', EPF.metrics(D, sim.nw, sim.start, sim.trades.length), '#3b82f6', true],
      [mineLabel, EPF.metrics(D, user.adj, sim.start, user.tradeCount), '#f472b6', true]
    ];
    if (user.hasFlows) rows.push([actualLabel, EPF.metrics(D, user.nw, sim.start, user.tradeCount), '#fbbf24', false]);
    const cmp = rows.filter(r => r[3]);
    const best = Math.max(...cmp.map(r => r[1].final)), shallow = Math.max(...cmp.map(r => r[1].mdd));
    const bhFinal = rows[0][1].final;
    $('scorecard').innerHTML = `<table><tr><th></th><th class="num">Final net worth</th><th class="num">Total return</th><th class="num">CAGR</th><th class="num">Max drawdown</th><th class="num">Trades</th><th class="num">vs Buy & Hold</th></tr>` +
      rows.map(([name, m, col, like]) => `<tr class="${like && m.final === best ? 'best' : ''}"><td><span class="dot sm" style="background:${col}"></span> ${name} ${like && m.final === best ? dotHtml('ok', 'sm', 'Highest ending wealth') : ''} ${like && m.mdd === shallow ? dotHtml('armed', 'sm', 'Shallowest drawdown') : ''}</td><td class="num">${fmt(m.final, 0)}</td><td class="num">${pct(m.ret)}</td><td class="num">${pct(m.cagr, 2)}</td><td class="num">${pct(m.mdd)}</td><td class="num">${m.trades}</td><td class="num">${fmt(m.final - bhFinal, 0)}</td></tr>`).join('') +
      `</table><p class="muted">Period ${D.date[sim.start]} → ${D.date[D.date.length - 1]} · S0 = ${fmt(sim.S0, 2)} shares · <span class="dot sm" style="background:${COLORS.ok.c}"></span> highest ending wealth (like-for-like rows) · <span class="dot sm" style="background:${COLORS.armed.c}"></span> shallowest drawdown</p>`;
    const notes = [];
    if (user.minCash < -1) notes.push(`Your buys exceeded available cash (lowest cash ${fmt(user.minCash, 0)}). Negative cash is treated as extra capital injected.`);
    if (user.hasFlows) notes.push(`RSU and dividend inflows (total ${fmt(user.flowTotal, 0)}) are removed from the "excl." line using time-weighted returns, so it compares fairly with Buy & Hold and Framework, which use price data only. The "actual" line is your real wealth including them.`);
    $('userNote').textContent = notes.join(' ');
  }
  
  /* ---------- Generic editable table ---------- */
  function editableTable(el, rows, cols, onChange, extraBtn) {
    const cell = (c, r, i) => {
      const v = r[c.key] ?? '';
      if (c.type === 'select') return `<select data-i="${i}" data-k="${c.key}">${c.options.map(o => `<option value="${o[0]}" ${o[0] === v ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
      if (c.type === 'checkbox') return `<input type="checkbox" data-i="${i}" data-k="${c.key}" ${v ? 'checked' : ''}/>`;
      return `<input type="${c.type || 'text'}" step="any" data-i="${i}" data-k="${c.key}" value="${esc(v)}"/>`;
    };
    el.innerHTML = `<div class="table-wrap"><table><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}<th></th></tr>` +
      rows.map((r, i) => `<tr>${cols.map(c => `<td>${cell(c, r, i)}</td>`).join('')}<td><button class="btn sm danger" data-del="${i}">✕</button></td></tr>`).join('') +
      `</table></div><div class="row"><button class="btn sm" data-add="1">+ Add row</button>${extraBtn || ''}</div>`;
    el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
      const c = cols.find(x => x.key === inp.dataset.k), r = rows[+inp.dataset.i];
      r[c.key] = c.type === 'checkbox' ? inp.checked : c.type === 'number' ? (inp.value === '' ? '' : +inp.value) : inp.value;
      onChange();
    });
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { rows.splice(+b.dataset.del, 1); onChange(true); });
    el.querySelector('[data-add]').onclick = () => {
      const r = {}; cols.forEach(c => (r[c.key] = c.type === 'select' ? c.options[0][0] : c.type === 'checkbox' ? false : c.key === 'date' ? S.D.date[S.D.date.length - 1] : ''));
      rows.push(r); onChange(true);
    };
  }
  const commit = () => { saveProfile(); run(); };

  /* ---------- Profile tab ---------- */
  const PROFILE_FIELDS = [
    ['name', 'Company name', 'text'],
    ['businessClass', 'Business class', 'select', [['compounder', 'Stable compounder'], ['cyclical', 'Cyclical'], ['financial', 'Financial'], ['reit', 'REIT / asset-heavy'], ['growth', 'Pre-profit / high growth']]],
    ['benchmark', 'Benchmark ticker (e.g. SPY, QQQ, SOXX)', 'text'],
    ['peers', 'Peer basket, 3–5 tickers, comma separated', 'list'],
    ['startDate', 'Backtest start date (blank = ~1 year after first data)', 'date'],
    ['initialCapital', 'Starting capital for this stock', 'number'],
    ['s0Shares', 'S0 shares override (0 = from capital)', 'number'],
    ['feePct', 'Fee per trade %', 'number'],
    ['cashYieldPct', 'Cash yield % p.a.', 'number'],
    ['sys0.enabled', 'Enable System 0 (concentration)', 'checkbox'],
    ['sys0.otherAssets', 'Other investable assets (excluding this stock)', 'number'],
    ['sys0.targetPct', 'Concentration target %', 'number']
  ];
  const PARAMS = [
    ['lagPct', 'Relative lag: RS 60-session change ≤ −%'], ['watchN', 'Persistence: watch after N closes'], ['confirmN', 'Persistence: confirmed after N closes'],
    ['magK', 'Magnitude vote: vol-adjusted drawdown ≥'], ['betaResidPct', 'Beta-residual vote ≤ −%'],
    ['s2Init', 'S2 initial sale % S0'], ['s2Ext', 'S2 extension % S0'], ['s2ExtN', 'S2 extension after N sessions'], ['s2Cap', 'S2 reserve cap % S0'], ['s2Cooldown', 'S2 cooldown sessions'],
    ['eRsi', '2E arm: RSI ≥'], ['eAbove50', '2E arm: % above SMA50'], ['eAbove20', '2E arm: % above SMA20'], ['eRet20', '2E arm: 20-session return %'],
    ['eExpiry', '2E expiry: sessions without new high'], ['eCand', '2E candidate: % below peak'], ['eWindow', '2E confirmation window'],
    ['eCatDD', '2E catastrophic: % below peak'], ['eCatWin', '2E catastrophic window'], ['eCatDown', '2E big down day %'], ['eCatVol', '2E volume multiple'],
    ['eFirst', '2E first sale % S0'], ['eSecond', '2E catastrophic sale % S0'], ['eCap', '2E reserve cap % S0'],
    ['techFloor', 'Technical floor % S0'], ['fundFloor', 'Fundamental floor % S0'],
    ['m1', 'M1 level % of FV & sell price'], ['m2', 'M2 level %'], ['m3', 'M3 level %'], ['episodeGap', 'Sales join an episode within N sessions']
  ];
  const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };

  function renderProfile() {
    const P = S.prof;
    $('profileForm').innerHTML = PROFILE_FIELDS.map(([k, label, type, opts]) => {
      const v = getPath(P, k);
      if (type === 'select') return `<label>${label}<select data-p="${k}">${opts.map(o => `<option value="${o[0]}" ${o[0] === v ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label>`;
      if (type === 'checkbox') return `<label class="check"><input type="checkbox" data-p="${k}" ${v ? 'checked' : ''}/>${label}</label>`;
      if (type === 'list') return `<label>${label}<input data-p="${k}" data-list="1" value="${esc((v || []).join(', '))}"/></label>`;
      return `<label>${label}<input type="${type}" step="any" data-p="${k}" value="${esc(v)}"/></label>`;
    }).join('');
    $('paramForm').innerHTML = PARAMS.map(([k, label]) => `<label>${label}<input type="number" step="any" data-p="p.${k}" value="${P.p[k]}"/></label>`).join('');
    renderFV();
    restoreEpsBox();
    const fvCols = [{ key: 'date', label: 'Effective date', type: 'date' }, { key: 'fv', label: 'Adjusted FV', type: 'number' }, { key: 'note', label: 'Note / source' }, { key: 'reunderwrite', label: 'Re-underwrite open episodes', type: 'checkbox' }];
    editableTable($('fvTable'), P.fvSchedule, fvCols, commitAndRender);
    editableTable($('s3Table'), P.s3Events, [
      { key: 'date', label: 'Report date', type: 'date' },
      { key: 'result', label: 'Result vs consensus', type: 'select', options: [['beat', 'Beat'], ['inline', 'In-line'], ['miss', 'Miss']] },
      { key: 'guidance', label: 'Guidance', type: 'select', options: [['maintained', 'Maintained'], ['raised', 'Raised'], ['cut', 'Cut']] },
      { key: 'context', label: 'Peer context', type: 'select', options: [['normal', 'Normal'], ['sector', '≥50% peers also miss/cut'], ['alone', 'Company alone (peers beat/raise)']] }
    ], commitAndRender);
    editableTable($('s4Table'), P.s4Events, [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'type', label: 'Event', type: 'select', options: [['peerDet', 'Peer-relative deterioration quarter'], ['clean', 'Clean report (reset count)'], ['thesis', 'Thesis KPI hit exit level'], ['distress', 'Company distress'], ['clear', 'Thesis re-underwritten (clear)']] },
      { key: 'note', label: 'Note' }
    ], commitAndRender);
  }
  function commitAndRender(structural) { commit(); if (structural) renderProfile(); }

  $('saveProfile').onclick = () => {
    const P = S.prof; if (!P) return;
    const before = JSON.stringify([P.benchmark, P.peers]);
    document.querySelectorAll('#profileForm [data-p], #paramForm [data-p]').forEach(inp => {
      const k = inp.dataset.p;
      let v = inp.type === 'checkbox' ? inp.checked : inp.dataset.list ? inp.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 5) : inp.type === 'number' ? (+inp.value || 0) : inp.value.trim();
      if (k === 'benchmark') v = v.toUpperCase();
      setPath(P, k, v);
    });
    saveProfile();
    if (JSON.stringify([P.benchmark, P.peers]) !== before) selectStock(S.sym); else { run(); status('Profile saved.', 'ok'); }
  };

  /* ---------- Fair value calculator ---------- */
  function renderFV() {
    const f = S.prof.fv, c = store.get('fvcalc:' + S.sym, { q: '', a: '', fcf: '', sh: '', date: S.D.date[S.D.date.length - 1] });
    $('fvForm').innerHTML = `
      <label>Last 4 quarterly GAAP diluted EPS (comma)<input id="fvQ" inputmode="decimal" value="${esc(c.q)}" placeholder="0.95, 1.10, 1.30, 1.50"/></label>
      <label>Last 5 annual EPS (comma)<input id="fvA" inputmode="decimal" value="${esc(c.a)}" placeholder="3.2, -0.5, 4.1, 2.0, 5.1"/></label>
      <label>P/E multiple<select id="fvM">${[8, 10, 12, 15, 18].map(m => `<option ${m === f.multiple ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label>Confidence<select id="fvC">${['high', 'medium', 'low', 'speculative'].map(x => `<option ${x === f.confidence ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>TTM haircut %<input id="fvH" type="number" value="${f.haircut}"/></label>
      <label>Current EPS weight %<input id="fvW" type="number" value="${f.wTTM}"/></label>
      <label>TTM free cash flow (optional)<input id="fvF" type="number" step="any" value="${esc(c.fcf)}"/></label>
      <label>Diluted shares (optional)<input id="fvS" type="number" step="any" value="${esc(c.sh)}"/></label>
      <label>FCF target yield %<input id="fvY" type="number" value="${f.fcfYield}"/></label>
      <label>Effective date (report/filing date)<input id="fvD" type="date" value="${esc(c.date)}"/></label>
      <label>&nbsp;<button class="btn primary" id="fvAdd">Add result to schedule</button></label>`;
    const calc = () => {
      const nums = s => s.split(',').map(x => parseFloat(x)).filter(x => isFinite(x));
      Object.assign(f, { multiple: +$('fvM').value, confidence: $('fvC').value, haircut: +$('fvH').value, wTTM: +$('fvW').value, fcfYield: +$('fvY').value });
      store.set('fvcalc:' + S.sym, { q: $('fvQ').value, a: $('fvA').value, fcf: $('fvF').value, sh: $('fvS').value, date: $('fvD').value });
      const r = EPF.fairValue({ q: nums($('fvQ').value), a: nums($('fvA').value), multiple: f.multiple, confidence: f.confidence, haircut: f.haircut, wTTM: f.wTTM, fcfTTM: +$('fvF').value, dilutedShares: +$('fvS').value, fcfYield: f.fcfYield });
      if (r.error) { $('fvOut').innerHTML = `<div class="flag">${r.error}</div>`; return null; }
      const box = (l, v) => `<div>${l}<b>${v}</b></div>`;
      $('fvOut').innerHTML = box('TTM EPS', fmt(r.ttm)) + box('Adjusted TTM', fmt(r.adjTTM)) + box('Cycle EPS', fmt(r.cycle)) + box('Sustainable EPS', fmt(r.sust)) +
        box('Bear / base / high', `${fmt(r.bear)} / ${fmt(r.base)} / ${fmt(r.high)}`) + box('Earnings FV', fmt(r.earningsFV)) + (r.fcfFV != null ? box('FCF FV', fmt(r.fcfFV)) + box('Composite 60/40', fmt(r.composite)) : '') +
        box(`Confidence ${r.confidence} (${r.factor * 100}%)`, '') + box('Adjusted FV', `<span style="color:#2dd4bf">${fmt(r.adjustedFV)}</span>`) +
        box('Today M1 / M2 / M3', [S.prof.p.m1, S.prof.p.m2, S.prof.p.m3].map(m => fmt(r.adjustedFV * m / 100)).join(' / ')) +
        r.flags.map(x => `<div class="flag">⚠ ${x}</div>`).join('');
      return r;
    };
    $('fvForm').querySelectorAll('input,select').forEach(x => x.oninput = calc);
    calc();
    $('fvAdd').onclick = () => {
      const r = calc(); if (!r) return;
      S.prof.fvSchedule.push({ date: $('fvD').value, fv: +r.adjustedFV.toFixed(2), note: `EPS model ${S.prof.fv.multiple}x, ${r.confidence}`, reunderwrite: false });
      S.prof.fvSchedule.sort((a, b) => (a.date < b.date ? -1 : 1));
      commitAndRender(true);
    };
  }

  $('autoEarn').onclick = async () => {
    try {
      const earn = await EPF.api.earnings(S.sym, S.prof.mic);
      if (earn.length < 4) throw new Error('Not enough reported quarters returned.');
      const makeS3 = confirm('Fair-value schedule will be rebuilt from reported EPS.\n\nAlso create System 3 events from EPS surprise? (Approximation: revenue ignored, guidance assumed "maintained".)');
      const { sched, s3 } = EPF.fvFromEarnings(earn, S.prof, makeS3);
      S.prof.fvSchedule = S.prof.fvSchedule.filter(x => !x.auto).concat(sched).sort((a, b) => (a.date < b.date ? -1 : 1));
      if (makeS3) S.prof.s3Events = S.prof.s3Events.filter(x => !x.auto).concat(s3);
      commitAndRender(true);
      status(`Built ${sched.length} point-in-time fair values from ${earn.length} reported quarters.`, 'ok');
    } catch (e) {
      status(`Auto-build unavailable (${e.message}). The /earnings endpoint needs a paid Twelve Data plan — use the calculator instead.`, 'warn');
    }
  };

  /* ---------- EPS table import ---------- */
  function restoreEpsBox() {
    if (!$('epsText') || !S.sym) return;
    $('epsText').value = store.get('epstable:' + S.sym, '');
    $('epsLag').value = store.get('epslag:' + S.sym, 0);
    $('epsMsg').textContent = '';
  }
  if ($('epsText')) {
    $('epsText').addEventListener('input', () => S.sym && store.set('epstable:' + S.sym, $('epsText').value));
    $('epsLag').addEventListener('input', () => S.sym && store.set('epslag:' + S.sym, +$('epsLag').value || 0));
    $('epsBuild').onclick = () => {
      const msg = $('epsMsg');
      msg.className = 'eps-msg';
      if (!S.prof || !S.D) { msg.textContent = 'Load a stock first.'; msg.classList.add('err'); return; }
      const { rows, errors } = EPF.parseEpsTable($('epsText').value);
      if (rows.length < 4) {
        msg.textContent = `Need at least 4 quarters (found ${rows.length}).` + (errors.length ? ' ' + errors[0] : '');
        msg.classList.add('err'); return;
      }
      const lag = Math.max(0, Math.round(+$('epsLag').value || 0));
      const makeS3 = $('epsS3').checked && rows.some(r => r.estimate != null);
      const { sched, s3 } = EPF.scheduleFromEps(rows, lag, S.prof, makeS3);
      S.prof.fvSchedule = S.prof.fvSchedule.filter(x => !x.auto).concat(sched).sort((x, y) => (x.date < y.date ? -1 : 1));
      if (makeS3) S.prof.s3Events = S.prof.s3Events.filter(x => !x.auto).concat(s3);
      commitAndRender(true);   // re-runs the model and redraws the Profile tab
      const m2 = $('epsMsg');
      m2.className = 'eps-msg ok';
      m2.textContent = `Imported ${rows.length} quarters → ${sched.length} fair values (${sched[0].date} to ${sched[sched.length - 1].date})` +
        (makeS3 ? `, ${s3.length} System 3 events` : '') + (errors.length ? `. ${errors.length} line(s) skipped: ${errors[0]}` : '.');
    };
  }
  
  /* ---------- My actions ---------- */
  function renderUserTable() {
    editableTable($('userTable'), S.prof.userTrades, [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'side', label: 'Type', type: 'select', options: [['buy', 'Buy'], ['sell', 'Sell'], ['rsu', 'RSU / shares received'], ['divcash', 'Cash dividend'], ['divreinv', 'Dividend reinvested']] },
      { key: 'shares', label: 'Shares', type: 'number' },
      { key: 'price', label: 'Price (blank = close)', type: 'number' },
      { key: 'amount', label: 'Cash amount', type: 'number' },
      { key: 'note', label: 'Note' }
    ], structural => { commit(); if (structural) renderUserTable(); });
  }
  
  /* ---------- Log ---------- */
  function renderLog() {
    const { sim } = S;
    $('tradeTable').innerHTML = `<div class="table-wrap"><table><tr><th></th><th>Signal date</th><th>Executed</th><th>System</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th><th>Reason</th><th></th></tr>` +
      sim.trades.slice().reverse().map((t, k) => `<tr><td>${dotHtml(t.side === 'sell' ? 'sell' : 'buy', 'sm')}</td><td>${t.sigDate}</td><td>${t.date}</td><td>${t.sys}</td><td class="num">${fmt(t.qty, 2)}</td><td class="num">${fmt(t.price)}</td><td class="num">${fmt(t.qty * t.price, 0)}</td><td>${esc(t.reason)}</td><td><button class="btn sm" data-copy="${sim.trades.length - 1 - k}" title="Copy into My Actions">→ Mine</button></td></tr>`).join('') +
      `</table></div>${sim.trades.length ? '' : '<p class="muted">No framework trades in this period.</p>'}`;
    $('tradeTable').querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
      const t = sim.trades[+b.dataset.copy];
      S.prof.userTrades.push({ date: t.date, side: t.side, shares: +t.qty.toFixed(4), price: +t.price.toFixed(4), note: 'copied from ' + t.sys });
      commit(); status('Copied to My Actions.', 'ok');
    });
    const lv = [S.prof.p.m1, S.prof.p.m2, S.prof.p.m3];
    $('episodeTable').innerHTML = `<div class="table-wrap"><table><tr><th>#</th><th>Opened</th><th class="num">Shares sold</th><th class="num">Avg sell</th><th class="num">Frozen FV</th><th>M1 / M2 / M3 (threshold)</th><th class="num">Bought back</th></tr>` +
      sim.episodes.slice().reverse().map(ep => {
        const wsp = ep.proceeds / ep.sold;
        const pills = ep.locks.map((l, k) => { const thr = ep.fv ? Math.min(ep.fv, wsp) * lv[k] / 100 : null; return `${dotHtml(!ep.fv ? 'off' : l ? 'exhausted' : 'armed', 'sm', l ? 'Used / locked' : 'Waiting')} ${thr ? fmt(thr) : '–'}`; }).join(' &nbsp; ');
        return `<tr><td>${ep.id}</td><td>${ep.openDate}</td><td class="num">${fmt(ep.sold, 2)}</td><td class="num">${fmt(wsp)}</td><td class="num">${ep.fv ? fmt(ep.fv) : '–'}</td><td>${pills}</td><td class="num">${fmt(ep.bought, 2)}</td></tr>`;
      }).join('') + '</table></div>';
    $('eventLog').innerHTML = `<div class="table-wrap"><table><tr><th></th><th>Date</th><th>System</th><th>Event</th></tr>` +
      sim.log.slice().reverse().map(l => `<tr><td>${dotHtml(l.code, 'sm')}</td><td>${l.date}</td><td>${l.sys}</td><td>${esc(l.msg)}</td></tr>`).join('') + '</table></div>';
  }

  /* ---------- Guide ---------- */
  function renderGuide() {
    renderLegend('legend2');
    $('guideText').innerHTML = `
      <h3>How this site implements Rev. 5</h3>
      <p><b>Core asymmetry:</b> technical and relative evidence may reduce risk; only fundamental value may justify buying back. New highs, MA crosses or RSI recovery never trigger a buy.</p>
      <h4>Execution</h4><ul><li>Signals use closing data; orders fill at the next session's open (fee applied).</li><li>Max one sale per day. Priority: S4 &gt; S3 &gt; 2E catastrophic &gt; 2E first &gt; S2 &gt; S0. Lower-priority intents are re-evaluated next session, never executed stale.</li></ul>
      <h4>System 1 — noise filter (diagnostic only)</h4><ul><li>RS ratio = stock ÷ equal-weight peer basket (benchmark if no peers). Relative lag = RS fell ≥ 10% over 60 sessions.</li><li>5 consecutive lag closes = watch, 10 = confirmed candidate. Peer breadth = share of peers above their SMA50. Market regime = benchmark vs SMA200 and 10%/20% drawdown.</li></ul>
      <h4>System 2 — ordinary reserve (15% S0)</h4><ul><li>Initial 10% S0: confirmed lag plus ≥ 2 of 4 votes (trend break, weekly MACD &lt; signal, volatility-adjusted drawdown, beta-residual).</li><li>Extension 5% S0 after 10 more sessions if RS keeps worsening. 5-session cooldown.</li></ul>
      <h4>System 2E — extreme reversal reserve (20% S0)</h4><ul><li>Arm only when all 4 conditions hold; track the closing peak. Disarm after 20 sessions without a new high (before any sale).</li><li>Candidate at 12.5% below peak; first 10% sale needs 2 of 3 confirmations within 3 sessions unless the trend veto applies.</li><li>Catastrophic 10%: ≥ 20% below peak within 10 sessions plus 2 closes below SMA20 or an 8% down day on 1.5× volume.</li><li>Combined technical sales can never take holdings below 65% of S0.</li></ul>
      <h4>System 3 / 4 — fundamentals (your inputs)</h4><ul><li>Enter earnings outcomes in the Profile tab; the Rev. 5 matrix and peer adjustments set the sale size. Floor 25% S0.</li><li>System 4 events trigger full exit, or 50% then the rest for two peer-relative deterioration quarters. Any active System 4 condition blocks System 5 buys.</li></ul>
      <h4>System 5 — Mr Market buys</h4><ul><li>Each sell episode freezes the latest fair value on or before it opens. M1/M2/M3 buy 25%/25%/remaining 50% of the episode's sold shares when price ≤ 80/70/60% of <i>both</i> frozen FV and the episode's average sell price. Each level is locked once used.</li><li>No fair value on file = no buys (cash stays cash).</li></ul>
      <h4>Data</h4><ul><li>Daily OHLCV from Twelve Data (up to 5,000 sessions per symbol), cached for 12 hours in your browser. The free plan allows 8 calls/minute; the site queues requests automatically.</li><li>Fundamentals are manual unless your plan includes the /earnings endpoint.</li></ul>
      <p class="muted">For analysis and discussion only — not financial advice. Thresholds are starting points that need out-of-sample testing.</p>`;
  }

  /* ---------- Settings ---------- */
  function refreshApiDot() {
    const k = store.get('apikey', '');
    $('apiDot').outerHTML = `<span id="apiDot">${dotHtml(k ? 'ok' : 'sell', 'sm', k ? 'API key saved' : 'No API key — open Settings')}</span>`;
  }
  $('settingsBtn').onclick = () => { $('apiKey').value = store.get('apikey', ''); $('ratePerMin').value = store.get('ratePerMin', 8); $('settings').classList.remove('hidden'); };
  $('closeSettings').onclick = () => $('settings').classList.add('hidden');
  $('saveSettings').onclick = () => { store.set('apikey', $('apiKey').value.trim()); store.set('ratePerMin', +$('ratePerMin').value || 8); refreshApiDot(); $('settings').classList.add('hidden'); status('Settings saved.', 'ok'); };
  $('clearCache').onclick = () => { store.clearCache(); status('Cached prices cleared.', 'ok'); };
  $('exportBtn').onclick = () => {
    const wl = watchlist(), profiles = {};
    wl.forEach(w => (profiles[w.symbol] = store.get('profile:' + w.symbol, null)));
    $('backupText').value = JSON.stringify({ watchlist: wl, profiles }, null, 1);
    $('backupText').select();
  };
  $('importBtn').onclick = () => {
    try {
      const j = JSON.parse($('backupText').value);
      store.set('watchlist', j.watchlist || []);
      Object.entries(j.profiles || {}).forEach(([k, v]) => v && store.set('profile:' + k, v));
      renderWatchlist(); status('Profiles imported.', 'ok');
    } catch (e) { status('Import failed: ' + e.message, 'err'); }
  };

  /* ---------- Wiring ---------- */
  /* Signal detail popup controls */
  if ($('signalDetailClose')) {
    $('signalDetailClose').onclick = closeSignalDetail;
  }

  if ($('signalDetail')) {
    $('signalDetail').addEventListener('click', e => {
      /*
       * Close only when the dark backdrop itself is tapped.
       * Tapping inside the information sheet must not close it.
       */
      if (e.target === $('signalDetail')) {
        closeSignalDetail();
      }
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeSignalDetail();
    }
  });
  $('searchBtn').onclick = doSearch;
  $('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); if (e.key === 'Escape') $('searchResults').classList.add('hidden'); });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) $('searchResults').classList.add('hidden'); });
  $('refreshBtn').onclick = () => S.sym && selectStock(S.sym, true);
  $('tlRange').onchange = () => S.sim && EPF.charts.timeline($('timeline'), $('tlTip'), S.D, S.sim, COLORS, +$('tlRange').value);

  // Redraw on resize / phone rotation. Only react to width changes: iOS Safari fires
  // resize when its address bar shows/hides, which would otherwise cause constant redraws.
  let rz, lastW = window.innerWidth;
  const onResize = () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(rz);
    rz = setTimeout(() => S.sim && renderAll(), 250);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 300));

  refreshApiDot();
  renderGuide();
  renderWatchlist();
  showEmpty(true);
  const last = store.get('active', null);
  if (last && watchlist().some(w => w.symbol === last)) selectStock(last);
})();

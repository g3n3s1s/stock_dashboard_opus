/* Chart.js wrappers + canvas signal timeline (desktop + mobile) */
(function () {
  const EPF = (window.EPF = window.EPF || {});
  const charts = {};
  const GRID = '#1f2a40', TICK = '#8b97ad';
  const isNarrow = () => window.innerWidth < 600;

  function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

  function baseOptions(yFmt) {
    const narrow = isNarrow();
    return {
      responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: narrow ? 8 : 12, font: { size: narrow ? 10 : 12 } } } },
      scales: {
        x: { ticks: { color: TICK, maxTicksLimit: narrow ? 4 : 10, autoSkip: true, maxRotation: 0, font: { size: narrow ? 10 : 12 } }, grid: { color: GRID } },
        y: { ticks: { color: TICK, callback: yFmt, font: { size: narrow ? 10 : 12 } }, grid: { color: GRID } }
      },
      elements: { point: { radius: 0 }, line: { borderWidth: 1.6 } }
    };
  }
  const money = v => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : (+v).toFixed(2));

  EPF.charts = {
    price(canvas, D, I, sim, user) {
      destroy('price');
      const s = sim.start, labels = D.date.slice(s);
      const blank = () => labels.map(() => null);
      const sells = blank(), buys = blank(), mine = blank(), info = {};
      sim.trades.forEach(t => {
        const k = t.idx - s; (t.side === 'sell' ? sells : buys)[k] = t.price;
        (info[k] = info[k] || []).push(`${t.side === 'sell' ? '▼' : '▲'} ${t.sys}: ${t.qty.toFixed(2)} sh @ ${t.price.toFixed(2)}`);
      });
      (user.applied || []).forEach(t => { const k = t.idx - s; mine[k] = t.price; (info[k] = info[k] || []).push(`◆ Mine: ${t.side} ${t.qty} @ ${t.price.toFixed(2)}`); });
      const narrow = isNarrow();
      const mk = (label, data, color, extra) => Object.assign({ label, data, borderColor: color, backgroundColor: color, spanGaps: true }, extra || {});
      const marker = (label, data, color, style, rot) => ({ label, data, type: 'line', showLine: false, borderColor: color, backgroundColor: color, pointStyle: style, pointRotation: rot || 0, pointRadius: narrow ? 5 : 7, pointHoverRadius: narrow ? 7 : 9 });
      const opt = baseOptions(v => money(v));
      opt.plugins.tooltip = { callbacks: { afterBody: items => info[items[0].dataIndex] || [] } };
      charts.price = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            mk('Close', D.close.slice(s), '#e2e8f0'),
            mk('SMA20', I.sma20.slice(s), '#facc15', { borderWidth: 1, borderDash: [3, 3] }),
            mk('SMA50', I.sma50.slice(s), '#60a5fa', { borderWidth: 1.2 }),
            mk('SMA200', I.sma200.slice(s), '#c084fc', { borderWidth: 1.2 }),
            marker('Framework sell', sells, '#ef4444', 'triangle', 180),
            marker('Framework buy', buys, '#2dd4bf', 'triangle', 0),
            marker('My action', mine, '#f472b6', 'rectRot', 0)
          ]
        },
        options: opt
      });
    },

    netWorth(canvas, ddCanvas, D, start, series) {
      destroy('nw'); destroy('dd');
      const labels = D.date.slice(start);
      const ds = series.map(x => ({ label: x.label, data: x.data.slice(start), borderColor: x.color, backgroundColor: x.color, borderWidth: x.width || 1.8 }));
      charts.nw = new Chart(canvas, { type: 'line', data: { labels, datasets: ds }, options: baseOptions(v => money(v)) });
      const dd = series.map(x => ({ label: x.label, data: EPF.ind.maxDrawdown(x.data.slice(start)).dd.map(v => (v == null ? null : v * 100)), borderColor: x.color, backgroundColor: x.color + '22', fill: true, borderWidth: 1.2 }));
      charts.dd = new Chart(ddCanvas, { type: 'line', data: { labels, datasets: dd }, options: baseOptions(v => v.toFixed(0) + '%') });
    },

    /* Heat-strip: one row per system, one cell per session */
    timeline(canvas, tip, D, sim, colors, range) {
      const W = canvas.clientWidth || 900, narrow = W < 600;
      const rows = narrow
        ? [['S0', 's0'], ['S1', 's1'], ['S2', 's2'], ['S2E', 'e2'], ['S3', 's3'], ['S4', 's4'], ['S5', 's5']]
        : [['S0 Concentration', 's0'], ['S1 Noise filter', 's1'], ['S2 Ordinary', 's2'], ['S2E Extreme', 'e2'], ['S3 Fundamentals', 's3'], ['S4 Full exit', 's4'], ['S5 Buy engine', 's5']];
      const total = sim.tlIdx.length, from = range > 0 ? Math.max(0, total - range) : 0;
      const idx = sim.tlIdx.slice(from);
      const dpr = window.devicePixelRatio || 1;
      const rowH = narrow ? 20 : 24, padL = narrow ? 40 : 120, padT = 6, tradeH = 18;
      const H = padT + rows.length * rowH + tradeH + 22;
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + 'px';
      const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const cw = (W - padL - 6) / Math.max(1, idx.length);
      ctx.font = (narrow ? '11px' : '12px') + ' Segoe UI, sans-serif'; ctx.textBaseline = 'middle';
      rows.forEach(([name, key], r) => {
        const y = padT + r * rowH;
        ctx.fillStyle = '#cbd5e1'; ctx.fillText(name, 4, y + rowH / 2);
        sim.tl[key].slice(from).forEach((code, k) => {
          const col = colors[code] || colors.off, x = padL + k * cw;
          ctx.fillStyle = code === 'off' ? '#1a2337' : col.c;
          ctx.fillRect(x, y + 3, Math.max(1, cw + 0.3), rowH - 6);
        });
      });
      // trade markers row
      const ty = padT + rows.length * rowH;
      ctx.fillStyle = '#cbd5e1'; ctx.fillText(narrow ? 'Trd' : 'Trades', 4, ty + tradeH / 2);
      const pos = new Map(idx.map((v, k) => [v, k]));
      sim.trades.forEach(t => {
        if (!pos.has(t.idx)) return;
        const x = padL + pos.get(t.idx) * cw + cw / 2;
        ctx.fillStyle = t.side === 'sell' ? colors.sell.c : colors.buy.c;
        ctx.beginPath();
        if (t.side === 'sell') { ctx.moveTo(x - 5, ty + 3); ctx.lineTo(x + 5, ty + 3); ctx.lineTo(x, ty + tradeH - 3); }
        else { ctx.moveTo(x - 5, ty + tradeH - 3); ctx.lineTo(x + 5, ty + tradeH - 3); ctx.lineTo(x, ty + 3); }
        ctx.fill();
      });
      // date axis
      ctx.fillStyle = TICK; ctx.font = '11px Segoe UI, sans-serif';
      const ticks = narrow ? 2 : 6;
      for (let t = 0; t <= ticks; t++) {
        const k = Math.min(idx.length - 1, Math.round((t / ticks) * (idx.length - 1)));
        if (k < 0) break;
        const x = padL + k * cw;
        ctx.fillText(D.date[idx[k]], Math.min(W - 66, Math.max(padL, x - 30)), H - 9);
      }
      // hover / touch tooltip
      const show = clientX => {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left, k = Math.floor((x - padL) / cw);
        if (k < 0 || k >= idx.length) { tip.classList.add('hidden'); return; }
        const gi = from + k, di = idx[k];
        const tr = sim.trades.filter(t => t.idx === di).map(t => `<div>${t.side === 'sell' ? '▼' : '▲'} ${t.sys} ${t.qty.toFixed(2)} sh @ ${t.price.toFixed(2)}</div>`).join('');
        tip.innerHTML = `<b>${D.date[di]}</b> · close ${D.close[di].toFixed(2)}` +
          rows.map(([name, key]) => `<div>${EPF.ui.dotHtml(sim.tl[key][gi], 'xs')} ${name}</div>`).join('') + tr;
        tip.classList.remove('hidden');
        const tw = tip.offsetWidth || 200;
        tip.style.left = Math.max(0, Math.min(x + 12, rect.width - tw - 4)) + 'px';
        tip.style.top = '4px';
      };
      canvas.onmousemove = e => show(e.clientX);
      canvas.onmouseleave = () => tip.classList.add('hidden');
      canvas.ontouchstart = canvas.ontouchmove = e => { if (e.touches[0]) show(e.touches[0].clientX); };
      canvas.ontouchend = () => setTimeout(() => tip.classList.add('hidden'), 1800);
    }
  };
})();

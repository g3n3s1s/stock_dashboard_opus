/* Mobile helper: labels every table cell with its column header so CSS can
   turn table rows into stacked cards on small screens. Works automatically
   for all tables, including ones re-drawn after edits. */
(function () {
  function label(table) {
    const head = table.querySelector('tr');
    if (!head || !head.querySelector('th')) return;
    const names = Array.from(head.children).map(c => c.textContent.trim());
    table.classList.add('stack');
    Array.from(table.querySelectorAll('tr')).forEach((tr, i) => {
      if (i === 0) return;
      Array.from(tr.children).forEach((td, j) => {
        if (td.dataset.label === undefined) td.dataset.label = names[j] || '';
      });
    });
  }
  let queued = false;
  function run() { queued = false; document.querySelectorAll('main table').forEach(label); }
  const main = document.querySelector('main');
  if (main) new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(main, { childList: true, subtree: true });
  run();
})();

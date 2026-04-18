export function tierOk(current, needed) {
  const rank = { Free: 0, L1: 1, L2: 2 };
  return (rank[current] ?? 0) >= (rank[needed] ?? 0);
}

export function fmt(n, decimals = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function fmtCurrency(n) {
  return '$' + fmt(n);
}

export function fmtPct(n, dec = 2) {
  return n.toFixed(dec) + '%';
}

export function confidenceColor(level) {
  return { high: 'text-leaf', medium: 'text-amber', low: 'text-rose' }[level] ?? 'text-ink-400';
}

export function confidenceDot(level) {
  return { high: 'bg-leaf', medium: 'bg-amber', low: 'bg-rose' }[level] ?? 'bg-ink/20';
}

export function generateId() {
  return 'stmt-' + Math.random().toString(36).slice(2, 9);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function triggerPrint() {
  window.print();
}

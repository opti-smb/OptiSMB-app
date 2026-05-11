'use client';

export function DonutChart({ data, size = 220, thickness = 26, center }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - thickness / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(15,27,45,0.08)" strokeWidth={thickness} />
      {data.map((d, i) => {
        const len = (d.value / total) * C;
        const el = (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={d.color} strokeWidth={thickness}
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="butt" />
        );
        offset += len;
        return el;
      })}
      {center && (
        <g>
          <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fontSize="28" fill="#0F1B2D" fontFamily="'Bowlby One SC', serif">{center.value}</text>
          <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize="10" fill="#5C6777" letterSpacing="2">{center.label}</text>
        </g>
      )}
    </svg>
  );
}

export function HBar({ data, max }) {
  const m = max || Math.max(...data.map(d => d.value));
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`}>
          <div className="flex items-baseline justify-between text-[12px] mb-1">
            <span className="text-ink-500">{d.label}</span>
            <span className="tabular font-mono text-ink">{d.display || d.value}</span>
          </div>
          <div className="h-2 bg-ink/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(d.value / m) * 100}%`, background: d.color || '#0F1B2D' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ points, width = 120, height = 36, color = '#00A88A' }) {
  const max = Math.max(...points), min = Math.min(...points);
  const norm = points.map((p, i) => [
    (i / (points.length - 1)) * width,
    height - ((p - min) / (max - min || 1)) * (height - 4) - 2
  ]);
  const d = norm.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = d + ` L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={area} fill={color} opacity="0.12" />
      <path d={d} stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

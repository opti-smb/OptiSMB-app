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
        <div key={i}>
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

export function LineChart({ series, width = 640, height = 220, xLabels = [] }) {
  const pad = { l: 36, r: 12, t: 12, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const all = series.flatMap(s => s.data);
  const max = Math.max(...all) * 1.1;
  const min = 0;
  const xStep = w / (series[0].data.length - 1);
  const yTicks = [0, 0.5, 1].map(t => min + t * (max - min));
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={pad.t + h - (v / max) * h} y2={pad.t + h - (v / max) * h} stroke="rgba(15,27,45,0.08)" />
          <text x={pad.l - 6} y={pad.t + h - (v / max) * h + 3} fontSize="10" textAnchor="end" fill="#8B94A3" fontFamily="'JetBrains Mono', monospace">{v.toFixed(2)}</text>
        </g>
      ))}
      {xLabels.map((l, i) => (
        <text key={i} x={pad.l + i * xStep} y={height - 6} fontSize="10" textAnchor="middle" fill="#8B94A3">{l}</text>
      ))}
      {series.map((s, si) => {
        const d = s.data.map((v, i) => {
          const x = pad.l + i * xStep;
          const y = pad.t + h - (v / max) * h;
          return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        }).join(' ');
        return (
          <g key={si}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.4 : 2} strokeDasharray={s.dashed ? '4 4' : ''} />
            {s.data.map((v, i) => (
              <circle key={i} cx={pad.l + i * xStep} cy={pad.t + h - (v / max) * h} r="2.5" fill={s.color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

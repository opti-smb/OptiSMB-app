const I = (d) => ({ size = 16, className = '', style, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    className={className} style={style} {...p}>
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);

export const ArrowRight = I('M5 12h14M13 5l7 7-7 7');
export const ArrowUpRight = I('M7 17L17 7M8 7h9v9');
export const Check = I('M4 12l5 5L20 6');
export const X = I('M6 6l12 12M18 6L6 18');
export const ChevronDown = I('M6 9l6 6 6-6');
export const ChevronRight = I('M9 6l6 6-6 6');
export const Upload = I(<g><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /><path d="M12 3v13M7 8l5-5 5 5" /></g>);
export const FileText = I(<g><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></g>);
export const LayoutDashboard = I(<g><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></g>);
export const Search = I(<g><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></g>);
export const Bell = I(<g><path d="M6 8a6 6 0 0112 0c0 7 3 7 3 9H3c0-2 3-2 3-9z" /><path d="M10 21a2 2 0 004 0" /></g>);
export const Settings = I(<g><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></g>);
export const BarChart = I(<g><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="7" /><rect x="12" y="7" width="3" height="11" /><rect x="17" y="14" width="3" height="4" /></g>);
export const Sparkles = I('M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3zM19 15l.8 2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-1L19 15z');
export const Shield = I('M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z');
export const Lock = I(<g><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 118 0v4" /></g>);
export const Zap = I('M13 2L4 14h7l-1 8 9-12h-7l1-8z');
export const HelpCircle = I(<g><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></g>);
export const Info = I(<g><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".6" fill="currentColor" /></g>);
export const AlertTriangle = I('M12 3l10 18H2L12 3zM12 10v5M12 18h0');
export const CircleCheck = I(<g><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></g>);
export const Download = I(<g><path d="M12 3v13M7 12l5 5 5-5" /><path d="M4 21h16" /></g>);
export const Plus = I('M12 5v14M5 12h14');
export const Minus = I('M5 12h14');
export const MoreHorizontal = I('M5 12h.01M12 12h.01M19 12h.01');
export const Filter = I('M4 5h16l-6 8v6l-4-2v-4L4 5z');
export const History = I(<g><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></g>);
export const Bolt = I('M11 2L4 14h6l-1 8 10-13h-7l1-7z');
export const CircleDollar = I(<g><circle cx="12" cy="12" r="9" /><path d="M15 9.5A2.5 2.5 0 0012.5 7h-1A2.5 2.5 0 009 9.5c0 3 6 2 6 5a2.5 2.5 0 01-2.5 2.5h-1A2.5 2.5 0 019 14.5M12 5v2M12 17v2" /></g>);
export const Receipt = I(<g><path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-2z" /><path d="M8 8h8M8 12h8M8 16h5" /></g>);
export const User = I(<g><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></g>);
export const CreditCard = I(<g><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></g>);
export const Trash = I(<g><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></g>);
export const Edit = I(<g><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></g>);
export const RefreshCw = I(<g><path d="M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6M21 12a9 9 0 01-15 6.7L3 16" /></g>);
export const Globe = I(<g><circle cx="12" cy="12" r="9" /><path d="M12 3a15.3 15.3 0 010 18M3 12h18" /></g>);
export const TrendingDown = I('M22 17l-8.5-8.5-5 5L2 7');
export const TrendingUp = I('M22 7l-8.5 8.5-5-5L2 17');
export const Send = I('M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z');
export const ChevronUp = I('M18 15l-6-6-6 6');

export const Google = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.2s2.7-6.2 6-6.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.2 12 2.2 6.5 2.2 2 6.6 2 12s4.5 9.8 10 9.8c5.8 0 9.6-4 9.6-9.8 0-.7-.1-1.1-.2-1.8H12z" />
  </svg>
);

export const Microsoft = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
    <rect x="2" y="2" width="9" height="9" fill="#F25022" />
    <rect x="13" y="2" width="9" height="9" fill="#7FBA00" />
    <rect x="2" y="13" width="9" height="9" fill="#00A4EF" />
    <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
  </svg>
);

export const Logo = ({ size = 28, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none">
    <rect x="2" y="2" width="28" height="28" rx="8" fill="#0F1B2D" />
    <path d="M8 21h16M8 16h10M8 11h6" stroke="#00C9A7" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="22" cy="11" r="1.6" fill="#F8F5F0" />
  </svg>
);

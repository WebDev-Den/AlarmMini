/** Decorative silhouettes; the printed model name remains the identification guide. */
export function BoardIllustration({ compact = false }: { compact?: boolean }) {
  return (
    <svg className={`board-illustration ${compact ? "compact" : ""}`} viewBox="0 0 112 140" width="72" height="90" fill="none" aria-hidden="true">
      <rect x="21" y="10" width="70" height="120" rx="7" fill={compact ? "#204957" : "#252d3e"} stroke="#60808a" />
      {Array.from({ length: 8 }, (_, index) => <g key={index}>
        <rect x="16" y={23 + index * 12} width="12" height="5" rx="1" fill="#a5b5b0" />
        <rect x="84" y={23 + index * 12} width="12" height="5" rx="1" fill="#a5b5b0" />
        <circle cx="25" cy={25.5 + index * 12} r="1.5" fill="#21332e" />
        <circle cx="87" cy={25.5 + index * 12} r="1.5" fill="#21332e" />
      </g>)}
      <path d="M39 31V20H46V29H53V20H60V29H67V20H74V37" stroke="#c4b48a" strokeWidth="2.5" />
      <rect x="34" y="42" width="44" height="43" rx="3" fill={compact ? "#afbabc" : "#17232c"} stroke="#6f8489" />
      <path d="M42 52H68M42 58H62M42 64H66" stroke={compact ? "#65797e" : "#526a75"} strokeWidth="2" />
      <rect x="34" y="94" width="12" height="13" rx="2" fill="#131b23" stroke="#769298" />
      <rect x="66" y="94" width="12" height="13" rx="2" fill="#131b23" stroke="#769298" />
      <circle cx="56" cy="98" r="2.5" fill="#75e0b8" />
      <rect x="41" y="117" width="30" height="15" rx={compact ? 3 : 6} fill="#b8c4c9" />
      <rect x="46" y="122" width="20" height="5" rx="2" fill="#283640" />
    </svg>
  );
}

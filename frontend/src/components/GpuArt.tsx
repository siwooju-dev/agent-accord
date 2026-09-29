/** Front view of a triple-fan graphics card, drawn with theme tokens. */
export function GpuArt({ id, fans = 3, label }: { id: string; fans?: number; label: string }) {
  const positions = fans === 2 ? [96, 204] : [74, 150, 226];
  return (
    <svg className="gpu-art" viewBox="0 0 300 130" role="img" aria-label={`${label} 그래픽카드 일러스트`}>
      <defs>
        <linearGradient id={`ga-body-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="ga-body-top" />
          <stop offset="1" className="ga-body-bottom" />
        </linearGradient>
        <radialGradient id={`ga-fan-${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.25" className="ga-fan-in" />
          <stop offset="1" className="ga-fan-out" />
        </radialGradient>
      </defs>
      <rect x="12" y="22" width="276" height="88" rx="14" fill={`url(#ga-body-${id})`} className="ga-body" />
      <rect x="8" y="16" width="8" height="100" rx="2" className="ga-bracket" />
      <rect x="40" y="28" width="150" height="2.5" rx="1.25" className="ga-accent" />
      {positions.map((cx) => (
        <g key={cx} className="ga-fan">
          <circle cx={cx} cy="66" r="34" className="ga-fan-ring" />
          <circle cx={cx} cy="66" r="31" fill={`url(#ga-fan-${id})`} />
          {Array.from({ length: 9 }, (_, k) => (
            <path
              key={k}
              d={`M${cx} 66 q 10 -8 26 -8 q -8 8 -22 12 z`}
              transform={`rotate(${k * 40} ${cx} 66)`}
              className="ga-blade"
            />
          ))}
          <circle cx={cx} cy="66" r="8" className="ga-hub" />
          <circle cx={cx} cy="66" r="3.2" className="ga-hub-dot" />
        </g>
      ))}
      <g className="ga-fingers">
        {Array.from({ length: 22 }, (_, k) => (
          <rect key={k} x={52 + k * 5} y="110" width="3" height="7" rx="0.6" />
        ))}
      </g>
    </svg>
  );
}

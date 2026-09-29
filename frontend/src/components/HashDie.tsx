/** 256 bits of the snapshot hash drawn as a 16×16 grid. Any field change → a different pattern. */
export function hashBits(hash: string): boolean[] {
  const hex = hash.replace(/^0x/i, "").replace(/[^0-9a-f]/gi, "").padEnd(64, "0").slice(0, 64);
  const bits: boolean[] = [];
  for (const char of hex) {
    const value = parseInt(char, 16);
    for (let b = 3; b >= 0; b -= 1) bits.push(((value >> b) & 1) === 1);
  }
  return bits;
}

export function HashDie({ hash, size = 96 }: { hash: string; size?: number }) {
  const bits = hashBits(hash);
  return (
    <svg className="hash-die" viewBox="-1 -1 18 18" width={size} height={size} role="img" aria-label="스냅샷 해시 지문">
      <rect x="-1" y="-1" width="18" height="18" rx="2.2" className="hash-die-plate" />
      {bits.map((bit, index) =>
        bit ? (
          <rect
            key={`${hash}-${index}`}
            x={(index % 16) + 0.1}
            y={Math.floor(index / 16) + 0.1}
            width="0.8"
            height="0.8"
            rx="0.18"
            className="hash-die-bit"
            style={{ animationDelay: `${(index % 16) * 16 + Math.floor(index / 16) * 8}ms` }}
          />
        ) : null,
      )}
    </svg>
  );
}

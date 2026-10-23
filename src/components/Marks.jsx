// @ts-nocheck
export function SailMark({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M12 50V16h2.2L36 50H12Z" fill="currentColor" />
      <path d="M40 22.5 54 50H42.2" stroke="currentColor" strokeWidth="2.2" />
      <path d="M8 54h48" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function TokenMark({ symbol }) {
  const letter = symbol === 'USDT' ? 'U' : symbol === 'NOT' ? 'N' : symbol === 'TON' ? 'T' : (symbol || '?').slice(0, 1);
  return <span className={`token-glyph is-${symbol || 'token'}`}>{letter}</span>;
}

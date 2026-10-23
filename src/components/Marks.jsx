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
  return (
    <svg className="token-glyph" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {symbol === 'TON' && (
        <path d="M16 5.5 26.5 12.2 16 26.5 5.5 12.2 16 5.5Z" stroke="currentColor" strokeWidth="1.6" />
      )}
      {symbol === 'USDT' && (
        <>
          <circle cx="16" cy="16" r="9.2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11.2 12.8h9.6M16 12.8v7.6M12.4 20.4h7.2" stroke="currentColor" strokeWidth="1.6" />
        </>
      )}
      {symbol === 'NOT' && (
        <path d="M10 8.5h7.2a5.2 5.2 0 0 1 0 10.4H10V8.5Zm0 5.2h6.4" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  );
}

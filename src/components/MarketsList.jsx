import { useEffect, useState } from 'react';

const INITIAL = [
  { symbol: 'TON', name: 'Toncoin', price: 5.42, change: 1.24 },
  { symbol: 'NOT', name: 'Notcoin', price: 0.0082, change: -2.15 },
  { symbol: 'USDT', name: 'Tether', price: 1.0, change: 0.01 },
  { symbol: 'STON', name: 'STON.fi', price: 0.312, change: 4.8 },
  { symbol: 'DOGS', name: 'Dogs', price: 0.0011, change: -1.4 }
];

export default function MarketsList({ onSelect, activeSymbol }) {
  const [markets, setMarkets] = useState(INITIAL);

  useEffect(() => {
    const id = setInterval(() => {
      setMarkets((prev) =>
        prev.map((m) => {
          const delta = (Math.random() - 0.5) * 0.004;
          const nextPrice = Math.max(0.0001, m.price * (1 + delta));
          const nextChange = m.change + (Math.random() - 0.5) * 0.15;
          return {
            ...m,
            price: nextPrice,
            change: Number(nextChange.toFixed(2))
          };
        })
      );
    }, 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="markets-list">
      <div className="markets-header">
        <span>Рынки</span>
        <span className="muted">демо</span>
      </div>
      {markets.map((m) => {
        const isUp = m.change >= 0;
        const isActive = activeSymbol === m.symbol;
        return (
          <button
            type="button"
            key={m.symbol}
            className={`market-row${isActive ? ' active' : ''}`}
            onClick={() => onSelect?.(m.symbol)}
          >
            <div className="market-left">
              <div className="market-symbol">{m.symbol}<span>/USDT</span></div>
              <div className="market-name">{m.name}</div>
            </div>
            <div className="market-right">
              <div className="market-price">
                {m.price < 0.01 ? m.price.toFixed(6) : m.price.toFixed(3)}
              </div>
              <div className={`market-change ${isUp ? 'up' : 'down'}`}>
                {isUp ? '+' : ''}{m.change.toFixed(2)}%
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

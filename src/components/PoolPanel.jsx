// @ts-nocheck
import { useEffect, useState } from 'react';
import { formatTokenAmount, lookupLivePools, normalizeAddress, SUPPORTED_TOKENS } from '../lib/stonSwap';
import { TokenMark } from './Marks';

const PAIRS = [
  [SUPPORTED_TOKENS[0], SUPPORTED_TOKENS[1]],
  [SUPPORTED_TOKENS[0], SUPPORTED_TOKENS[2]],
  [SUPPORTED_TOKENS[1], SUPPORTED_TOKENS[2]]
];

function poolToken(pool, index) {
  const tokenAddress = pool[`token${index}Address`];
  return SUPPORTED_TOKENS.find((token) => normalizeAddress(token.address) === normalizeAddress(tokenAddress));
}

export default function PoolPanel() {
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.allSettled(PAIRS.map(([token0, token1]) => lookupLivePools(token0, token1)))
      .then((results) => {
        if (cancelled) return;
        const rejected = results.filter((result) => result.status === 'rejected');
        const loaded = results
          .filter((result) => result.status === 'fulfilled')
          .flatMap((result) => result.value)
          .filter((pool) => !pool.deprecated && poolToken(pool, 0) && poolToken(pool, 1));
        setPools(loaded);
        if (rejected.length && !loaded.length) {
          setError(rejected[0].reason instanceof Error ? rejected[0].reason.message : String(rejected[0].reason));
        } else if (rejected.length) {
          setError('Некоторые пары временно недоступны; отображены только успешно загруженные данные.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reload]);

  return (
    <main className="card">
      <div className="section-heading">
        <div><small>STON.fi · только чтение</small><h2>Pools</h2></div>
        <span className="chip live-chip">STON.FI</span>
      </div>
      <p className="fine-print">Реальные пулы TON mainnet, загруженные из STON.fi API. Добавление и вывод ликвидности в этом интерфейсе не поддерживаются.</p>
      {loading && <p className="muted">Загружаем данные пулов…</p>}
      {error && <p className="inline-warning">{error}</p>}
      {!loading && !pools.length && !error && <p className="muted">Для выбранных активов активные пулы не найдены.</p>}
      {pools.map((pool) => {
        const token0 = poolToken(pool, 0);
        const token1 = poolToken(pool, 1);
        const tvl = Number(pool.lpTotalSupplyUsd);
        const volume = Number(pool.volume24HUsd);
        const lpFee = Number(pool.lpFee);
        return (
          <article className="pool-live-item" key={`${pool.address}-${pool.routerAddress}`}>
            <div className="subheading">
              <div className="pool-pair">
                <span className="pair-mark"><TokenMark symbol={token0.symbol} /></span>
                <span className="pair-mark"><TokenMark symbol={token1.symbol} /></span>
                <h3>{token0.symbol} / {token1.symbol}</h3>
              </div>
              <span className="chip live-chip">ON-CHAIN</span>
            </div>
            <div className="pool-reserves">
              <div>
                <span>Резерв {token0.symbol}</span>
                <strong>{formatTokenAmount(pool.reserve0, token0.decimals)}</strong>
              </div>
              <div>
                <span>Резерв {token1.symbol}</span>
                <strong>{formatTokenAmount(pool.reserve1, token1.decimals)}</strong>
              </div>
            </div>
            {Number.isFinite(lpFee) && <div className="detail-row"><span>Комиссия пула</span><strong>{(lpFee / 100).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}%</strong></div>}
            {Number.isFinite(tvl) && <div className="detail-row"><span>TVL (оценка API)</span><strong>${tvl.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</strong></div>}
            {Number.isFinite(volume) && <div className="detail-row"><span>Объем 24ч (оценка API)</span><strong>${volume.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</strong></div>}
            <a className="text-button explorer-link" href={`https://tonviewer.com/${encodeURIComponent(pool.address)}`} target="_blank" rel="noreferrer">Открыть контракт пула ↗</a>
          </article>
        );
      })}
      <button type="button" className="text-button" disabled={loading} onClick={() => setReload((value) => value + 1)}>Обновить пулы</button>
    </main>
  );
}

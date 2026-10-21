export const POOL_FEE_BPS = 30;
const BPS_DENOMINATOR = 10_000;

const seedPools = {
  'TON-USDT': { token0: 'TON', token1: 'USDT', reserve0: 1000, reserve1: 7800, totalLp: Math.sqrt(1000 * 7800) },
  'NOT-TON': { token0: 'NOT', token1: 'TON', reserve0: 1_000_000, reserve1: 500, totalLp: Math.sqrt(1_000_000 * 500) },
  'NOT-USDT': { token0: 'NOT', token1: 'USDT', reserve0: 975_000, reserve1: 4000, totalLp: Math.sqrt(975_000 * 4000) }
};

export function getPoolKey(symbolA, symbolB) {
  return [symbolA, symbolB].sort().join('-');
}

export function initialDemoState() {
  return {
    balances: { TON: 12.45, USDT: 540.21, NOT: 5400 },
    pools: structuredClone(seedPools),
    positions: { 'TON-USDT': 0, 'NOT-TON': 0, 'NOT-USDT': 0 },
    history: []
  };
}

export function calculateSwap(amountIn, reserveIn, reserveOut, feeBps = POOL_FEE_BPS) {
  if (![amountIn, reserveIn, reserveOut, feeBps].every(Number.isFinite)
    || amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0
    || feeBps < 0 || feeBps >= BPS_DENOMINATOR) return null;
  const fee = amountIn * feeBps / BPS_DENOMINATOR;
  const amountInAfterFee = amountIn - fee;
  const amountOut = reserveOut * amountInAfterFee / (reserveIn + amountInAfterFee);
  const spotRate = reserveOut / reserveIn;
  return {
    fee,
    amountOut,
    spotRate,
    priceImpact: Math.max(0, (1 - amountOut / amountIn / spotRate) * 100),
    reserveInAfter: reserveIn + amountIn,
    reserveOutAfter: reserveOut - amountOut
  };
}

export function addLiquidity(pool, amount0) {
  if (!pool || !Number.isFinite(amount0) || amount0 <= 0
    || pool.reserve0 <= 0 || pool.reserve1 <= 0 || pool.totalLp <= 0) return null;
  const amount1 = amount0 * pool.reserve1 / pool.reserve0;
  const mintedLp = amount0 * pool.totalLp / pool.reserve0;
  if (!Number.isFinite(amount1) || !Number.isFinite(mintedLp) || mintedLp <= 0) return null;
  return {
    amount0,
    amount1,
    mintedLp,
    pool: {
      ...pool,
      reserve0: pool.reserve0 + amount0,
      reserve1: pool.reserve1 + amount1,
      totalLp: pool.totalLp + mintedLp
    }
  };
}

export function removeLiquidity(pool, userLp, percent) {
  if (!pool || ![userLp, percent].every(Number.isFinite)
    || userLp <= 0 || percent <= 0 || percent > 100 || pool.totalLp <= 0) return null;
  const burnedLp = userLp * percent / 100;
  const share = burnedLp / pool.totalLp;
  const amount0 = pool.reserve0 * share;
  const amount1 = pool.reserve1 * share;
  return {
    amount0,
    amount1,
    remainingLp: userLp - burnedLp,
    pool: {
      ...pool,
      reserve0: pool.reserve0 - amount0,
      reserve1: pool.reserve1 - amount1,
      totalLp: pool.totalLp - burnedLp
    }
  };
}

export function formatAmount(value, symbol = '') {
  if (!Number.isFinite(Number(value))) return '0';
  const maximumFractionDigits = symbol === 'PERCENT' ? 3
    : symbol === 'TON' || symbol === 'NOT' ? 6
      : symbol === 'USDT' ? 4 : 6;
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits });
}

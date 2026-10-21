import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addLiquidity,
  calculateSwap,
  getPoolKey,
  initialDemoState,
  removeLiquidity
} from '../src/lib/amm.js';

test('swap applies the 0.30% pool fee and preserves the constant-product quote', () => {
  const amountIn = 10;
  const reserveIn = 1000;
  const reserveOut = 7800;
  const quote = calculateSwap(amountIn, reserveIn, reserveOut);
  const netInput = amountIn * 0.997;

  assert.equal(quote.fee, 0.03);
  assert.ok(Math.abs(quote.amountOut - (reserveOut * netInput) / (reserveIn + netInput)) < 1e-10);
  assert.equal(quote.reserveInAfter, reserveIn + amountIn);
  assert.ok(quote.reserveOutAfter < reserveOut);
  assert.ok(quote.priceImpact > 0);
});

test('swap rejects invalid reserves and amounts', () => {
  assert.equal(calculateSwap(0, 1, 1), null);
  assert.equal(calculateSwap(1, 0, 1), null);
  assert.equal(calculateSwap(1, 1, 1, 10_000), null);
});

test('adding and removing liquidity adjusts proportional reserves and LP shares', () => {
  const pool = initialDemoState().pools['TON-USDT'];
  const added = addLiquidity(pool, 10);
  assert.ok(added);
  assert.equal(added.amount1, 78);
  assert.ok(added.mintedLp > 0);
  assert.equal(added.pool.reserve0, pool.reserve0 + 10);
  assert.equal(added.pool.reserve1, pool.reserve1 + 78);

  const removed = removeLiquidity(added.pool, added.mintedLp, 100);
  assert.ok(removed);
  assert.ok(Math.abs(removed.amount0 - 10) < 1e-10);
  assert.ok(Math.abs(removed.amount1 - 78) < 1e-10);
  assert.ok(Math.abs(removed.remainingLp) < 1e-10);
});

test('liquidity operations validate user input', () => {
  const pool = initialDemoState().pools['TON-USDT'];
  assert.equal(addLiquidity(pool, 0), null);
  assert.equal(removeLiquidity(pool, 1, 101), null);
  assert.equal(getPoolKey('USDT', 'TON'), 'TON-USDT');
});

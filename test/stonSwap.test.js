import assert from 'node:assert/strict';
import test from 'node:test';
import { beginCell } from '@ton/ton';
import { calculateFuturesEstimate } from '../src/lib/futuresEstimate.js';
import { normalizeSwapHistory } from '../src/lib/swapHistory.js';
import {
  formatTokenAmount,
  formatExchangeRate,
  getExternalMessageHash,
  getWalletTokenBalance,
  normalizeAddress,
  parseTokenAmount,
  toSlippagePercent,
  SUPPORTED_TOKENS
} from '../src/lib/stonSwap.js';

test('parses token amounts exactly without floating point conversion', () => {
  assert.equal(parseTokenAmount('1.000000001', 9), '1000000001');
  assert.equal(parseTokenAmount('1,000000001', 9), '1000000001');
  assert.equal(parseTokenAmount('0.000001', 6), '1');
  assert.equal(parseTokenAmount('1,0000001', 6), null);
  assert.equal(parseTokenAmount('1,2.3', 9), null);
  assert.equal(parseTokenAmount('0', 9), null);
  assert.equal(parseTokenAmount('-1', 9), null);
  assert.equal(parseTokenAmount('1.0000001', 6), null);
});

test('formats integer token units without losing precision', () => {
  assert.equal(formatTokenAmount('12345678901', 9), '12,345678901');
  assert.equal(formatTokenAmount('1000000', 6), '1');
  assert.equal(formatTokenAmount('invalid', 9), '—');
});

test('formats the quoted exchange rate using token decimals without floating point', () => {
  const ton = { decimals: 9 };
  const usdt = { decimals: 6 };
  assert.equal(
    formatExchangeRate({ offerUnits: '1000000000', askUnits: '3123456' }, ton, usdt),
    '3,123456'
  );
  assert.equal(
    formatExchangeRate({ offerUnits: '0', askUnits: '1' }, ton, usdt),
    '—'
  );
});

test('calculates a futures position estimate without implying execution', () => {
  assert.deepEqual(calculateFuturesEstimate({
    margin: '20,5',
    price: '2.5',
    leverage: 10,
    side: 'long',
    orderType: 'limit',
    availableBalance: 25
  }), {
    marginUsd: 20.5,
    positionUsd: 205,
    assetQuantity: 82,
    adverseMovePercent: 10
  });
});

test('rejects invalid futures values and insufficient available collateral', () => {
  const base = {
    margin: '11',
    price: '2',
    leverage: 5,
    side: 'short',
    orderType: 'stop',
    availableBalance: 10
  };
  assert.match(calculateFuturesEstimate(base).error, /превышает доступный баланс/);
  assert.match(calculateFuturesEstimate({ ...base, leverage: 51 }).error, /от 1x до 50x/);
  assert.match(calculateFuturesEstimate({ ...base, price: '0' }).error, /больше нуля/);
  assert.match(calculateFuturesEstimate({ ...base, orderType: 'market' }).error, /доступный баланс/);
});

test('normalizes canonical TON and NOT addresses', () => {
  assert.equal(
    normalizeAddress(SUPPORTED_TOKENS[0].address),
    '0:'.concat('0'.repeat(64))
  );
  assert.equal(normalizeAddress(SUPPORTED_TOKENS[2].address), '0:2f956143c461769579baef2e32cc2d7bc18283f40d20bb03e432cd603ac33ffc');
  assert.match(SUPPORTED_TOKENS[2].apiAddress, /__NOT$/);
});

test('reads only network-provided wallet balances', () => {
  const walletData = {
    loading: false,
    balance: { balance: '1250000000' },
    jettons: [{
      jetton: { address: SUPPORTED_TOKENS[1].address },
      balance: '7654321'
    }],
    errors: []
  };
  assert.equal(getWalletTokenBalance(walletData, SUPPORTED_TOKENS[0]), '1250000000');
  assert.equal(getWalletTokenBalance(walletData, SUPPORTED_TOKENS[1]), '7654321');
  assert.equal(getWalletTokenBalance({ ...walletData, loading: true }, SUPPORTED_TOKENS[0]), null);
  assert.equal(getWalletTokenBalance({ ...walletData, errors: ['jettons: unavailable'] }, SUPPORTED_TOKENS[1]), null);
});

test('restores persisted swap statuses and valid transaction hashes', () => {
  const completedSwap = {
    id: '1-2',
    queryId: '1',
    routerAddress: SUPPORTED_TOKENS[0].address,
    ownerAddress: SUPPORTED_TOKENS[1].address,
    createdAt: Date.now(),
    fromSymbol: 'TON',
    toSymbol: 'USDT',
    fromAmount: '1',
    expectedAmount: '2',
    minimumAmount: '1.9',
    status: 'success',
    txHash: 'a'.repeat(64),
    walletTxHash: 'b'.repeat(64),
    exitCode: '0',
    error: ''
  };

  assert.deepEqual(normalizeSwapHistory([completedSwap]), [{
    ...completedSwap,
    statusCheckError: ''
  }]);
  assert.equal(normalizeSwapHistory([{ ...completedSwap, status: 'invalid', txHash: 'invalid' }])[0].status, 'pending');
  assert.equal(normalizeSwapHistory([{ ...completedSwap, status: 'invalid', txHash: 'invalid' }])[0].txHash, '');
});

test('formats slippage and extracts TonConnect external message hashes', () => {
  const cell = beginCell().storeUint(1, 1).endCell();
  const boc = cell.toBoc().toString('base64');
  assert.equal(toSlippagePercent('0.005'), '0,5%');
  assert.equal(getExternalMessageHash(boc), cell.hash().toString('hex').toUpperCase());
  assert.equal(getExternalMessageHash('not-a-boc'), null);
});

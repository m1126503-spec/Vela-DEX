import assert from 'node:assert/strict';
import test from 'node:test';
import { beginCell } from '@ton/ton';
import {
  formatTokenAmount,
  getExternalMessageHash,
  getWalletTokenBalance,
  normalizeAddress,
  parseTokenAmount,
  toSlippagePercent,
  SUPPORTED_TOKENS
} from '../src/lib/stonSwap.js';

test('parses token amounts exactly without floating point conversion', () => {
  assert.equal(parseTokenAmount('1.000000001', 9), '1000000001');
  assert.equal(parseTokenAmount('0.000001', 6), '1');
  assert.equal(parseTokenAmount('0', 9), null);
  assert.equal(parseTokenAmount('-1', 9), null);
  assert.equal(parseTokenAmount('1.0000001', 6), null);
});

test('formats integer token units without losing precision', () => {
  assert.equal(formatTokenAmount('12345678901', 9), '12,345678901');
  assert.equal(formatTokenAmount('1000000', 6), '1');
  assert.equal(formatTokenAmount('invalid', 9), '—');
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

test('formats slippage and extracts TonConnect external message hashes', () => {
  const cell = beginCell().storeUint(1, 1).endCell();
  const boc = cell.toBoc().toString('base64');
  assert.equal(toSlippagePercent('0.005'), '0,5%');
  assert.equal(getExternalMessageHash(boc), cell.hash().toString('hex').toUpperCase());
  assert.equal(getExternalMessageHash('not-a-boc'), null);
});

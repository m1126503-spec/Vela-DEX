import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchStormIntent,
  fetchStormMarkets,
  getStormV3Config,
  loadTrackedStormIntents,
  normalizeStormIntentHash,
  saveTrackedStormIntent
} from './stormV3.js';

test('read access requires explicit testnet configuration and rejects the mainnet host', () => {
  assert.deepEqual(getStormV3Config({
    VITE_STORM_V3_NETWORK: 'mainnet',
    VITE_STORM_V3_API_URL: 'https://testnet.invalid/v3-node-0',
    VITE_STORM_V3_MARKETS_URL: 'https://testnet.invalid/api/markets'
  }), { isTestnet: false, apiUrl: null, marketsUrl: null });

  assert.deepEqual(getStormV3Config({
    VITE_STORM_V3_NETWORK: 'testnet',
    VITE_STORM_V3_API_URL: 'https://api.storm.tg/v3-node-0',
    VITE_STORM_V3_MARKETS_URL: 'http://testnet.invalid/api/markets'
  }), { isTestnet: true, apiUrl: null, marketsUrl: null });
});

test('reads Storm markets from the configured endpoint and rejects malformed payloads', async () => {
  let requestedUrl = '';
  const markets = await fetchStormMarkets('https://testnet.invalid/api/markets', {
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify([{
        address: '0:market-address',
        config: { ticker: 'BTC-USDT', name: 'Bitcoin' },
        settings: { status: 'active', isPaused: false, isCloseOnly: false },
        amm: { indexPrice: 'not used for order sizing' }
      }]), { status: 200 });
    }
  });

  assert.equal(requestedUrl, 'https://testnet.invalid/api/markets');
  assert.deepEqual(markets, [{
    address: '0:market-address',
    ticker: 'BTC-USDT',
    name: 'Bitcoin',
    status: 'active',
    isPaused: false,
    isCloseOnly: false
  }]);
  await assert.rejects(fetchStormMarkets('https://testnet.invalid/api/markets', {
    fetchImpl: async () => new Response(JSON.stringify([{ address: 'bad' }]), { status: 200 })
  }), /неожиданный формат/);
});

test('checks intent status without creating or treating an accepted intent as a fill', async () => {
  const hash = 'A'.repeat(64);
  let requestedUrl = '';
  const result = await fetchStormIntent('https://testnet.invalid/v3-node-0', `0x${hash}`, {
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ status: 'accepted' }), { status: 200 });
    }
  });

  assert.equal(normalizeStormIntentHash(`0x${hash}`), 'a'.repeat(64));
  assert.equal(requestedUrl, `https://testnet.invalid/v3-node-0/intent/${'a'.repeat(64)}`);
  assert.deepEqual(result, { found: true, hash: 'a'.repeat(64), status: 'accepted' });

  const missing = await fetchStormIntent('https://testnet.invalid/v3-node-0', hash, {
    fetchImpl: async () => new Response('', { status: 404 })
  });
  assert.deepEqual(missing, { found: false, hash: 'a'.repeat(64), status: 'not_found' });
  await assert.rejects(fetchStormIntent('http://testnet.invalid/v3-node-0', hash), /HTTPS URL/);
  await assert.rejects(fetchStormIntent('https://testnet.invalid/v3-node-0', 'not-a-hash'), /64-символьный/);
});

test('saves intent hashes before checking and preserves previous hashes', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const firstHash = 'a'.repeat(64);
  const secondHash = '2'.repeat(64);

  assert.deepEqual(saveTrackedStormIntent(firstHash, storage), [firstHash]);
  assert.deepEqual(saveTrackedStormIntent(firstHash.toUpperCase(), storage), [firstHash]);
  assert.deepEqual(saveTrackedStormIntent(secondHash, storage), [firstHash, secondHash]);
  assert.deepEqual(loadTrackedStormIntents(storage), [firstHash, secondHash]);
  assert.throws(() => saveTrackedStormIntent('invalid', storage), /64-символьный/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { handleChainstackRpcRequest } from '../server/chainstackRpc.js';

const endpoint = 'https://node.example/secret-token';
const env = { CHAINSTACK_EVM_RPC_URL: endpoint };

function makeFetch(chainId = '0x66eee') {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), ...options });
    const payload = JSON.parse(options.body);
    if (payload.method === 'eth_chainId') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: payload.id,
        result: chainId
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: payload.id,
      result: '0x123'
    }), { status: 200 });
  };
  return { fetchImpl, requests };
}

test('reports unconfigured Chainstack without exposing an endpoint', async () => {
  const result = await handleChainstackRpcRequest({ method: 'GET', env: {} });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { configured: false, compatible: false });
});

test('uses configured Chainstack only after confirming the Arbitrum Sepolia chain ID', async () => {
  const { fetchImpl, requests } = makeFetch();
  const result = await handleChainstackRpcRequest({
    method: 'GET',
    env,
    fetchImpl
  });

  assert.deepEqual(result.body, {
    configured: true,
    compatible: true,
    chainId: '0x66eee'
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, endpoint);
  assert.equal(JSON.stringify(result.body).includes('secret-token'), false);
});

test('rejects a Chainstack node on an unrecognized chain before relaying requests', async () => {
  const { fetchImpl, requests } = makeFetch('0x1');
  const result = await handleChainstackRpcRequest({
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [] },
    env,
    fetchImpl
  });

  assert.equal(result.status, 503);
  assert.match(result.body.error, /does not match Arbitrum Sepolia/);
  assert.equal(requests.length, 1);
});

test('proxies read-only JSON-RPC after chain verification without returning the endpoint', async () => {
  const { fetchImpl, requests } = makeFetch();
  const payload = { jsonrpc: '2.0', id: 7, method: 'eth_getBalance', params: ['0xabc', 'latest'] };
  const result = await handleChainstackRpcRequest({
    method: 'POST',
    body: payload,
    env,
    fetchImpl
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { jsonrpc: '2.0', id: 7, result: '0x123' });
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].body), payload);
  assert.equal(JSON.stringify(result.body).includes('secret-token'), false);
});

test('rejects transaction submission and malformed RPC requests', async () => {
  const { fetchImpl, requests } = makeFetch();
  const denied = await handleChainstackRpcRequest({
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: ['0xdead'] },
    env,
    fetchImpl
  });
  assert.equal(denied.status, 403);
  assert.equal(requests.length, 0);

  const expensiveRead = await handleChainstackRpcRequest({
    method: 'POST',
    body: { jsonrpc: '2.0', id: 2, method: 'eth_getLogs', params: [] },
    env,
    fetchImpl
  });
  assert.equal(expensiveRead.status, 403);
  assert.equal(requests.length, 0);

  const malformed = await handleChainstackRpcRequest({
    method: 'POST',
    body: '{not json',
    env,
    fetchImpl
  });
  assert.equal(malformed.status, 400);
  assert.equal(requests.length, 0);
});

test('requires HTTPS for the server-only Chainstack endpoint', async () => {
  const result = await handleChainstackRpcRequest({
    method: 'GET',
    env: { CHAINSTACK_EVM_RPC_URL: 'http://node.example/token' },
    fetchImpl: makeFetch().fetchImpl
  });
  assert.deepEqual(result.body, { configured: true, compatible: false });
});

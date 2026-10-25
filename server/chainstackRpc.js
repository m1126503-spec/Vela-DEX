import { createPublicClient, http } from 'viem';

const HYPERLIQUID_TESTNET_CHAIN_ID = '0x66eee';
export const MAX_RPC_BODY_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 10;
const REQUEST_TIMEOUT_MS = 8_000;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
let rateWindowStartedAt = 0;
let requestsInRateWindow = 0;

const READ_ONLY_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getTransactionCount',
  'net_version',
  'web3_clientVersion'
]);

function createHttpClient(endpoint) {
  return createPublicClient({
    transport: http(endpoint, {
      timeout: REQUEST_TIMEOUT_MS,
      retryCount: 0
    })
  });
}

function getEndpoint(env) {
  const value = env.CHAINSTACK_EVM_RPC_URL;
  if (typeof value !== 'string' || !value.trim()) return null;

  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('CHAINSTACK_EVM_RPC_URL must be a valid HTTPS URL.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('CHAINSTACK_EVM_RPC_URL must use HTTPS and cannot contain URL credentials or a fragment.');
  }
  return endpoint.toString();
}

function parseRequests(body) {
  let serialized;
  try {
    serialized = typeof body === 'string' ? body : JSON.stringify(body);
  } catch {
    return { error: { status: 400, message: 'Invalid JSON-RPC request.' } };
  }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_RPC_BODY_BYTES) {
    return { error: { status: 413, message: 'JSON-RPC request is too large.' } };
  }

  let payload;
  try {
    payload = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return { error: { status: 400, message: 'Invalid JSON-RPC request.' } };
  }
  const requests = Array.isArray(payload) ? payload : [payload];
  if (!requests.length || requests.length > MAX_BATCH_SIZE) {
    return { error: { status: 400, message: 'Invalid JSON-RPC batch size.' } };
  }
  for (const request of requests) {
    if (!request
      || typeof request !== 'object'
      || Array.isArray(request)
      || request.jsonrpc !== '2.0'
      || !READ_ONLY_METHODS.has(request.method)
      || !['string', 'number'].includes(typeof request.id)
      || (request.params !== undefined
        && (!request.params || typeof request.params !== 'object'))) {
      return { error: { status: 403, message: 'Only supported read-only JSON-RPC methods are allowed.' } };
    }
  }
  return { payload };
}

function jsonResponse(status, body) {
  return { status, body };
}

function consumeRateLimit(requestCount) {
  const now = Date.now();
  if (now - rateWindowStartedAt >= RATE_WINDOW_MS) {
    rateWindowStartedAt = now;
    requestsInRateWindow = 0;
  }
  if (requestsInRateWindow + requestCount > MAX_REQUESTS_PER_WINDOW) return false;
  requestsInRateWindow += requestCount;
  return true;
}

async function postRpc(endpoint, body, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Chainstack returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyExpectedChain(endpoint, fetchImpl) {
  const response = await postRpc(endpoint, {
    jsonrpc: '2.0',
    id: 'vela-chainstack-chain-check',
    method: 'eth_chainId',
    params: []
  }, fetchImpl);
  const actualChainId = response?.result;
  return typeof actualChainId === 'string'
    && /^0x[0-9a-f]+$/i.test(actualChainId)
    && BigInt(actualChainId) === BigInt(HYPERLIQUID_TESTNET_CHAIN_ID);
}

async function inspectChain(endpoint, clientFactory) {
  const client = clientFactory(endpoint);
  const chainId = (await client.getChainId()).toString();
  const latestBlock = (await client.getBlockNumber()).toString();
  return {
    chainId,
    latestBlock,
    compatible: BigInt(chainId) === BigInt(HYPERLIQUID_TESTNET_CHAIN_ID)
  };
}

export async function handleChainstackRpcRequest({
  method,
  body,
  env = process.env,
  fetchImpl = fetch,
  clientFactory = createHttpClient
}) {
  if (method !== 'GET' && method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  let endpoint;
  try {
    endpoint = getEndpoint(env);
  } catch {
    return jsonResponse(503, { configured: true, compatible: false });
  }
  if (!endpoint) {
    return method === 'GET'
      ? jsonResponse(200, { configured: false, compatible: false })
      : jsonResponse(503, { error: 'Chainstack RPC is not configured.' });
  }
  if (typeof fetchImpl !== 'function' || typeof clientFactory !== 'function') {
    return jsonResponse(503, { configured: true, compatible: false });
  }

  if (method === 'GET') {
    if (!consumeRateLimit(1)) {
      return jsonResponse(429, { error: 'Chainstack RPC rate limit exceeded.' });
    }
    try {
      const status = await inspectChain(endpoint, clientFactory);
      return jsonResponse(200, { configured: true, ...status });
    } catch {
      return jsonResponse(502, { configured: true, compatible: false });
    }
  }

  const parsed = method === 'POST' ? parseRequests(body) : null;
  if (parsed?.error) {
    return jsonResponse(parsed.error.status, { error: parsed.error.message });
  }
  const requestCount = parsed ? parsed.payload.length : 1;
  if (!consumeRateLimit(requestCount)) {
    return jsonResponse(429, { error: 'Chainstack RPC rate limit exceeded.' });
  }

  try {
    const compatible = await verifyExpectedChain(endpoint, fetchImpl);
    if (!compatible) {
      return jsonResponse(503, { error: 'Configured Chainstack node does not match Arbitrum Sepolia.' });
    }

    const response = await postRpc(endpoint, parsed.payload, fetchImpl);
    return jsonResponse(200, response);
  } catch (error) {
    const status = error?.name === 'AbortError' ? 504 : 502;
    return jsonResponse(status, { error: 'Chainstack RPC request failed.' });
  }
}

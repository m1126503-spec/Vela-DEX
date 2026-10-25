import { createPublicKey, verify } from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const KEY_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const MOUNT_PATTERN = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/;

function parseVaultAddress(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VAULT_ADDR must be a valid HTTPS URL.');
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback))
    || url.username
    || url.password
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash) {
    throw new Error('VAULT_ADDR must be an HTTPS origin (HTTP is allowed only for loopback development).');
  }

  return url.origin;
}

function parseTransitMount(value) {
  const mount = value.replace(/^\/+|\/+$/g, '');
  if (!mount || !MOUNT_PATTERN.test(mount)) {
    throw new Error('Vault Transit mount must be a slash-separated path of letters, digits, "_" or "-".');
  }
  return mount;
}

function makeKeyObject(publicKeyPem) {
  if (typeof publicKeyPem !== 'string' || !publicKeyPem.includes('BEGIN PUBLIC KEY')) {
    throw new Error('Vault Transit did not return an Ed25519 public key.');
  }

  let key;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    throw new Error('Vault Transit returned an invalid public key.');
  }
  const der = key.export({ format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519'
    || der.length !== ED25519_SPKI_PREFIX.length + 32
    || !der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new Error('Vault Transit key is not a 32-byte Ed25519 key.');
  }

  return { key, raw: der.subarray(ED25519_SPKI_PREFIX.length) };
}

function decodeVaultSignature(value, keyVersion) {
  if (typeof value !== 'string') {
    throw new Error('Vault Transit did not return a signature.');
  }
  const match = /^vault:v(\d+):([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || Number(match[1]) !== keyVersion) {
    throw new Error('Vault Transit returned a signature for an unexpected key version.');
  }

  const signature = Buffer.from(match[2], 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== match[2]) {
    throw new Error('Vault Transit returned an invalid Ed25519 signature.');
  }
  return signature;
}

export async function createVaultStormSigner({
  vaultAddress,
  vaultToken,
  keyName,
  transitMount = 'transit',
  expectedKeyVersion,
  allowLatestKeyVersion = false,
  fetchImpl = fetch,
  timeoutMs = 8_000
}) {
  if (typeof vaultToken !== 'string' || !vaultToken.trim()) {
    throw new Error('VAULT_TOKEN is required.');
  }
  if (typeof keyName !== 'string' || !KEY_NAME_PATTERN.test(keyName)) {
    throw new Error('VAULT_TRANSIT_KEY must contain only letters, digits, "_" or "-".');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error('Vault request timeout must be between 1 and 60000 milliseconds.');
  }
  if (expectedKeyVersion === undefined && !allowLatestKeyVersion) {
    throw new Error('A Storm-registered Vault key version is required.');
  }
  if (expectedKeyVersion !== undefined
    && (!Number.isSafeInteger(expectedKeyVersion) || expectedKeyVersion < 1)) {
    throw new Error('Expected Vault Transit key version must be a positive safe integer.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const baseUrl = parseVaultAddress(vaultAddress);
  const mount = parseTransitMount(transitMount);
  const keyUrl = `${baseUrl}/v1/${mount}/keys/${encodeURIComponent(keyName)}`;
  const headers = {
    Accept: 'application/json',
    'X-Vault-Token': vaultToken
  };

  async function vaultRequest(url, method, body, operation) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Vault Transit ${operation} failed (HTTP ${response.status}).`);
      try {
        return await response.json();
      } catch {
        throw new Error(`Vault Transit ${operation} returned invalid JSON.`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const keyResponse = await vaultRequest(keyUrl, 'GET', undefined, 'key lookup');
  const keyData = keyResponse?.data;
  const keyVersion = expectedKeyVersion ?? keyData?.latest_version;
  const versionData = keyData?.keys?.[String(keyVersion)];
  if (keyData?.type !== 'ed25519'
    || keyData.supports_signing !== true
    || !Number.isSafeInteger(keyVersion)
    || keyVersion < 1
    || typeof versionData?.public_key !== 'string') {
    throw new Error('Configured Vault Transit key must be an active, signing-capable Ed25519 key.');
  }
  const { key: publicKeyObject, raw: publicKey } = makeKeyObject(versionData.public_key);
  const signUrl = `${baseUrl}/v1/${mount}/sign/${encodeURIComponent(keyName)}`;

  return Object.freeze({
    keyVersion,
    publicKey: Uint8Array.from(publicKey),
    publicKeyHex: publicKey.toString('hex'),
    async sign(hash) {
      if (!(hash instanceof Uint8Array) || hash.byteLength !== 32) {
        throw new Error('Storm V3 signer accepts only an exact 32-byte intent hash.');
      }
      const message = Buffer.from(hash);
      const response = await vaultRequest(signUrl, 'POST', {
        input: message.toString('base64'),
        key_version: keyVersion,
        prehashed: false
      }, 'sign operation');
      const signature = decodeVaultSignature(response?.data?.signature, keyVersion);
      if (!verify(null, message, publicKeyObject, signature)) {
        throw new Error('Vault Transit signature did not verify as a pure Ed25519 signature for the Storm hash.');
      }
      return Uint8Array.from(signature);
    }
  });
}

export async function createVaultStormSignerFromEnv(options = {}) {
  const { allowLatestKeyVersion = false, ...overrides } = options;
  const rawKeyVersion = process.env.VAULT_TRANSIT_KEY_VERSION;
  let expectedKeyVersion;
  if (rawKeyVersion !== undefined && rawKeyVersion !== '') {
    if (!/^[1-9]\d*$/.test(rawKeyVersion) || !Number.isSafeInteger(Number(rawKeyVersion))) {
      throw new Error('VAULT_TRANSIT_KEY_VERSION must be a positive safe integer.');
    }
    expectedKeyVersion = Number(rawKeyVersion);
  } else if (!allowLatestKeyVersion) {
    throw new Error('VAULT_TRANSIT_KEY_VERSION must pin the Storm-registered Vault key version.');
  }

  return createVaultStormSigner({
    vaultAddress: process.env.VAULT_ADDR,
    vaultToken: process.env.VAULT_TOKEN,
    keyName: process.env.VAULT_TRANSIT_KEY,
    transitMount: process.env.VAULT_TRANSIT_MOUNT || 'transit',
    expectedKeyVersion,
    allowLatestKeyVersion,
    ...overrides
  });
}

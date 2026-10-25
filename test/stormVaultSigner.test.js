import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as ed25519Sign } from 'node:crypto';
import test from 'node:test';
import { createVaultStormSigner } from '../server/stormVaultSigner.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function makeVault(fetchOptions = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), ...options });
    if (options.method === 'GET') {
      const latestVersion = fetchOptions.latestVersion ?? 3;
      return new Response(JSON.stringify({
        data: {
          type: 'ed25519',
          supports_signing: true,
          latest_version: latestVersion,
          keys: {
            3: { public_key: publicKeyPem },
            ...(latestVersion === 3 ? {} : { [latestVersion]: { public_key: publicKeyPem } })
          }
        }
      }), { status: 200 });
    }

    const body = JSON.parse(options.body);
    const message = Buffer.from(body.input, 'base64');
    const signature = ed25519Sign(null, message, privateKey);
    return new Response(JSON.stringify({
      data: {
        signature: `vault:v3:${signature.toString('base64')}`,
        ...fetchOptions.signResponse
      }
    }), { status: 200 });
  };
  return { fetchImpl, requests };
}

test('signs exactly the Storm 32-byte hash with Vault pure Ed25519 and verifies the response', async () => {
  const { fetchImpl, requests } = makeVault();
  const signer = await createVaultStormSigner({
    vaultAddress: 'https://vault.example',
    vaultToken: 'test-token',
    keyName: 'vela-storm-signer',
    expectedKeyVersion: 3,
    fetchImpl
  });
  const hash = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  const signature = await signer.sign(hash);

  assert.equal(signer.keyVersion, 3);
  assert.equal(signer.publicKey.length, 32);
  assert.equal(signer.publicKeyHex.length, 64);
  assert.equal(signature.length, 64);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://vault.example/v1/transit/keys/vela-storm-signer');
  assert.equal(requests[1].url, 'https://vault.example/v1/transit/sign/vela-storm-signer');
  assert.equal(requests[1].headers['X-Vault-Token'], 'test-token');
  assert.deepEqual(JSON.parse(requests[1].body), {
    input: hash.toString('base64'),
    key_version: 3,
    prehashed: false
  });
});

test('continues using the Storm-registered key version after Vault key rotation', async () => {
  const { fetchImpl, requests } = makeVault({ latestVersion: 4 });
  const signer = await createVaultStormSigner({
    vaultAddress: 'https://vault.example',
    vaultToken: 'test-token',
    keyName: 'vela-storm-signer',
    expectedKeyVersion: 3,
    fetchImpl
  });
  await signer.sign(new Uint8Array(32));
  assert.equal(signer.keyVersion, 3);
  assert.equal(JSON.parse(requests[1].body).key_version, 3);
});

test('rejects non-32-byte inputs before contacting Vault to sign', async () => {
  const { fetchImpl, requests } = makeVault();
  const signer = await createVaultStormSigner({
    vaultAddress: 'https://vault.example',
    vaultToken: 'test-token',
    keyName: 'vela-storm-signer',
    expectedKeyVersion: 3,
    fetchImpl
  });

  await assert.rejects(signer.sign(new Uint8Array(31)), /exact 32-byte intent hash/);
  assert.equal(requests.length, 1);
});

test('rejects unverified signatures and non-Ed25519 key configuration', async () => {
  const { fetchImpl } = makeVault({ signResponse: { signature: 'vault:v3:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' } });
  const signer = await createVaultStormSigner({
    vaultAddress: 'https://vault.example',
    vaultToken: 'test-token',
    keyName: 'vela-storm-signer',
    expectedKeyVersion: 3,
    fetchImpl
  });
  await assert.rejects(signer.sign(new Uint8Array(32)), /did not verify/);

  await assert.rejects(createVaultStormSigner({
    vaultAddress: 'https://vault.example',
    vaultToken: 'test-token',
    keyName: 'vela-storm-signer',
    expectedKeyVersion: 3,
    fetchImpl: async () => new Response(JSON.stringify({
      data: { type: 'ed25519ph', supports_signing: true, latest_version: 1, keys: { 1: { public_key: publicKeyPem } } }
    }), { status: 200 })
  }), /active, signing-capable Ed25519 key/);
});

test('requires TLS except for loopback Vault and refuses malformed configuration', async () => {
  const { fetchImpl, requests } = makeVault();
  const config = { vaultToken: 'test-token', keyName: 'vela-storm-signer', expectedKeyVersion: 3, fetchImpl };
  await assert.rejects(createVaultStormSigner({
    vaultAddress: 'https://vault.example',
    vaultToken: 'test-token',
    keyName: 'vela-storm-signer',
    fetchImpl
  }), /Storm-registered Vault key version/);
  assert.equal(requests.length, 0);
  await assert.rejects(createVaultStormSigner({ ...config, vaultAddress: 'http://vault.example' }), /HTTPS origin/);
  await assert.rejects(createVaultStormSigner({ ...config, vaultAddress: 'https://vault.example/path' }), /HTTPS origin/);
  await assert.rejects(createVaultStormSigner({ ...config, vaultAddress: 'https://vault.example', keyName: 'bad/name' }), /VAULT_TRANSIT_KEY/);
  await createVaultStormSigner({ ...config, vaultAddress: 'http://127.0.0.1' });
  assert.equal(requests.at(-1).url, 'http://127.0.0.1/v1/transit/keys/vela-storm-signer');
});

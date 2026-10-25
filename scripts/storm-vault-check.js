import { createHash } from 'node:crypto';
import { createVaultStormSignerFromEnv } from '../server/stormVaultSigner.js';

try {
  const signer = await createVaultStormSignerFromEnv({ allowLatestKeyVersion: true });
  const testHash = createHash('sha256')
    .update('vela-storm-vault-ed25519-compatibility-check')
    .digest();
  await signer.sign(testHash);
  console.log(`Vault Transit Ed25519 check passed (key version ${signer.keyVersion}).`);
  console.log(`Storm signer public key: ${signer.publicKeyHex}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

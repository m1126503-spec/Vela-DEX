import os
import sys
from urllib.parse import urlsplit

from web3 import Web3
from web3.exceptions import Web3Exception


def get_endpoint():
    endpoint = os.environ.get("CHAINSTACK_EVM_RPC_URL", "").strip()
    if not endpoint:
        raise ValueError("CHAINSTACK_EVM_RPC_URL is not configured.")

    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Configure a valid HTTPS Chainstack endpoint without URL user credentials.")
    return endpoint


def main():
    try:
        web3 = Web3(Web3.HTTPProvider(get_endpoint(), request_kwargs={"timeout": 8}))
        if not web3.is_connected():
            raise ConnectionError("Chainstack RPC did not respond.")

        print(f"Chain ID: {web3.eth.chain_id}")
        print(f"Latest block: {web3.eth.block_number}")
    except (ValueError, Web3Exception, OSError, TimeoutError):
        print("Chainstack RPC check failed. Verify the local endpoint and network connectivity.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

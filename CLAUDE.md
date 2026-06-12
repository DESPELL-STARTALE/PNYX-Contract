# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PNYX-Contract is a Hardhat + TypeScript Solidity project. It currently contains a single contract, `TournamentFinalizer`, which verifies an EIP-712 signature issued by the PNYX backend and emits a `TournamentFinalized` event for off-chain indexing. It stores no tournament results on-chain (only a per-user replay nonce); all tallying happens off-chain in the indexer that consumes the event.

## Commands

```bash
npm install                                  # install dependencies
npx hardhat compile                          # compile contracts + generate TypeChain types
npx hardhat test                             # run the full test suite (Mocha/Chai)
npx hardhat test --grep "duplicate items"    # run a single test by name (matches `it`/`describe` text)
npx hardhat coverage                         # solidity-coverage report
REPORT_GAS=true npx hardhat test             # test run with gas reporting (hardhat-gas-reporter)
```

Deploy and on-chain interaction (all require a configured `--network`):

```bash
npx hardhat run scripts/deploy.ts --network <network>                          # deploy, writes scripts/output/deployment-info.json
npx hardhat run scripts/tournamentFinalizer/finalizeTournament.ts --network <network>
npx hardhat run scripts/tournamentFinalizer/getNonce.ts --network <network>
npx hardhat verify --network SoneiumMainnet <address>                          # Blockscout/Sourcify verification
```

Configured networks (`hardhat.config.ts`): `localhost`, `SoneiumTestnet`, `SoneiumMainnet`, `EthSepoliaTestnet`, `BaseSepoliaTestnet`. There is no default network, so `--network` is mandatory for any RPC interaction.

## Environment variables

RPC URLs and keys are read from `.env` (gitignored). The config references: `LK_TESTNET_PROVIDER_URL`, `SONEIUM_TESTNET_PROVIDER_URL`, `SONEIUM_MAINNET_PROVIDER_URL`, `ETH_SEPOLIA_TESTNET_PROVIDER_URL`, `BASE_SEPOLIA_TESTNET_PROVIDER_URL`, `PRIVATE_KEY`, and `OWNER_KEY`.

EIP-712 specific keys (read with a `requireEnv` helper, pikit-contract pattern):
- `FINALIZE_SIGNER` — read by `scripts/deploy.ts`; the public address baked into the contract as the authorized signer. Validated with `ethers.isAddress` and must be non-zero. Must equal the public address of the PNYX-BE signing key (`SONEIUM_*_TOURNAMENT_FINALIZER_PRIVATE_KEY`).
- `FINALIZE_TYPEHASH` — read by `scripts/deploy.ts`; the EIP-712 **type string** (not a hash) passed to the constructor, which stores `keccak256(bytes(...))`. Must equal `"FinalizeTournament(address user,uint256 tournamentId,bytes tournamentData,uint256 point,uint256 nonce,uint256 deadline)"` to match PNYX-BE.
- `FINALIZE_SIGNER_KEY` — read by `scripts/tournamentFinalizer/finalizeTournament.ts` only, to reproduce the backend's signing flow locally for testing. Not needed in production (the signature comes from PNYX-BE).

Note the two distinct signing paths: `hardhat.config.ts` wires each network's `accounts` to `PRIVATE_KEY`, but `scripts/deploy.ts` ignores that and constructs its own provider + wallet from `OWNER_KEY`. The interaction scripts (`getNonce`, `finalizeTournament`) use the hardhat-configured signer (`PRIVATE_KEY`) as the *caller* (`msg.sender`). So deployment and post-deploy interaction can run as different accounts by design.

## Contract architecture (`contracts/TournamentFinalizer.sol`)

The single entry point is `finalizeTournament(uint16 _tournamentId, bytes calldata _tournamentData, uint256 _point, uint256 _deadline, bytes calldata _signature)`. Anyone can call it, but the call only succeeds if `_signature` is a valid EIP-712 signature from the authorized signer over the caller (`msg.sender`) and the supplied fields. The contract extends `Ownable` for the signer/typehash setters and `EIP712` for the domain separator.

The contract does **not** parse, validate, or store tournament data — it follows the **pikit-contract** (`Quest.sol`) signature pattern: verify a backend-issued signature, bump a per-user nonce, emit an event. It does not enforce data length, power-of-two brackets, or item uniqueness (those checks were removed). The backend (`PNYX-BE`) pre-validates the bracket before issuing a signature.

What the contract must match in `PNYX-BE` (`src/module/api/signature/` and `src/scanner/config/chain/`) — these are coupled and changing either side breaks signature verification:

- **EIP-712 domain:** `EIP712("TournamentFinalizer", "1")` → `{ name, version, chainId, verifyingContract }` (no salt). The `name`/`version` are immutable once deployed and must equal the backend's `EIP712_TOURNAMENT_FINALIZER_NAME` / `_VERSION` env values.
- **Signed struct (typehash):** `FinalizeTournament(address user,uint256 tournamentId,bytes tournamentData,uint256 point,uint256 nonce,uint256 deadline)`. The typehash is set from `_typeString` in the constructor (`keccak256(bytes(_typeString))`) and is owner-updatable via `setFinalizeTypeHash`. `deploy.ts` passes this exact string from the `FINALIZE_TYPEHASH` env var.
- **structHash:** `keccak256(abi.encode(finalizeTypeHash, msg.sender, _tournamentId, keccak256(_tournamentData), _point, nonces[msg.sender], _deadline))`. Note `_tournamentId` is `uint16` but `abi.encode` left-pads it to a 32-byte word, matching the backend's `uint256` encoding for any value in `[0, 65535]`. The `bytes` member is encoded as `keccak256(_tournamentData)` per EIP-712.
- **Replay protection:** `mapping(address => uint256) public nonces`, incremented on each success. The backend reads it via `contract.nonces(userAddress)`.
- **Signer:** `finalizeSigner` (set in constructor, owner-updatable via `setFinalizeSigner`) must equal the public address of the backend's signing key.

Errors: `ExpiredSignature`, `InvalidSignature` (defensive; OZ `ECDSA.recover` reverts before this for malformed sigs), `InvalidSigner`, `ZeroAddress`, `ValueUnchanged`.

Event (unchanged, and the scanner ABI in `PNYX-BE/src/scanner/config/chain/soneium-*.chain.ts` depends on this exact shape): `TournamentFinalized(address indexed user, bytes32 indexed tournamentDataHash, uint16 tournamentId, bytes tournamentData)`, where `tournamentDataHash = keccak256(_tournamentData)`. The backend decodes args by name (`user`, `tournamentDataHash`, `tournamentId`, `tournamentData`).

**`_tournamentData` encoding:** still a tightly packed array of `uint16` item IDs in big-endian ([MSB][LSB] per 2-byte item), but the contract treats it as opaque bytes — only its keccak256 hash is used (in the structHash and the event).

**Naming caveat:** the contract's tournament identifier is `_tournamentId`, but the test suite sometimes refers to the same value as `themeId`. Treat "theme" and "tournament ID" as synonyms when reading across files.

## Scripts ↔ deployment-info.json

`scripts/deploy.ts` writes the deployed address to `scripts/output/deployment-info.json` (under `contracts.tournamentFinalizer`, plus a `finalizeSigner` field for the record). The interaction scripts (`finalizeTournament.ts`, `getNonce.ts`) read the address back from that file and will throw if it is missing — so deploy first, then interact. This JSON is committed to the repo, so it reflects the last recorded deployment. The interaction scripts hardcode their inputs (e.g. `TOURNAMENT_ID`, `POINT`, `DEADLINE_SECONDS`, participant generation params) as top-of-file constants meant to be edited before running.

After deploying, update the backend's contract-address config (`PNYX-BE` `SONEIUM_*_TOURNAMENT_FINALIZER_CONTRACT_ADDRESS`) to the new address, since it is part of the EIP-712 domain (`verifyingContract`).

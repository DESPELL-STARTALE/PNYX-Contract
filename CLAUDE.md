# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PNYX-Contract is a Hardhat + TypeScript Solidity project. It currently contains a single contract, `TournamentFinalizer`, which records tournament results on-chain: it tallies how many tournaments ran per theme and tracks first-place / second-place counts per item, emitting an event for off-chain indexing.

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
npx hardhat run scripts/tournamentFinalizer/getStats.ts --network <network>
npx hardhat run scripts/tournamentFinalizer/getTournamentCnt.ts --network <network>
npx hardhat verify --network SoneiumMainnet <address>                          # Blockscout/Sourcify verification
```

Configured networks (`hardhat.config.ts`): `localhost`, `SoneiumTestnet`, `SoneiumMainnet`, `EthSepoliaTestnet`, `BaseSepoliaTestnet`. There is no default network, so `--network` is mandatory for any RPC interaction.

## Environment variables

RPC URLs and keys are read from `.env` (gitignored). The config references: `LK_TESTNET_PROVIDER_URL`, `SONEIUM_TESTNET_PROVIDER_URL`, `SONEIUM_MAINNET_PROVIDER_URL`, `ETH_SEPOLIA_TESTNET_PROVIDER_URL`, `BASE_SEPOLIA_TESTNET_PROVIDER_URL`, `PRIVATE_KEY`, and `OWNER_KEY`.

Note the two distinct signing paths: `hardhat.config.ts` wires each network's `accounts` to `PRIVATE_KEY`, but `scripts/deploy.ts` ignores that and constructs its own provider + wallet from `OWNER_KEY`. The interaction scripts (`getStats`, `getTournamentCnt`, `finalizeTournament`) use the hardhat-configured signer (`PRIVATE_KEY`). So deployment and post-deploy interaction can run as different accounts by design.

## Contract architecture (`contracts/TournamentFinalizer.sol`)

The single entry point is `finalizeTournament(uint16 _tournamentId, bytes calldata _tournamentData)`. Anyone can call it — it is `external` and *not* owner-gated, despite the contract extending OpenZeppelin `Ownable` (ownership is currently unused beyond being set to the deployer).

Key domain encoding to keep in mind whenever touching this contract, its tests, or its scripts:

- **`_tournamentData` is a tightly packed array of `uint16` item IDs in big-endian** ([MSB][LSB] per 2-byte item). There is no length prefix; participant count is `data.length / 2`.
- **Length constraints:** `data.length` must be a power of two and within `[4, 2048]` bytes — i.e. 2 to 1024 participants. This is enforced by `len >= 4 && len <= 2048 && (len & (len - 1)) == 0`.
- **Winner / runner-up derivation:** the *winner* (`firstCnt`) is the item at byte offset `0`; the *runner-up* (`secondCnt`) is the item at byte offset `len / 2`. These are positional, not computed from any ranking logic.
- **Uniqueness:** every item ID must be unique across the array. This is checked with a `uint256[256]` bitset (`seen`) that maps the full `uint16` space (high byte → word index, low byte → bit index); a repeat reverts with `InvalidItem(value)`.

State:
- `tournamentCnt[tournamentId]` — incremented once per successful finalize.
- `stats[tournamentId][itemId]` — `ItemStat { firstCnt, secondCnt }`.

Event: `TournamentFinalized(address indexed user, bytes32 indexed tournamentDataHash, uint16 tournamentId, bytes tournamentData)`, where `tournamentDataHash = keccak256(_tournamentData)`.

**Naming caveat:** the contract's mapping key is `_tournamentId`, but tests and `getStats.ts` refer to the same value as `themeId`. They are the same key — treat "theme" and "tournament ID" as synonyms when reading across files.

## Scripts ↔ deployment-info.json

`scripts/deploy.ts` writes the deployed address to `scripts/output/deployment-info.json` (under `contracts.tournamentFinalizer`). The three interaction scripts read the address back from that file and will throw if it is missing — so deploy first, then interact. This JSON is committed to the repo, so it reflects the last recorded deployment. The interaction scripts hardcode their inputs (e.g. `TOURNAMENT_ID`, `ITEM_ID`, participant generation params) as top-of-file constants meant to be edited before running.

# PNYX-Contract

## Overview

PNYX-Contract is a Solidity smart contract project built with Hardhat for finalizing tournaments via EIP-712 signatures. The contract verifies a signature issued by the PNYX backend and emits an event for off-chain indexing; it stores no tournament results on-chain.

The main contract, `TournamentFinalizer`, lets a user finalize a tournament by submitting the backend-issued EIP-712 signature along with the tournament data. The contract verifies the signature, consumes a per-user nonce (replay protection), and emits a `TournamentFinalized` event.

## Contract List

### TournamentFinalizer

The main smart contract that verifies EIP-712 finalize signatures and emits events.

**Key Features:**
- Verifies a backend-issued EIP-712 signature over the caller and tournament data
- Per-user nonce for replay protection (`nonces(address)`)
- Deadline-based signature expiry
- Owner-updatable authorized signer and EIP-712 typehash
- Emits `TournamentFinalized` for off-chain indexing

**Main Functions:**
- `finalizeTournament(uint16 _tournamentId, bytes calldata _tournamentData, uint256 _point, uint256 _deadline, bytes calldata _signature)`: Verifies the EIP-712 signature and emits `TournamentFinalized`
- `setFinalizeSigner(address)` / `setFinalizeTypeHash(string)`: owner-only configuration

## Project Structure

```
PNYX-Contract/
├── contracts/              # Smart contract source files
│   └── TournamentFinalizer.sol
├── scripts/                # Deployment and utility scripts
│   ├── deploy.ts          # Main deployment script
│   ├── output/            # Deployment information output
│   │   └── deployment-info.json
│   └── tournamentFinalizer/
│       ├── finalizeTournament.ts
│       └── getNonce.ts
├── test/                   # Test files
│   └── TournamentFinalizer.test.ts
├── hardhat.config.ts       # Hardhat configuration
├── package.json            # Project dependencies
└── tsconfig.json          # TypeScript configuration
```

## Deployment

1. Install dependencies:
```bash
npm install
```

2. Compile contracts:
```bash
npx hardhat compile
```

3. Run tests:
```bash
npx hardhat test
```

4. Deploy to a network:
```bash
npx hardhat run scripts/deploy.ts --network <network-name>
```

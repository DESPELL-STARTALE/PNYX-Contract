# PNYX-Contract

## Overview

PNYX-Contract is a Solidity smart contract project built with Hardhat for managing tournament finalization and statistics. The project provides a decentralized solution for tracking tournament results, including winner and runner-up statistics for different tournament themes and items.

The main contract, `TournamentFinalizer`, allows users to finalize tournaments by submitting tournament data, which is then processed to update statistics and emit events for off-chain tracking.

## Contract List

### TournamentFinalizer

The main smart contract that handles tournament finalization and statistics tracking.

**Key Features:**
- Finalizes tournaments with participant data
- Tracks tournament counts per theme
- Maintains statistics for items (first place and second place counts)
- Emits events for tournament finalization
- Validates tournament data (length, uniqueness of participants)

**Main Functions:**
- `finalizeTournament(uint16 _tournamentId, bytes calldata _tournamentData)`: Finalizes a tournament and updates statistics

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
│       ├── getStats.ts
│       └── getTournamentCnt.ts
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

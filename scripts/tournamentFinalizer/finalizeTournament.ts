import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

// ============================================================
// ✏️ Input constants to edit before use
// ============================================================

// tournamentId passed to finalizeTournament
const TOURNAMENT_ID: number = 1;

// participant count (a power of two, between 2 and 1024)
// participant count * 2 = byte length (4 ~ 2048 bytes, a power of two)
const PARTICIPANT_COUNT = 64; // default: 64 participants (128 bytes)

// participant ID range (uint16)
const PARTICIPANT_MIN_ID = 0;
const PARTICIPANT_MAX_ID = 69;

// ============================================================
// internal utility functions
// ============================================================

// convert a uint16 array to Big-endian bytes (hex string)
function encodeUint16ArrayBE(values: number[]): string {
    const byteLength = values.length * 2;

    let hex = "0x";
    for (const v of values) {
        hex += v.toString(16).padStart(4, "0");
    }
    return hex;
}

// briefly check that the participant array is unique (Solidity also checks again)
function ensureUnique(values: number[]) {
    const set = new Set(values);
    if (set.size !== values.length) {
        throw new Error("The PARTICIPANTS array contains duplicate values. finalizeTournament may revert with InvalidItem.");
    }
}

// read the TournamentFinalizer address from deployment-info.json
function loadTournamentFinalizerAddressFromDeploymentInfo(): string {
    const deploymentInfoPath = path.join(
        __dirname,
        "..",
        "output",
        "deployment-info.json"
    );

    if (!fs.existsSync(deploymentInfoPath)) {
        throw new Error(
            `❌ Could not find the deployment-info.json file: ${deploymentInfoPath}\n` +
            `   Run scripts/deploy.ts first to deploy the contract and verify the output file was created.`
        );
    }

    const raw = fs.readFileSync(deploymentInfoPath, "utf8");
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`❌ Failed to parse deployment-info.json: ${(e as Error).message}`);
    }

    const address = parsed?.contracts?.tournamentFinalizer;
    if (!address || typeof address !== "string") {
        throw new Error(
            "❌ Could not find the TournamentFinalizer address in deployment-info.json.\n" +
            "   Check that the file has contracts.tournamentFinalizer."
        );
    }

    console.log("📄 Network info from deployment-info.json:", parsed.network);
    return address;
}

// pick unique numbers at random from the 0~65535 range, order-independent
// (internal util: always returns a unique array)
function generateRandomParticipantsUnique(
    count: number,
    minId: number,
    maxId: number
): number[] {
    const range = maxId - minId + 1;
    if (range < count) {
        throw new Error("count is larger than the available ID range. Cannot generate a unique array.");
    }

    const chosen = new Set<number>();
    while (chosen.size < count) {
        const v = Math.floor(Math.random() * range) + minId;
        chosen.add(v);
    }
    return Array.from(chosen);
}

// pick participants without duplicates
// - PARTICIPANT_COUNT of them
// - from the PARTICIPANT_MIN_ID ~ PARTICIPANT_MAX_ID range
// - randomly and uniquely
export function pickParticipantsUnique(): number[] {
    const participants = generateRandomParticipantsUnique(
        PARTICIPANT_COUNT,
        PARTICIPANT_MIN_ID,
        PARTICIPANT_MAX_ID
    );
    // defensive check (always true in theory)
    ensureUnique(participants);
    return participants;
}

// pick participants with duplicates
// - picks uniquely by default,
// - then overwrites one of two randomly chosen indexes with the other's value
//   so there is at least one duplicate
// - use when you want to trigger the InvalidItem error on finalizeTournament
export function pickParticipantsWithDuplicate(): number[] {
    const participants = generateRandomParticipantsUnique(
        PARTICIPANT_COUNT,
        PARTICIPANT_MIN_ID,
        PARTICIPANT_MAX_ID
    );

    const i = Math.floor(Math.random() * participants.length);
    let j = Math.floor(Math.random() * participants.length);
    if (i === j) {
        j = (j + 1) % participants.length;
    }

    // overwrite value at j with value at i to create a duplicate
    participants[j] = participants[i];

    // this array intentionally contains a duplicate, so ensureUnique is not called.
    return participants;
}

// ============================================================
// main execution logic
// ============================================================

async function main() {
    console.log("🚀 Starting the TournamentFinalizer.finalizeTournament execution script.");

    const networkName = network.name;
    console.log("🌐 Network:", networkName);

    // read the address from scripts/output/deployment-info.json
    const contractAddress = loadTournamentFinalizerAddressFromDeploymentInfo();
    if (!contractAddress) {
        throw new Error("❌ Could not find the TournamentFinalizer address.");
    }

    // signer using the accounts setting in hardhat.config.ts (e.g. PRIVATE_KEY)
    const [signer] = await ethers.getSigners();
    console.log("👤 Sending transaction from:", signer.address);
    console.log("🏛 TournamentFinalizer address:", contractAddress);

    // generate participants (random, unique) and encode to bytes
    // - use participants without duplicates: pickParticipantsUnique()
    // - to see an InvalidItem revert with duplicate participants,
    //   change the line below to pickParticipantsWithDuplicate().
    const participants = pickParticipantsUnique();
    // const participants = pickParticipantsWithDuplicate();

    // console.log("participants:", ethers.dataLength(encodeUint16ArrayBE(participants)));
    const tournamentData = encodeUint16ArrayBE(participants);

    // the contract computes the winner and runner-up as follows:
    // - winner (first): uint16 value read at offset 0
    // - runner-up (second): uint16 value read at offset len/2
    const winner = participants[0]; // first item (offset 0)
    const runnerUp = participants[participants.length / 2]; // middle item (offset len/2)

    console.log("🎯 tournamentId:", TOURNAMENT_ID);
    console.log("👥 Participant count:", participants.length, `(${ethers.dataLength(tournamentData)} bytes)`);
    console.log("👑 Participants:", participants);
    console.log("👑 Winner (first) candidate ID:", winner, `(index ${0})`);
    console.log("🥈 Runner-up (second) candidate ID:", runnerUp, `(index ${participants.length / 2})`);

    // create the contract instance
    const contract = await ethers.getContractAt(
        "TournamentFinalizer",
        contractAddress,
        signer
    );

    console.log("📝 Sending the finalizeTournament transaction...");
    // contract function signature: finalizeTournament(uint16 _tournamentId, bytes calldata _tournamentData)
    // - _tournamentId: theme ID (TOURNAMENT_ID)
    // - _tournamentData: a Big-endian encoded uint16 array (4 ~ 2048 bytes, a power of two)
    const tx = await contract.finalizeTournament(TOURNAMENT_ID, tournamentData);
    console.log("⏳ Transaction sent. hash:", tx.hash);

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log("  - blockNumber:", receipt?.blockNumber);
    console.log("  - gasUsed:", receipt?.gasUsed.toString());

    // parse and print the emitted events
    if (receipt && receipt.logs && receipt.logs.length > 0) {
        console.log("\n📢 Events emitted by the transaction:");
        for (const log of receipt.logs) {
            // only try to parse logs emitted by this contract
            if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
                continue;
            }
            try {
                const parsed = contract.interface.parseLog(log);
                console.log(`\n  ▶ Event name: ${parsed?.name}`);
                console.log("    - args:", parsed?.args);

                if (parsed?.name === "TournamentFinalized") {
                    // event param order: (address indexed user, bytes32 indexed tournamentDataHash, uint16 tournamentId, bytes tournamentData)
                    // user and tournamentDataHash are indexed, so they can also be read from the log topics array
                    const user = parsed?.args[0];
                    const tournamentDataHash = parsed?.args[1];
                    const tournamentId = parsed?.args[2];
                    const tournamentDataBytes = parsed?.args[3];
                    console.log("    - user:", user);
                    console.log("    - tournamentDataHash (indexed):", tournamentDataHash);
                    console.log("    - tournamentId:", tournamentId.toString());
                    console.log(
                        "    - tournamentData (bytes length):",
                        ethers.dataLength(tournamentDataBytes)
                    );
                }
            } catch {
                // ignore logs that do not match this contract's event format
            }
        }
    } else {
        console.log("\nℹ️ This transaction has no decodable event logs.");
    }
}

main()
    .then(() => {
        console.log("\n🎯 finalizeTournament script finished");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ finalizeTournament script failed:", error);
        process.exit(1);
    });

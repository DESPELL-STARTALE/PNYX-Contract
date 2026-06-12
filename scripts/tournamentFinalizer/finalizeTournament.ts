import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// ============================================================
// ✏️ Input constants to edit before use
// ============================================================

// tournamentId passed to finalizeTournament
const TOURNAMENT_ID: number = 1;

// participant count (a power of two between 2 and 1024 is the canonical bracket,
// but the contract no longer enforces it — any even-length data is accepted)
const PARTICIPANT_COUNT = 64; // default: 64 participants (128 bytes)

// participant ID range (uint16)
const PARTICIPANT_MIN_ID = 0;
const PARTICIPANT_MAX_ID = 69;

// point bound to the signature by the backend (here we just pick one for the demo)
const POINT: number = 2;

// signature lifetime in seconds (deadline = now + this)
const DEADLINE_SECONDS = 30 * 60; // 30 minutes

// ============================================================
// EIP-712 domain / types (MUST match PNYX-BE + the deployed contract)
// ============================================================

const EIP712_NAME = "TournamentFinalizer";
const EIP712_VERSION = "1";

const FINALIZE_TOURNAMENT_TYPES = {
    FinalizeTournament: [
        { name: "user", type: "address" },
        { name: "tournamentId", type: "uint256" },
        { name: "tournamentData", type: "bytes" },
        { name: "point", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
    ],
};

// ============================================================
// internal utility functions
// ============================================================

// convert a uint16 array to Big-endian bytes (hex string)
function encodeUint16ArrayBE(values: number[]): string {
    let hex = "0x";
    for (const v of values) {
        if (v < 0 || v > 0xffff) {
            throw new Error("Value is out of uint16 range");
        }
        hex += v.toString(16).padStart(4, "0");
    }
    return hex;
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

// pick unique numbers at random from the [minId, maxId] range
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
export function pickParticipantsUnique(): number[] {
    return generateRandomParticipantsUnique(
        PARTICIPANT_COUNT,
        PARTICIPANT_MIN_ID,
        PARTICIPANT_MAX_ID
    );
}

// ============================================================
// main execution logic
// ============================================================

async function main() {
    console.log("🚀 Starting the TournamentFinalizer.finalizeTournament execution script.");

    console.log("🌐 Network:", network.name);

    // read the address from scripts/output/deployment-info.json
    const contractAddress = loadTournamentFinalizerAddressFromDeploymentInfo();

    // caller: uses the accounts setting in hardhat.config.ts (e.g. PRIVATE_KEY).
    // This is the `user` the signature is bound to (msg.sender).
    const [caller] = await ethers.getSigners();

    // finalize signer: the authorized EIP-712 signer key. In production this signature
    // comes from PNYX-BE; here we reproduce that flow locally to exercise the contract.
    const finalizeSignerKey = process.env.FINALIZE_SIGNER_KEY;
    if (!finalizeSignerKey) {
        throw new Error(
            "❌ You must set FINALIZE_SIGNER_KEY in the .env file.\n" +
            "   It is the private key whose public address was passed as the contract's finalizeSigner."
        );
    }
    const finalizeSignerWallet = new ethers.Wallet(finalizeSignerKey);

    console.log("👤 Caller (signed user):", caller.address);
    console.log("✍️  Finalize signer:", finalizeSignerWallet.address);
    console.log("🏛 TournamentFinalizer address:", contractAddress);

    // build tournament data
    const participants = pickParticipantsUnique();
    const tournamentData = encodeUint16ArrayBE(participants);

    // create the contract instance
    const contract = await ethers.getContractAt(
        "TournamentFinalizer",
        contractAddress,
        caller
    );

    // fetch the caller's current on-chain nonce (replay protection)
    const nonce: bigint = await contract.nonces(caller.address);

    // deadline = now + DEADLINE_SECONDS
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    const { chainId } = await ethers.provider.getNetwork();

    console.log("🎯 tournamentId:", TOURNAMENT_ID);
    console.log("👥 Participant count:", participants.length, `(${ethers.dataLength(tournamentData)} bytes)`);
    console.log("🏅 point:", POINT);
    console.log("🔢 nonce:", nonce.toString());
    console.log("⏰ deadline:", deadline.toString());
    console.log("⛓  chainId:", chainId.toString());

    // build and sign the EIP-712 payload
    const domain = {
        name: EIP712_NAME,
        version: EIP712_VERSION,
        chainId,
        verifyingContract: contractAddress,
    };
    const value = {
        user: caller.address,
        tournamentId: BigInt(TOURNAMENT_ID),
        tournamentData,
        point: BigInt(POINT),
        nonce,
        deadline,
    };

    const signature = await finalizeSignerWallet.signTypedData(
        domain,
        FINALIZE_TOURNAMENT_TYPES,
        value
    );
    console.log("🖊  signature:", signature);

    console.log("📝 Sending the finalizeTournament transaction...");
    // finalizeTournament(uint16 _tournamentId, bytes _tournamentData, uint256 _point, uint256 _deadline, bytes _signature)
    const tx = await contract.finalizeTournament(
        TOURNAMENT_ID,
        tournamentData,
        POINT,
        deadline,
        signature
    );
    console.log("⏳ Transaction sent. hash:", tx.hash);

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed!");
    console.log("  - blockNumber:", receipt?.blockNumber);
    console.log("  - gasUsed:", receipt?.gasUsed.toString());

    // parse and print the emitted events
    if (receipt && receipt.logs && receipt.logs.length > 0) {
        console.log("\n📢 Events emitted by the transaction:");
        for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
                continue;
            }
            try {
                const parsed = contract.interface.parseLog(log);
                console.log(`\n  ▶ Event name: ${parsed?.name}`);
                console.log("    - args:", parsed?.args);

                if (parsed?.name === "TournamentFinalized") {
                    // (address indexed user, bytes32 indexed tournamentDataHash, uint16 tournamentId, bytes tournamentData)
                    console.log("    - user:", parsed?.args[0]);
                    console.log("    - tournamentDataHash (indexed):", parsed?.args[1]);
                    console.log("    - tournamentId:", parsed?.args[2].toString());
                    console.log(
                        "    - tournamentData (bytes length):",
                        ethers.dataLength(parsed?.args[3])
                    );
                }
            } catch {
                // ignore logs that do not match this contract's event format
            }
        }
    } else {
        console.log("\nℹ️ This transaction has no decodable event logs.");
    }

    // post-call sanity: nonce should have incremented by 1
    const nonceAfter: bigint = await contract.nonces(caller.address);
    console.log("\n🔢 nonce after:", nonceAfter.toString(), `(was ${nonce.toString()})`);
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

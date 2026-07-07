import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// ============================================================
// ✏️ Input constants to edit before use
// ============================================================

// tournamentId passed to settle
const TOURNAMENT_ID: number = 1;

// itemId passed to settle
const ITEM_ID: number = 7;

// amount: bet/cancel amount, or reward payout (disambiguated by OPTION)
const AMOUNT: number = 100;

// signed intent: "bet" | "cancel" | "reward"
const OPTION: string = "bet";

// signature lifetime in seconds (deadline = now + this)
const DEADLINE_SECONDS = 30 * 60; // 30 minutes

// ============================================================
// EIP-712 domain / types (MUST match PNYX-BE + the deployed contract)
// ============================================================

const EIP712_NAME = "VotePointManager";
const EIP712_VERSION = "1";

const VOTE_TYPES = {
    Vote: [
        { name: "user", type: "address" },
        { name: "tournamentId", type: "uint256" },
        { name: "itemId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "option", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
    ],
};

// ============================================================
// internal utility functions
// ============================================================

// read the VotePointManager address from deployment-info.json
function loadVotePointManagerAddressFromDeploymentInfo(): string {
    const deploymentInfoPath = path.join(
        __dirname,
        "..",
        "output",
        "deployment-info.json"
    );

    if (!fs.existsSync(deploymentInfoPath)) {
        throw new Error(
            `❌ Could not find the deployment-info.json file: ${deploymentInfoPath}\n` +
            `   Run scripts/deployVotePointManager.ts first to deploy the contract and verify the output file was created.`
        );
    }

    const raw = fs.readFileSync(deploymentInfoPath, "utf8");
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`❌ Failed to parse deployment-info.json: ${(e as Error).message}`);
    }

    const address = parsed?.contracts?.votePointManager;
    if (!address || typeof address !== "string") {
        throw new Error(
            "❌ Could not find the VotePointManager address in deployment-info.json.\n" +
            "   Check that the file has contracts.votePointManager."
        );
    }

    console.log("📄 Network info from deployment-info.json:", parsed.network);
    return address;
}

// ============================================================
// main execution logic
// ============================================================

async function main() {
    console.log("🚀 Starting the VotePointManager.settle execution script.");

    console.log("🌐 Network:", network.name);

    // read the address from scripts/output/deployment-info.json
    const contractAddress = loadVotePointManagerAddressFromDeploymentInfo();

    // caller: uses the accounts setting in hardhat.config.ts (e.g. PRIVATE_KEY).
    // This is the `user` the signature is bound to (msg.sender).
    const [caller] = await ethers.getSigners();

    // vote signer: the authorized EIP-712 signer key. In production this signature
    // comes from PNYX-BE; here we reproduce that flow locally to exercise the contract.
    const voteSignerKey = process.env.VOTE_SIGNER_KEY;
    if (!voteSignerKey) {
        throw new Error(
            "❌ You must set VOTE_SIGNER_KEY in the .env file.\n" +
            "   It is the private key whose public address was passed as the contract's voteSigner."
        );
    }
    const voteSignerWallet = new ethers.Wallet(voteSignerKey);

    console.log("👤 Caller (signed user):", caller.address);
    console.log("✍️  Vote signer:", voteSignerWallet.address);
    console.log("🏛 VotePointManager address:", contractAddress);

    // create the contract instance
    const contract = await ethers.getContractAt(
        "VotePointManager",
        contractAddress,
        caller
    );

    // fetch the caller's current on-chain nonce (replay protection)
    const nonce: bigint = await contract.nonces(caller.address);

    // deadline = now + DEADLINE_SECONDS
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    const { chainId } = await ethers.provider.getNetwork();

    console.log("🎯 tournamentId:", TOURNAMENT_ID);
    console.log("🎲 itemId:", ITEM_ID);
    console.log("💰 amount:", AMOUNT);
    console.log("🏷  option:", OPTION);
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
        itemId: BigInt(ITEM_ID),
        amount: BigInt(AMOUNT),
        option: OPTION,
        nonce,
        deadline,
    };

    const signature = await voteSignerWallet.signTypedData(
        domain,
        VOTE_TYPES,
        value
    );
    console.log("🖊  signature:", signature);

    console.log("📝 Sending the settle transaction...");
    // settle(uint256 _tournamentId, uint256 _itemId, uint256 _amount, string _option, uint256 _deadline, bytes _signature)
    const tx = await contract.settle(
        TOURNAMENT_ID,
        ITEM_ID,
        AMOUNT,
        OPTION,
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

                if (parsed?.name === "Settled") {
                    // (uint256 indexed timestamp, address indexed user, uint256 indexed tournamentId,
                    //  uint256 itemId, uint256 amount, string option)
                    console.log("    - timestamp (indexed):", parsed?.args[0].toString());
                    console.log("    - user (indexed):", parsed?.args[1]);
                    console.log("    - tournamentId (indexed):", parsed?.args[2].toString());
                    console.log("    - itemId:", parsed?.args[3].toString());
                    console.log("    - amount:", parsed?.args[4].toString());
                    console.log("    - option:", parsed?.args[5]);
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
        console.log("\n🎯 settle script finished");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ settle script failed:", error);
        process.exit(1);
    });

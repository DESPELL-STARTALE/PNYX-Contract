import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

// ============================================================
// ✏️ address to query (edit here or replace with CLI args)
// ============================================================
// the contract's nonces mapping uses an address as the key.
// leave empty to query the first hardhat signer's address.
const TARGET_ADDRESS: string = "";

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
    console.log("🚀 Starting the VotePointManager.nonces query script.");

    console.log("🌐 Network:", network.name);

    // read the address from scripts/output/deployment-info.json
    const contractAddress = loadVotePointManagerAddressFromDeploymentInfo();

    // read-only, but grab a signer to connect (a provider alone would also work)
    const [signer] = await ethers.getSigners();
    const targetAddress = TARGET_ADDRESS || signer.address;
    console.log("👤 Querying with address:", signer.address);
    console.log("🏛 VotePointManager address:", contractAddress);

    const contract = await ethers.getContractAt(
        "VotePointManager",
        contractAddress,
        signer
    );

    // contract public mapping: mapping(address => uint256) public nonces;
    console.log("🔎 Querying nonces... address =", targetAddress);
    const nonce: bigint = await contract.nonces(targetAddress);

    console.log("✅ Query complete");
    console.log("  - address:", targetAddress);
    console.log("  - nonce (string):", nonce.toString());
}

main()
    .then(() => {
        console.log("\n🎯 getNonce script finished");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ getNonce script failed:", error);
        process.exit(1);
    });

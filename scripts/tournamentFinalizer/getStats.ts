import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

// ============================================================
// ✏️ themeId, itemId to query (edit here or replace with CLI args)
// ============================================================
const THEME_ID: number = 1;
const ITEM_ID: number = 26605;

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

// ============================================================
// main execution logic
// ============================================================

async function main() {
    console.log("🚀 Starting the TournamentFinalizer.stats query script.");

    const networkName = network.name;
    console.log("🌐 Network:", networkName);

    // read the address from scripts/output/deployment-info.json
    const contractAddress = loadTournamentFinalizerAddressFromDeploymentInfo();
    if (!contractAddress) {
        throw new Error("❌ Could not find the TournamentFinalizer address.");
    }

    // read-only, but grab a signer to connect (a provider alone would also work)
    const [signer] = await ethers.getSigners();
    console.log("👤 Querying with address:", signer.address);
    console.log("🏛 TournamentFinalizer address:", contractAddress);

    const contract = await ethers.getContractAt(
        "TournamentFinalizer",
        contractAddress,
        signer
    );

    console.log("🔎 Querying stats... themeId =", THEME_ID, ", itemId =", ITEM_ID);
    const stat = await contract.stats(THEME_ID, ITEM_ID);

    console.log("✅ Query complete");
    console.log("  - themeId:", THEME_ID);
    console.log("  - itemId:", ITEM_ID);
    console.log("  - firstCnt (raw BigNumber):", stat.firstCnt);
    console.log("  - secondCnt (raw BigNumber):", stat.secondCnt);
    console.log("  - firstCnt (string):", stat.firstCnt.toString());
    console.log("  - secondCnt (string):", stat.secondCnt.toString());
}

main()
    .then(() => {
        console.log("\n🎯 getStats script finished");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ getStats script failed:", error);
        process.exit(1);
    });

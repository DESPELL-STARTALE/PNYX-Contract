import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

// ============================================================
// ✏️ tournamentId to query (edit here or replace with CLI args)
// ============================================================
// the contract's tournamentCnt mapping uses uint16 _tournamentId as the key
const TOURNAMENT_ID: number = 1;

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
    console.log("🚀 Starting the TournamentFinalizer.tournamentCnt query script.");

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

    // contract public mapping: mapping(uint16 => uint256) public tournamentCnt;
    console.log("🔎 Querying tournamentCnt... tournamentId =", TOURNAMENT_ID);
    const tournamentCntBn = await contract.tournamentCnt(TOURNAMENT_ID);

    console.log("✅ Query complete");
    console.log("  - tournamentId:", TOURNAMENT_ID);
    console.log("  - tournamentCnt (raw BigNumber):", tournamentCntBn);
    console.log("  - tournamentCnt (string):", tournamentCntBn.toString());
}

main()
    .then(() => {
        console.log("\n🎯 getTournamentCnt script finished");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ getTournamentCnt script failed:", error);
        process.exit(1);
    });

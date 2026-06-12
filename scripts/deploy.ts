import { ethers, network } from "hardhat";
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// wait helper
async function waitIfNeeded() {
    console.log("⏳ Waiting 1 second before the next tx...");
    await sleep(1000);
}

async function main() {
    console.log("🚀 Starting TournamentFinalizer contract deployment... (using OWNER_KEY)");

    // check the OWNER_KEY environment variable
    const ownerKey = process.env.OWNER_KEY;
    if (!ownerKey) {
        throw new Error("❌ You must set OWNER_KEY in the .env file.");
    }

    const rpcUrl = (network.config as any).url;

    if (!rpcUrl) {
        throw new Error(
            `❌ Could not find the RPC URL for the current network (${network.name}). Check hardhat.config.ts or .env.`
        );
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const ownerWallet = new ethers.Wallet(ownerKey, provider);

    console.log("🌐 Network:", network.name);
    console.log("🔗 RPC URL:", rpcUrl);
    console.log("📋 Deployment settings:");
    console.log("  - Owner Address:", ownerWallet.address);

    // track deployment cost
    let totalGasCost = 0n;
    const deploymentDetails: any[] = [];

    try {
        // deploy the TournamentFinalizer contract
        let tournamentFinalizerAddr;
        console.log("\n2️⃣ Deploying the TournamentFinalizer contract...");
        const TournamentFinalizer = await ethers.getContractFactory("TournamentFinalizer");
        const tournamentFinalizer = await TournamentFinalizer.connect(ownerWallet).deploy();
        const tournamentFinalizerDeployTx = tournamentFinalizer.deploymentTransaction();
        await tournamentFinalizer.waitForDeployment();
        tournamentFinalizerAddr = await tournamentFinalizer.getAddress();

        if (tournamentFinalizerDeployTx) {
            const receipt = await tournamentFinalizerDeployTx.wait();
            if (receipt) {
                const gasCost = receipt.gasUsed * receipt.gasPrice;
                totalGasCost += gasCost;
                deploymentDetails.push({
                    contract: "TournamentFinalizer",
                    address: tournamentFinalizerAddr,
                    txHash: receipt.hash,
                    gasUsed: receipt.gasUsed.toString(),
                    gasPrice: ethers.formatUnits(receipt.gasPrice, "gwei"),
                    cost: ethers.formatEther(gasCost)
                });
                console.log("✅ TournamentFinalizer contract deployed:", tournamentFinalizerAddr);
                console.log("  📝 Transaction hash:", receipt.hash);
                console.log("  ⛽ Gas used:", receipt.gasUsed.toString());
                console.log("  💰 Deployment cost:", ethers.formatEther(gasCost), "ETH");
            }
        }
        await waitIfNeeded();

        // print deployment results
        console.log("\n🎉 All contracts have been deployed!");
        console.log("\n📋 Deployed contract addresses:");
        console.log("  - TournamentFinalizer:", tournamentFinalizerAddr);

        // total cost summary
        console.log("\n💰 Deployment cost summary:");
        console.log("  ┌─────────────────────────────────────────────────────");
        console.log(`  │ Total gas cost: ${ethers.formatEther(totalGasCost)} ETH`);
        console.log("  └─────────────────────────────────────────────────────");

        console.log("\n📊 Deployment details:");
        deploymentDetails.forEach((detail, index) => {
            console.log(`  ${index + 1}. ${detail.contract} contract`);
            console.log(`     - Address: ${detail.address}`);
            console.log(`     - Transaction hash: ${detail.txHash}`);
            console.log(`     - Gas used: ${detail.gasUsed}`);
            console.log(`     - Gas price: ${detail.gasPrice} Gwei`);
            console.log(`     - Deployment cost: ${detail.cost} ETH`);
        });

        const deploymentInfo = {
            network: await provider.getNetwork(),
            deployer: ownerWallet.address, // address that deployed with OWNER_KEY
            contracts: {
                tournamentFinalizer: tournamentFinalizerAddr,
            },
            deploymentTime: new Date().toISOString(),
            deploymentBlock: await provider.getBlockNumber()
        };

        console.log("\n💾 Saving deployment info to scripts/output/deployment-info.json...");
        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(
            path.join(outputDir, 'deployment-info.json'),
            JSON.stringify(deploymentInfo, null, 2)
        );

        console.log("✅ Deployment info saved");
    } catch (error) {
        console.error("❌ An error occurred during deployment:", error);
        process.exit(1);
    }
}

main()
    .then(() => {
        console.log("\n🎯 Deployment script finished (using OWNER_KEY)");
        process.exit(0)
    })
    .catch((error) => {
        console.error("❌ Deployment script failed:", error);
        process.exit(1);
    });

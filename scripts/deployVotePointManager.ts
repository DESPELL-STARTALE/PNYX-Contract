import { ethers, network } from "hardhat";
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// read a required env var (throws if missing/blank) — pikit-contract pattern
function requireEnv(key: string): string {
    const v = process.env[key];
    if (!v || !v.trim()) {
        throw new Error(`❌ You must set ${key} in the .env file.`);
    }
    return v.trim();
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// wait helper
async function waitIfNeeded() {
    console.log("⏳ Waiting 1 second before the next tx...");
    await sleep(1000);
}

async function main() {
    console.log("🚀 Starting VotePointManager contract deployment... (using OWNER_KEY)");

    // check the OWNER_KEY environment variable
    const ownerKey = requireEnv("OWNER_KEY");

    // authorized EIP-712 signer address (the PUBLIC address of PNYX-BE's
    // SONEIUM_*_VOTE_POINT_MANAGER_PRIVATE_KEY). Baked into the contract.
    const voteSigner = requireEnv("VOTE_SIGNER");
    if (!ethers.isAddress(voteSigner)) {
        throw new Error(`❌ VOTE_SIGNER is not a valid address: ${voteSigner}`);
    }
    if (voteSigner === ethers.ZeroAddress) {
        throw new Error("❌ VOTE_SIGNER cannot be the zero address.");
    }

    // EIP-712 type string for the Vote struct (keccak256'd in the constructor).
    // MUST match PNYX-BE's EIP712_VOTE_TYPES exactly (field order + types).
    const voteTypeString = requireEnv("VOTE_TYPEHASH");

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
    console.log("  - Vote Signer:", voteSigner);
    console.log("  - EIP-712 Type String:", voteTypeString);

    // track deployment cost
    let totalGasCost = 0n;
    const deploymentDetails: any[] = [];

    try {
        // deploy the VotePointManager contract
        let votePointManagerAddr;
        console.log("\n2️⃣ Deploying the VotePointManager contract...");
        const VotePointManager = await ethers.getContractFactory("VotePointManager");
        const votePointManager = await VotePointManager.connect(ownerWallet).deploy(
            voteSigner,
            voteTypeString
        );
        const votePointManagerDeployTx = votePointManager.deploymentTransaction();
        await votePointManager.waitForDeployment();
        votePointManagerAddr = await votePointManager.getAddress();

        if (votePointManagerDeployTx) {
            const receipt = await votePointManagerDeployTx.wait();
            if (receipt) {
                const gasCost = receipt.gasUsed * receipt.gasPrice;
                totalGasCost += gasCost;
                deploymentDetails.push({
                    contract: "VotePointManager",
                    address: votePointManagerAddr,
                    txHash: receipt.hash,
                    gasUsed: receipt.gasUsed.toString(),
                    gasPrice: ethers.formatUnits(receipt.gasPrice, "gwei"),
                    cost: ethers.formatEther(gasCost)
                });
                console.log("✅ VotePointManager contract deployed:", votePointManagerAddr);
                console.log("  📝 Transaction hash:", receipt.hash);
                console.log("  ⛽ Gas used:", receipt.gasUsed.toString());
                console.log("  💰 Deployment cost:", ethers.formatEther(gasCost), "ETH");
            }
        }
        await waitIfNeeded();

        // print deployment results
        console.log("\n🎉 All contracts have been deployed!");
        console.log("\n📋 Deployed contract addresses:");
        console.log("  - VotePointManager:", votePointManagerAddr);

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

        // read-merge-write: preserve any existing deployment-info.json entries
        // (e.g. contracts.tournamentFinalizer) instead of clobbering the file.
        const outputDir = path.join(__dirname, 'output');
        const outputPath = path.join(outputDir, 'deployment-info.json');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        let existing: any = {};
        if (fs.existsSync(outputPath)) {
            try {
                existing = JSON.parse(fs.readFileSync(outputPath, "utf8"));
            } catch (e) {
                console.warn(
                    `⚠️  Existing deployment-info.json could not be parsed, it will be overwritten: ${(e as Error).message}`
                );
                existing = {};
            }
        }

        const deploymentInfo = {
            ...existing,
            network: await provider.getNetwork(),
            deployer: ownerWallet.address, // address that deployed with OWNER_KEY
            voteSigner: voteSigner, // authorized EIP-712 signer baked into the contract
            contracts: {
                ...(existing.contracts ?? {}),
                votePointManager: votePointManagerAddr,
            },
            deploymentTime: new Date().toISOString(),
            deploymentBlock: await provider.getBlockNumber()
        };

        console.log("\n💾 Saving deployment info to scripts/output/deployment-info.json...");
        fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));

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

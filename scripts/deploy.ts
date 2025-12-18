import { ethers, network } from "hardhat";
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 대기 함수
async function waitIfNeeded() {
    console.log("⏳ 다음 tx를 위해 1초 대기...");
    await sleep(1000);
}

async function main() {
    console.log("🚀 TournamentFinalizer 컨트랙트 배포를 시작합니다... (OWNER_KEY 사용)");

    // OWNER_KEY 환경변수 확인
    const ownerKey = process.env.OWNER_KEY;
    if (!ownerKey) {
        throw new Error("❌ .env 파일에 OWNER_KEY를 설정해야 합니다.");
    }
    
    const rpcUrl = (network.config as any).url;

    if (!rpcUrl) {
        throw new Error(
            `❌ 현재 네트워크(${network.name})의 RPC URL을 찾을 수 없습니다. hardhat.config.ts 또는 .env를 확인하세요.`
        );
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const ownerWallet = new ethers.Wallet(ownerKey, provider);

    console.log("🌐 실행 네트워크:", network.name);
    console.log("🔗 RPC URL:", rpcUrl);
    console.log("📋 배포 설정:");
    console.log("  - Owner Address:", ownerWallet.address);

    // 배포 비용 추적
    let totalGasCost = 0n;
    const deploymentDetails: any[] = [];

    try {
        // TournamentFinalizer 컨트랙트 배포
        let tournamentFinalizerAddr;
        console.log("\n2️⃣ TournamentFinalizer 컨트랙트 배포 중...");
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
                console.log("✅ TournamentFinalizer 컨트랙트 배포 완료:", tournamentFinalizerAddr);
                console.log("  📝 트랜잭션 해시:", receipt.hash);
                console.log("  ⛽ 가스 사용량:", receipt.gasUsed.toString());
                console.log("  💰 배포 비용:", ethers.formatEther(gasCost), "ETH");
            }
        }
        await waitIfNeeded();

        // 배포 결과 출력
        console.log("\n🎉 모든 컨트랙트 배포가 완료되었습니다!");
        console.log("\n📋 배포된 컨트랙트 주소들:");
        console.log("  - TournamentFinalizer:", tournamentFinalizerAddr);

        // 총 비용 요약
        console.log("\n💰 배포 비용 요약:");
        console.log("  ┌─────────────────────────────────────────────────────");
        console.log(`  │ 총 가스 비용: ${ethers.formatEther(totalGasCost)} ETH`);
        console.log("  └─────────────────────────────────────────────────────");

        console.log("\n📊 배포 상세 내역:");
        deploymentDetails.forEach((detail, index) => {
            console.log(`  ${index + 1}. ${detail.contract} 컨트랙트`);
            console.log(`     - 주소: ${detail.address}`);
            console.log(`     - 트랜잭션 해시: ${detail.txHash}`);
            console.log(`     - 가스 사용량: ${detail.gasUsed}`);
            console.log(`     - 가스 가격: ${detail.gasPrice} Gwei`);
            console.log(`     - 배포 비용: ${detail.cost} ETH`);
        });

        const deploymentInfo = {
            network: await provider.getNetwork(),
            deployer: ownerWallet.address, // OWNER_KEY로 배포한 주소
            contracts: {
                tournamentFinalizer: tournamentFinalizerAddr,
            },
            deploymentTime: new Date().toISOString(),
            deploymentBlock: await provider.getBlockNumber()
        };

        console.log("\n💾 배포 정보를 scripts/output/deployment-info.json 파일에 저장합니다...");
        const outputDir = path.join(__dirname, 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(
            path.join(outputDir, 'deployment-info.json'),
            JSON.stringify(deploymentInfo, null, 2)
        );

        console.log("✅ 배포 정보 저장 완료");
    } catch (error) {
        console.error("❌ 배포 중 오류가 발생했습니다:", error);
        process.exit(1);
    }
}

main()
    .then(() => {
        console.log("\n🎯 배포 스크립트 실행 완료 (OWNER_KEY 사용)");
        process.exit(0)
    })
    .catch((error) => {
        console.error("❌ 배포 스크립트 실행 실패:", error);
        process.exit(1);
    });
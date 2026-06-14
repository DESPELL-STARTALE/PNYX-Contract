// scripts/tournamentFinalizer/transferOwnership.ts
// TournamentFinalizer 컨트랙트의 소유권을 ADMIN_KEY 주소로 이전 (OWNER_KEY 사용).
// 컨트랙트는 표준 Ownable(단일 단계)이므로 transferOwnership()은 즉시 적용되며 되돌릴 수 없다.
import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// =========================
// Params (직접 수정)
// =========================
const DEPLOYMENT_INFO_FILE: string = "soneium-mainnet-deployment-info.json";
// const DEPLOYMENT_INFO_FILE: string = "soneium-testnet-deployment-info.json";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitIfNeeded() {
    console.log("⏳ 트랜잭션 확정 후 1초 대기...");
    await sleep(1000);
}

// read a required env var (throws if missing/blank) — pikit-contract pattern
function requireEnv(key: string): string {
    const v = process.env[key];
    if (!v || !v.trim()) {
        throw new Error(`❌ .env 파일에 ${key}를 설정해야 합니다.`);
    }
    return v.trim();
}

function asAddress(name: string, v: string): string {
    if (!ethers.isAddress(v)) {
        throw new Error(`❌ ${name} 주소가 올바르지 않습니다: ${v}`);
    }
    return v;
}

// read the TournamentFinalizer address from the deployment-info file
function loadTournamentFinalizerAddressFromDeploymentInfo(): { address: string; deploymentInfo: any } {
    const deploymentInfoPath = path.join(
        __dirname,
        "..",
        "output",
        DEPLOYMENT_INFO_FILE
    );

    if (!fs.existsSync(deploymentInfoPath)) {
        throw new Error(
            `❌ deployment-info 파일을 찾을 수 없습니다: ${deploymentInfoPath}\n` +
            `   scripts/deploy.ts로 먼저 배포하거나 DEPLOYMENT_INFO_FILE 값을 확인하세요.`
        );
    }

    const raw = fs.readFileSync(deploymentInfoPath, "utf8");
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`❌ deployment-info 파싱 실패: ${(e as Error).message}`);
    }

    const address = parsed?.contracts?.tournamentFinalizer;
    if (!address || typeof address !== "string") {
        throw new Error(
            "❌ deployment-info에서 TournamentFinalizer 주소를 찾을 수 없습니다.\n" +
            "   contracts.tournamentFinalizer 필드가 있는지 확인하세요."
        );
    }

    return { address, deploymentInfo: parsed };
}

async function main() {
    console.log("🚀 TournamentFinalizer.transferOwnership() 실행을 시작합니다... (OWNER_KEY 사용)");

    const ownerKey = requireEnv("OWNER_KEY");
    const newOwner = asAddress("ADMIN_KEY", requireEnv("ADMIN_KEY"));

    const rpcUrl = (network.config as { url?: string }).url;
    if (!rpcUrl) {
        throw new Error(
            `❌ 현재 네트워크(${network.name})의 RPC URL을 찾을 수 없습니다. hardhat.config.ts 또는 .env를 확인하세요.`
        );
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(ownerKey, provider);

    if (newOwner === ethers.ZeroAddress) {
        throw new Error("❌ ADMIN_KEY는 zero address일 수 없습니다.");
    }
    if (newOwner.toLowerCase() === signer.address.toLowerCase()) {
        throw new Error(
            `❌ 새 owner가 현재 signer와 동일합니다. ADMIN_KEY와 OWNER_KEY가 서로 다른 주소여야 합니다.\n  signer/newOwner=${signer.address}`
        );
    }

    console.log("🌐 실행 네트워크:", network.name);
    console.log("🔗 RPC URL:", rpcUrl);
    console.log("👤 Signer (current owner):", signer.address);
    console.log("🆕 New owner (ADMIN_KEY):", newOwner);

    const { address: contractAddress, deploymentInfo } =
        loadTournamentFinalizerAddressFromDeploymentInfo();
    console.log("📦 Deployment Info 로드 완료:", DEPLOYMENT_INFO_FILE);
    console.log("🏛 TournamentFinalizer 주소:", contractAddress);

    // 안전장치: --network와 DEPLOYMENT_INFO_FILE이 어긋나 잘못된 체인으로 이전하는 사고 방지.
    const connectedChainId = (await provider.getNetwork()).chainId;
    const recordedChainId = deploymentInfo?.network?.chainId;
    if (recordedChainId !== undefined && recordedChainId !== null) {
        if (BigInt(recordedChainId) !== connectedChainId) {
            throw new Error(
                `❌ 연결된 체인(${connectedChainId})과 deployment-info의 chainId(${recordedChainId})가 다릅니다.\n` +
                `   --network와 DEPLOYMENT_INFO_FILE이 일치하는지 확인하세요.`
            );
        }
    } else {
        console.log("⚠️  deployment-info에 network.chainId가 없어 체인 일치 검증을 건너뜁니다.");
    }

    const contract = await ethers.getContractAt(
        "TournamentFinalizer",
        contractAddress,
        signer
    );

    console.log("\n🧾 Plan (transferOwnership)");
    console.log("  - From:", signer.address);
    console.log("  - To  :", newOwner);

    const currentOwner = (await contract.owner()) as string;
    console.log("\n🔑 현재 owner:", currentOwner);

    if (currentOwner.toLowerCase() === newOwner.toLowerCase()) {
        console.log("✅ 이미 새 owner와 동일합니다. 더 이상 할 작업이 없습니다.");
        return;
    }

    if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
        throw new Error(
            `❌ signer가 컨트랙트 owner가 아닙니다.\n  signer=${signer.address}\n  owner=${currentOwner}`
        );
    }

    try {
        console.log(`\n🔄 transferOwnership(${newOwner}) 트랜잭션 전송 중...`);
        const txReq = await contract.transferOwnership.populateTransaction(newOwner);
        const est = await provider.estimateGas({ ...txReq, from: signer.address });
        console.log("estimateGas:", est.toString());
        const gasLimit = est * 2n;
        const tx = await signer.sendTransaction({ ...txReq, gasLimit });
        console.log("📝 txHash:", tx.hash);

        const receipt = await tx.wait();
        if (!receipt) throw new Error("❌ receipt가 null 입니다 (tx dropped or not found).");

        const gasPrice = (receipt as any).gasPrice ?? (receipt as any).effectiveGasPrice ?? 0n;
        const gasCost = BigInt(receipt.gasUsed.toString()) * BigInt(gasPrice);

        console.log("✅ transferOwnership() 완료");
        console.log("  ⛽ gasUsed:", receipt.gasUsed.toString());
        console.log("  💰 가스 비용:", ethers.formatEther(gasCost), "ETH");

        const updatedOwner = (await contract.owner()) as string;
        console.log("  🔑 변경 후 owner:", updatedOwner);
        if (updatedOwner.toLowerCase() !== newOwner.toLowerCase()) {
            throw new Error(
                `❌ owner가 새 owner로 변경되지 않았습니다.\n  expected=${newOwner}\n  actual  =${updatedOwner}`
            );
        }

        await waitIfNeeded();

        console.log("\n========================================");
        console.log("🎯 소유권 이전 완료");
        console.log("  🆕 새 owner:", newOwner);
        console.log("========================================");
    } catch (error: any) {
        const msg = String(error?.message ?? error);
        if (msg.includes("OwnableUnauthorizedAccount")) {
            console.error("❌ revert: OwnableUnauthorizedAccount (owner만 호출 가능)");
        }
        if (msg.includes("OwnableInvalidOwner")) {
            console.error("❌ revert: OwnableInvalidOwner (zero address는 허용되지 않습니다)");
        }
        console.error("❌ transferOwnership 실행 중 오류:", error);
        process.exit(1);
    }
}

main()
    .then(() => {
        console.log("\n🎯 스크립트 실행 완료");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ 스크립트 실행 실패:", error);
        process.exit(1);
    });

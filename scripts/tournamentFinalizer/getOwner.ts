// scripts/tournamentFinalizer/getOwner.ts
// TournamentFinalizer 컨트랙트의 현재 owner를 조회 (읽기 전용, 서명자/키 불필요).
import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

// =========================
// Params (직접 수정)
// =========================
const DEPLOYMENT_INFO_FILE: string = "soneium-mainnet-deployment-info.json";
// const DEPLOYMENT_INFO_FILE: string = "soneium-testnet-deployment-info.json";

const OWNABLE_VIEW_ABI = ["function owner() view returns (address)"];

// read the TournamentFinalizer address from the deployment-info file
function loadTournamentFinalizerAddressFromDeploymentInfo(): string {
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

    console.log("📄 deployment-info의 network 정보:", parsed.network);
    return address;
}

async function main() {
    console.log("🚀 TournamentFinalizer.owner() 조회 스크립트를 시작합니다.");
    console.log("🌐 Network:", network.name);

    const rpcUrl = (network.config as { url?: string }).url;
    if (!rpcUrl) {
        throw new Error(
            `❌ 현재 네트워크(${network.name})의 RPC URL을 찾을 수 없습니다. hardhat.config.ts 또는 .env를 확인하세요.`
        );
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const contractAddress = loadTournamentFinalizerAddressFromDeploymentInfo();
    console.log("🏛 TournamentFinalizer 주소:", contractAddress);

    const contract = new ethers.Contract(contractAddress, OWNABLE_VIEW_ABI, provider);
    const owner = (await contract.owner()) as string;

    console.log("✅ 조회 완료");
    console.log("  - 현재 owner:", owner);
}

main()
    .then(() => {
        console.log("\n🎯 getOwner 스크립트 실행 완료");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ getOwner 스크립트 실행 실패:", error);
        process.exit(1);
    });

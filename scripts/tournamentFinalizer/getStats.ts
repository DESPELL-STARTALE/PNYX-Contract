import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

// ============================================================
// ✏️ 조회할 themeId, itemId (필요시 수정하거나 CLI 인자로 교체)
// ============================================================
const THEME_ID: number = 1;
const ITEM_ID: number = 26605;

// deployment-info.json 에서 TournamentFinalizer 주소 읽기
function loadTournamentFinalizerAddressFromDeploymentInfo(): string {
    const deploymentInfoPath = path.join(
        __dirname,
        "..",
        "output",
        "deployment-info.json"
    );

    if (!fs.existsSync(deploymentInfoPath)) {
        throw new Error(
            `❌ deployment-info.json 파일을 찾을 수 없습니다: ${deploymentInfoPath}\n` +
            `   먼저 scripts/deploy.ts 를 실행해 컨트랙트를 배포하고, output 파일이 생성되었는지 확인하세요.`
        );
    }

    const raw = fs.readFileSync(deploymentInfoPath, "utf8");
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`❌ deployment-info.json 파싱에 실패했습니다: ${(e as Error).message}`);
    }

    const address = parsed?.contracts?.tournamentFinalizer;
    if (!address || typeof address !== "string") {
        throw new Error(
            "❌ deployment-info.json 에서 TournamentFinalizer 주소를 찾을 수 없습니다.\n" +
            "   파일 구조에 contracts.tournamentFinalizer 가 있는지 확인하세요."
        );
    }

    console.log("📄 deployment-info.json 기준 네트워크 정보:", parsed.network);
    return address;
}

// ============================================================
// 메인 실행 로직
// ============================================================

async function main() {
    console.log("🚀 TournamentFinalizer.stats 조회 스크립트를 시작합니다.");

    const networkName = network.name;
    console.log("🌐 실행 네트워크:", networkName);

    // scripts/output/deployment-info.json 에서 주소 읽기
    const contractAddress = loadTournamentFinalizerAddressFromDeploymentInfo();
    if (!contractAddress) {
        throw new Error("❌ TournamentFinalizer 주소를 찾지 못했습니다.");
    }

    // 읽기 전용이지만, 일단 signer를 하나 가져와서 연결 (필요 시 provider만 써도 됨)
    const [signer] = await ethers.getSigners();
    console.log("👤 조회에 사용할 주소:", signer.address);
    console.log("🏛 TournamentFinalizer 주소:", contractAddress);

    const contract = await ethers.getContractAt(
        "TournamentFinalizer",
        contractAddress,
        signer
    );

    console.log("🔎 stats 조회 중... themeId =", THEME_ID, ", itemId =", ITEM_ID);
    const stat = await contract.stats(THEME_ID, ITEM_ID);

    console.log("✅ 조회 완료");
    console.log("  - themeId:", THEME_ID);
    console.log("  - itemId:", ITEM_ID);
    console.log("  - firstCnt (raw BigNumber):", stat.firstCnt);
    console.log("  - secondCnt (raw BigNumber):", stat.secondCnt);
    console.log("  - firstCnt (string):", stat.firstCnt.toString());
    console.log("  - secondCnt (string):", stat.secondCnt.toString());
}

main()
    .then(() => {
        console.log("\n🎯 getStats 스크립트 실행 완료");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ getStats 스크립트 실행 실패:", error);
        process.exit(1);
    });

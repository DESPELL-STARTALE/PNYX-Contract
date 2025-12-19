import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

// ============================================================
// ✏️ 수정해서 사용할 입력 상수들
// ============================================================

// finalizeTournament 에 전달할 themeId
const THEME_ID: number = 1;

// 참가자 수 (2의 제곱수, 2명 이상 1024명 이하)
// 참가자 수 * 2 = 바이트 길이 (4 ~ 2048 바이트, 2의 제곱수)
const PARTICIPANT_COUNT = 64; // 기본값: 64명 (128 바이트)

// 참가자 ID 범위 (uint16)
const PARTICIPANT_MIN_ID = 0;
const PARTICIPANT_MAX_ID = 65535;

// ============================================================
// 내부 유틸 함수들
// ============================================================

// uint16 배열을 Big-endian bytes(hex string)로 변환
function encodeUint16ArrayBE(values: number[]): string {
    const byteLength = values.length * 2;

    let hex = "0x";
    for (const v of values) {
        hex += v.toString(16).padStart(4, "0");
    }
    return hex;
}

// 참가자 배열이 유니크한지 간단히 체크 (Solidity 쪽에서도 한 번 더 체크함)
function ensureUnique(values: number[]) {
    const set = new Set(values);
    if (set.size !== values.length) {
        throw new Error("PARTICIPANTS 배열에 중복 값이 있습니다. finalizeTournament 가 InvalidItem 으로 revert 될 수 있습니다.");
    }
}

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

// 0~65535 범위에서 순서 상관없이 유니크한 숫자를 랜덤으로 선택
// (내부 유틸: 항상 유니크한 배열을 반환)
function generateRandomParticipantsUnique(
    count: number,
    minId: number,
    maxId: number
): number[] {
    const range = maxId - minId + 1;
    if (range < count) {
        throw new Error("선택 가능한 ID 범위보다 count 가 더 큽니다. 유니크한 값 생성 불가.");
    }

    const chosen = new Set<number>();
    while (chosen.size < count) {
        const v = Math.floor(Math.random() * range) + minId;
        chosen.add(v);
    }
    return Array.from(chosen);
}

// 중복값이 없게 참가자를 뽑는 함수
// - PARTICIPANT_COUNT 개수만큼
// - PARTICIPANT_MIN_ID ~ PARTICIPANT_MAX_ID 범위에서
// - 유니크하게 랜덤 추출
export function pickParticipantsUnique(): number[] {
    const participants = generateRandomParticipantsUnique(
        PARTICIPANT_COUNT,
        PARTICIPANT_MIN_ID,
        PARTICIPANT_MAX_ID
    );
    // 방어적 검증 (이론상 항상 true)
    ensureUnique(participants);
    return participants;
}

// 중복값이 있게 참가자를 뽑는 함수
// - 기본적으로는 유니크하게 뽑되,
// - 무작위로 선택한 두 인덱스 중 하나를 다른 하나의 값으로 덮어써
//   최소 1개 이상의 중복이 있도록 만듦
// - finalizeTournament 호출 시 InvalidItem 에러를 발생시키고 싶은 경우에 사용
export function pickParticipantsWithDuplicate(): number[] {
    const participants = generateRandomParticipantsUnique(
        PARTICIPANT_COUNT,
        PARTICIPANT_MIN_ID,
        PARTICIPANT_MAX_ID
    );

    const i = Math.floor(Math.random() * participants.length);
    let j = Math.floor(Math.random() * participants.length);
    if (i === j) {
        j = (j + 1) % participants.length;
    }

    // j 위치에 i 위치의 값을 덮어써서 중복 생성
    participants[j] = participants[i];

    // 이 배열은 의도적으로 중복을 포함하므로 ensureUnique 를 호출하지 않습니다.
    return participants;
}

// ============================================================
// 메인 실행 로직
// ============================================================

async function main() {
    console.log("🚀 TournamentFinalizer.finalizeTournament 실행 스크립트를 시작합니다.");

    const networkName = network.name;
    console.log("🌐 실행 네트워크:", networkName);

    // scripts/output/deployment-info.json 에서 주소 읽기
    const contractAddress = loadTournamentFinalizerAddressFromDeploymentInfo();
    if (!contractAddress) {
        throw new Error("❌ TournamentFinalizer 주소를 찾지 못했습니다.");
    }

    // hardhat.config.ts 의 accounts 설정(예: PRIVATE_KEY)을 이용한 signer
    const [signer] = await ethers.getSigners();
    console.log("👤 트랜잭션 보낼 주소:", signer.address);
    console.log("🏛 TournamentFinalizer 주소:", contractAddress);

    // 참가자 생성(랜덤, 유니크) 및 bytes 인코딩
    // - 중복 없는 참가자를 사용: pickParticipantsUnique()
    // - 중복 있는 참가자를 사용해 InvalidItem revert 를 보고 싶다면
    //   아래 한 줄을 pickParticipantsWithDuplicate() 로 변경하면 됩니다.
    const participants = pickParticipantsUnique();
    // const participants = pickParticipantsWithDuplicate();

    // console.log("participants:", ethers.dataLength(encodeUint16ArrayBE(participants)));
    const tournamentData = encodeUint16ArrayBE(participants);

    // 컨트랙트에서 우승자와 준우승자는 다음과 같이 계산됩니다:
    // - 우승자(first): offset 0에서 읽은 uint16 값
    // - 준우승자(second): offset len/2에서 읽은 uint16 값
    const winner = participants[0]; // 첫 번째 아이템 (offset 0)
    const runnerUp = participants[participants.length / 2]; // 중간 지점 아이템 (offset len/2)

    console.log("🎯 themeId:", THEME_ID);
    console.log("👥 참가자 수:", participants.length, `(${ethers.dataLength(tournamentData)} 바이트)`);
    console.log("👑 참가자:", participants);
    console.log("👑 우승자(first) 후보 ID:", winner, `(index ${0})`);
    console.log("🥈 준우승자(second) 후보 ID:", runnerUp, `(index ${participants.length / 2})`);

    // 컨트랙트 인스턴스 생성
    const contract = await ethers.getContractAt(
        "TournamentFinalizer",
        contractAddress,
        signer
    );

    console.log("📝 finalizeTournament 트랜잭션 전송 중...");
    // 컨트랙트 함수 시그니처: finalizeTournament(uint16 _tournamentId, bytes calldata _tournamentData)
    // - _tournamentId: 테마 ID (THEME_ID)
    // - _tournamentData: Big-endian으로 인코딩된 uint16 배열 (4 ~ 2048 바이트, 2의 제곱수)
    const tx = await contract.finalizeTournament(THEME_ID, tournamentData);
    console.log("⏳ 트랜잭션 전송 완료. hash:", tx.hash);

    const receipt = await tx.wait();
    console.log("✅ 트랜잭션 확정!");
    console.log("  - blockNumber:", receipt?.blockNumber);
    console.log("  - gasUsed:", receipt?.gasUsed.toString());

    // 발생한 이벤트 파싱 및 출력
    if (receipt && receipt.logs && receipt.logs.length > 0) {
        console.log("\n📢 트랜잭션에서 발생한 이벤트들:");
        for (const log of receipt.logs) {
            // 이 컨트랙트에서 발생한 로그만 파싱 시도
            if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
                continue;
            }
            try {
                const parsed = contract.interface.parseLog(log);
                console.log(`\n  ▶ 이벤트 이름: ${parsed?.name}`);
                console.log("    - args:", parsed?.args);

                if (parsed?.name === "TournamentFinalized") {
                    // 이벤트 파라미터 순서: (address indexed user, bytes32 indexed tournamentDataHash, uint16 themeId, bytes tournamentData)
                    // user와 tournamentDataHash는 indexed이므로 이벤트 로그의 topics 배열에서도 조회 가능
                    const user = parsed?.args[0];
                    const tournamentDataHash = parsed?.args[1];
                    const themeId = parsed?.args[2];
                    const tournamentDataBytes = parsed?.args[3];
                    console.log("    - user:", user);
                    console.log("    - tournamentDataHash (indexed):", tournamentDataHash);
                    console.log("    - themeId:", themeId.toString());
                    console.log(
                        "    - tournamentData(bytes 길이):",
                        ethers.dataLength(tournamentDataBytes)
                    );
                }
            } catch {
                // 이 컨트랙트의 이벤트 형식과 맞지 않으면 무시
            }
        }
    } else {
        console.log("\nℹ️ 이 트랜잭션에서 디코딩 가능한 이벤트 로그가 없습니다.");
    }
}

main()
    .then(() => {
        console.log("\n🎯 finalizeTournament 스크립트 실행 완료");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ finalizeTournament 스크립트 실행 실패:", error);
        process.exit(1);
    });

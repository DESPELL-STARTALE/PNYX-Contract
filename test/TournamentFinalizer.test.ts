import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// helper: uint16 배열을 Big-endian bytes(hex string)로 변환
function encodeUint16ArrayBE(values: number[]): string {
    let hex = "0x";
    for (const v of values) {
        if (v < 0 || v > 0xffff) {
            throw new Error("uint16 범위를 벗어났습니다");
        }
        hex += v.toString(16).padStart(4, "0");
    }
    return hex;
}

async function deployTournamentFinalizerFixture() {
    const [owner, otherAccount] = await ethers.getSigners();

    const TournamentFinalizer = await ethers.getContractFactory(
        "TournamentFinalizer"
    );
    const tournamentFinalizer = await TournamentFinalizer.deploy();
    await tournamentFinalizer.waitForDeployment();

    return { tournamentFinalizer, owner, otherAccount };
}

describe("TournamentFinalizer", function () {
    describe("finalizeTournament", function () {
        it("정상적인 토너먼트 데이터를 처리하고 카운트를 갱신한다", async function () {
            const { tournamentFinalizer, owner } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            // 64개의 유니크한 uint16 값 (1..64)
            const participants: number[] = [];
            for (let i = 0; i < 64; i++) {
                participants.push(i + 1);
            }

            const data = encodeUint16ArrayBE(participants);

            const first = participants[0]; // index 0
            const second = participants[32]; // len/2 = 128/2 = 64 -> index 32 (0-based)

            await expect(
                tournamentFinalizer.finalizeTournament(themeId, data)
            )
                .to.emit(tournamentFinalizer, "TournamentFinalized")
                .withArgs(owner.address, themeId, data);

            const themeCnt = await tournamentFinalizer.themeCnt(themeId);
            expect(themeCnt).to.equal(1n);

            const firstStat = await tournamentFinalizer.stats(themeId, first);
            const secondStat = await tournamentFinalizer.stats(themeId, second);

            expect(firstStat.firstCnt).to.equal(1n);
            expect(firstStat.secondCnt).to.equal(0n);
            expect(secondStat.firstCnt).to.equal(0n);
            expect(secondStat.secondCnt).to.equal(1n);
        });

        it("우승자(first)와 준우승자(second)가 올바른 아이템에만 기록된다", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 3;

            const participants: number[] = [];
            for (let i = 0; i < 64; i++) {
                participants.push(i + 1);
            }

            const winner = participants[0]; // 우승자
            const runnerUp = participants[32]; // 준우승자

            const data = encodeUint16ArrayBE(participants);

            await tournamentFinalizer.finalizeTournament(themeId, data);

            for (const id of participants) {
                const stat = await tournamentFinalizer.stats(themeId, id);

                if (id === winner) {
                    expect(stat.firstCnt).to.equal(1n);
                    expect(stat.secondCnt).to.equal(0n);
                } else if (id === runnerUp) {
                    expect(stat.firstCnt).to.equal(0n);
                    expect(stat.secondCnt).to.equal(1n);
                } else {
                    expect(stat.firstCnt).to.equal(0n);
                    expect(stat.secondCnt).to.equal(0n);
                }
            }
        });

        it("같은 테마에서 여러 번 finalize하면 누적 카운트가 증가한다", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 2;

            const participants: number[] = [];
            for (let i = 0; i < 64; i++) {
                participants.push(i + 100); // 100..163, 유니크
            }

            const data = encodeUint16ArrayBE(participants);

            const first = participants[0];
            const second = participants[32];

            await tournamentFinalizer.finalizeTournament(themeId, data);
            await tournamentFinalizer.finalizeTournament(themeId, data);

            const themeCnt = await tournamentFinalizer.themeCnt(themeId);
            expect(themeCnt).to.equal(2n);

            const firstStat = await tournamentFinalizer.stats(themeId, first);
            const secondStat = await tournamentFinalizer.stats(themeId, second);

            expect(firstStat.firstCnt).to.equal(2n);
            expect(firstStat.secondCnt).to.equal(0n);
            expect(secondStat.firstCnt).to.equal(0n);
            expect(secondStat.secondCnt).to.equal(2n);
        });

        it("토너먼트 데이터 길이가 128 바이트보다 짧으면 InvalidTournament 에러로 revert한다", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            // 10개 참가자 -> 20 bytes
            const shortParticipants: number[] = [];
            for (let i = 0; i < 10; i++) {
                shortParticipants.push(i + 1);
            }
            const shortData = encodeUint16ArrayBE(shortParticipants);

            // bytes 길이는 10 * 2 = 20
            await expect(
                tournamentFinalizer.finalizeTournament(themeId, shortData)
            )
                .to.be.revertedWithCustomError(tournamentFinalizer, "InvalidTournament")
                .withArgs(20);
        });

        it("토너먼트 데이터 길이가 128 바이트보다 길면 InvalidTournament 에러로 revert한다", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            // 65개 참가자 -> 130 bytes
            const longParticipants: number[] = [];
            for (let i = 0; i < 65; i++) {
                longParticipants.push(i + 1);
            }
            const longData = encodeUint16ArrayBE(longParticipants);

            // bytes 길이는 65 * 2 = 130
            await expect(
                tournamentFinalizer.finalizeTournament(themeId, longData)
            )
                .to.be.revertedWithCustomError(tournamentFinalizer, "InvalidTournament")
                .withArgs(130);
        });

        it("토너먼트 데이터에 중복 아이템이 있으면 InvalidItem 에러로 revert한다", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            const participants: number[] = [];
            for (let i = 0; i < 64; i++) {
                participants.push(i); // 0..63
            }

            // 중복 생성: index 10에 0을 다시 넣어서 0이 두 번 등장
            const duplicatedValue = participants[0];
            participants[10] = duplicatedValue;

            const data = encodeUint16ArrayBE(participants);

            await expect(
                tournamentFinalizer.finalizeTournament(themeId, data)
            )
                .to.be.revertedWithCustomError(tournamentFinalizer, "InvalidItem")
                .withArgs(duplicatedValue);
        });

        it("themeId 0도 정상적으로 처리되고 카운트가 증가한다", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 0;

            const participants: number[] = [];
            for (let i = 0; i < 64; i++) {
                participants.push(i + 1);
            }

            const data = encodeUint16ArrayBE(participants);

            await tournamentFinalizer.finalizeTournament(themeId, data);

            const themeCnt = await tournamentFinalizer.themeCnt(themeId);
            expect(themeCnt).to.equal(1n);
        });
    });
});

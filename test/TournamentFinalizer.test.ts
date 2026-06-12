import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// helper: convert a uint16 array to Big-endian bytes (hex string)
function encodeUint16ArrayBE(values: number[]): string {
    let hex = "0x";
    for (const v of values) {
        if (v < 0 || v > 0xffff) {
            throw new Error("Value is out of uint16 range");
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
        it("processes valid tournament data and updates the count", async function () {
            const { tournamentFinalizer, owner } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            // 64 unique uint16 values (1..64) -> 128 bytes (a power of two)
            const participants: number[] = [];
            for (let i = 0; i < 64; i++) {
                participants.push(i + 1);
            }

            const data = encodeUint16ArrayBE(participants);

            const first = participants[0]; // index 0
            const second = participants[32]; // len/2 = 128/2 = 64 -> index 32 (0-based)

            // event param order: (address indexed user, bytes32 tournamentDataHash, uint16 themeId, bytes tournamentData)
            const tournamentDataHash = ethers.keccak256(data);

            await expect(
                tournamentFinalizer.finalizeTournament(themeId, data)
            )
                .to.emit(tournamentFinalizer, "TournamentFinalized")
                .withArgs(owner.address, tournamentDataHash, themeId, data);

            // contract public mapping: mapping(uint16 => uint256) public tournamentCnt;
            const tournamentCnt = await tournamentFinalizer.tournamentCnt(themeId);
            expect(tournamentCnt).to.equal(1n);

            const firstStat = await tournamentFinalizer.stats(themeId, first);
            const secondStat = await tournamentFinalizer.stats(themeId, second);

            expect(firstStat.firstCnt).to.equal(1n);
            expect(firstStat.secondCnt).to.equal(0n);
            expect(secondStat.firstCnt).to.equal(0n);
            expect(secondStat.secondCnt).to.equal(1n);
        });

        it("processes 4-byte (minimum length) tournament data", async function () {
            const { tournamentFinalizer, owner } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            // 2 participants -> 4 bytes (minimum length, a power of two)
            const participants: number[] = [1, 2];
            const data = encodeUint16ArrayBE(participants);

            const first = participants[0]; // index 0
            const second = participants[1]; // len/2 = 4/2 = 2 -> index 1 (0-based)

            // event param order: (address indexed user, bytes32 tournamentDataHash, uint16 themeId, bytes tournamentData)
            const tournamentDataHash = ethers.keccak256(data);

            await expect(
                tournamentFinalizer.finalizeTournament(themeId, data)
            )
                .to.emit(tournamentFinalizer, "TournamentFinalized")
                .withArgs(owner.address, tournamentDataHash, themeId, data);

            // contract public mapping: mapping(uint16 => uint256) public tournamentCnt;
            const tournamentCnt = await tournamentFinalizer.tournamentCnt(themeId);
            expect(tournamentCnt).to.equal(1n);

            const firstStat = await tournamentFinalizer.stats(themeId, first);
            const secondStat = await tournamentFinalizer.stats(themeId, second);

            expect(firstStat.firstCnt).to.equal(1n);
            expect(firstStat.secondCnt).to.equal(0n);
            expect(secondStat.firstCnt).to.equal(0n);
            expect(secondStat.secondCnt).to.equal(1n);
        });

        it("records the winner (first) and runner-up (second) only on the correct items", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 3;

            const participants: number[] = [];
            for (let i = 0; i < 64; i++) {
                participants.push(i + 1);
            }

            const winner = participants[0]; // winner
            const runnerUp = participants[32]; // runner-up

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

        it("accumulates counts when finalizing the same theme multiple times", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 2;

            const participants: number[] = [];
            for (let i = 0; i < 64; i++) {
                participants.push(i + 100); // 100..163, unique
            }

            const data = encodeUint16ArrayBE(participants);

            const first = participants[0];
            const second = participants[32];

            await tournamentFinalizer.finalizeTournament(themeId, data);
            await tournamentFinalizer.finalizeTournament(themeId, data);

            // contract public mapping: mapping(uint16 => uint256) public tournamentCnt;
            const tournamentCnt = await tournamentFinalizer.tournamentCnt(themeId);
            expect(tournamentCnt).to.equal(2n);

            const firstStat = await tournamentFinalizer.stats(themeId, first);
            const secondStat = await tournamentFinalizer.stats(themeId, second);

            expect(firstStat.firstCnt).to.equal(2n);
            expect(firstStat.secondCnt).to.equal(0n);
            expect(secondStat.firstCnt).to.equal(0n);
            expect(secondStat.secondCnt).to.equal(2n);
        });

        it("reverts when the tournament data length is shorter than 4 bytes", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            // 1 participant -> 2 bytes (less than 4)
            const shortParticipants: number[] = [1];
            const shortData = encodeUint16ArrayBE(shortParticipants);

            // byte length is 1 * 2 = 2
            await expect(
                tournamentFinalizer.finalizeTournament(themeId, shortData)
            ).to.be.revertedWith("Invalid bytes length");
        });

        it("reverts when the tournament data length is not a power of two", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            // 10 participants -> 20 bytes (not a power of two)
            const shortParticipants: number[] = [];
            for (let i = 0; i < 10; i++) {
                shortParticipants.push(i + 1);
            }
            const shortData = encodeUint16ArrayBE(shortParticipants);

            // byte length is 10 * 2 = 20 (not a power of two)
            await expect(
                tournamentFinalizer.finalizeTournament(themeId, shortData)
            ).to.be.revertedWith("Invalid bytes length");
        });

        it("reverts when the tournament data length is longer than 2048 bytes", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            // 1025 participants -> 2050 bytes (greater than 2048)
            const longParticipants: number[] = [];
            for (let i = 0; i < 1025; i++) {
                longParticipants.push(i + 1);
            }
            const longData = encodeUint16ArrayBE(longParticipants);

            // byte length is 1025 * 2 = 2050
            await expect(
                tournamentFinalizer.finalizeTournament(themeId, longData)
            ).to.be.revertedWith("Invalid bytes length");
        });

        it("reverts with the InvalidItem error when the tournament data has duplicate items", async function () {
            const { tournamentFinalizer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const themeId = 1;

            const participants: number[] = [];
            for (let i = 0; i < 64; i++) {
                participants.push(i); // 0..63
            }

            // create a duplicate: put 0 back at index 10 so 0 appears twice
            const duplicatedValue = participants[0];
            participants[10] = duplicatedValue;

            const data = encodeUint16ArrayBE(participants);

            await expect(
                tournamentFinalizer.finalizeTournament(themeId, data)
            )
                .to.be.revertedWithCustomError(tournamentFinalizer, "InvalidItem")
                .withArgs(duplicatedValue);
        });

        it("processes themeId 0 normally and increments the count", async function () {
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

            // contract public mapping: mapping(uint16 => uint256) public tournamentCnt;
            const tournamentCnt = await tournamentFinalizer.tournamentCnt(themeId);
            expect(tournamentCnt).to.equal(1n);
        });
    });
});

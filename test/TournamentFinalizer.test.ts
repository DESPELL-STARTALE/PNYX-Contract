import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { TournamentFinalizer } from "../typechain-types";

// EIP-712 type string baked into the contract at deploy time.
// MUST match PNYX-BE's EIP712_FINALIZE_TOURNAMENT_TYPES (field order + types).
const TYPE_STRING =
    "FinalizeTournament(address user,uint256 tournamentId,bytes tournamentData,uint256 point,uint256 nonce,uint256 deadline)";

const FINALIZE_TOURNAMENT_TYPES = {
    FinalizeTournament: [
        { name: "user", type: "address" },
        { name: "tournamentId", type: "uint256" },
        { name: "tournamentData", type: "bytes" },
        { name: "point", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
    ],
};

const EIP712_NAME = "TournamentFinalizer";
const EIP712_VERSION = "1";

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

// helper: [start, start+1, ... start+count-1]
function range(count: number, start = 1): number[] {
    return Array.from({ length: count }, (_, i) => i + start);
}

type FinalizeFields = {
    user: string;
    tournamentId: number | bigint;
    tournamentData: string;
    point: number | bigint;
    nonce: bigint;
    deadline: bigint;
};

async function deployTournamentFinalizerFixture() {
    const [owner, caller, signer, other] = await ethers.getSigners();

    const TournamentFinalizer = await ethers.getContractFactory(
        "TournamentFinalizer"
    );
    // `signer` is the authorized EIP-712 signer.
    const tournamentFinalizer = await TournamentFinalizer.deploy(
        signer.address,
        TYPE_STRING
    );
    await tournamentFinalizer.waitForDeployment();

    return { tournamentFinalizer, owner, caller, signer, other };
}

async function buildDomain(tournamentFinalizer: TournamentFinalizer) {
    const verifyingContract = await tournamentFinalizer.getAddress();
    const { chainId } = await ethers.provider.getNetwork();
    return {
        name: EIP712_NAME,
        version: EIP712_VERSION,
        chainId,
        verifyingContract,
    };
}

async function signFinalize(
    signerWallet: HardhatEthersSigner,
    tournamentFinalizer: TournamentFinalizer,
    fields: FinalizeFields
): Promise<string> {
    const domain = await buildDomain(tournamentFinalizer);
    const value = {
        user: fields.user,
        tournamentId: fields.tournamentId,
        tournamentData: fields.tournamentData,
        point: fields.point,
        nonce: fields.nonce,
        deadline: fields.deadline,
    };
    return signerWallet.signTypedData(domain, FINALIZE_TOURNAMENT_TYPES, value);
}

async function futureDeadline(secondsAhead = 3600): Promise<bigint> {
    return BigInt(await time.latest()) + BigInt(secondsAhead);
}

describe("TournamentFinalizer", function () {
    describe("finalizeTournament (happy path)", function () {
        it("verifies a valid signature, emits TournamentFinalized, and increments the nonce", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const tournamentId = 1;
            const point = 2;
            const data = encodeUint16ArrayBE(range(64)); // 128 bytes
            const nonce = await tournamentFinalizer.nonces(caller.address);
            expect(nonce).to.equal(0n);
            const deadline = await futureDeadline();

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId,
                tournamentData: data,
                point,
                nonce,
                deadline,
            });

            const dataHash = ethers.keccak256(data);

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(tournamentId, data, point, deadline, signature)
            )
                .to.emit(tournamentFinalizer, "TournamentFinalized")
                .withArgs(caller.address, dataHash, tournamentId, data);

            expect(await tournamentFinalizer.nonces(caller.address)).to.equal(1n);
        });

        it("produces a signature that recovers to the authorized signer (cross-check with verifyTypedData)", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const data = encodeUint16ArrayBE(range(4));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();
            const fields: FinalizeFields = {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 5,
                nonce,
                deadline,
            };

            const signature = await signFinalize(signer, tournamentFinalizer, fields);
            const domain = await buildDomain(tournamentFinalizer);

            const recovered = ethers.verifyTypedData(
                domain,
                FINALIZE_TOURNAMENT_TYPES,
                {
                    user: fields.user,
                    tournamentId: fields.tournamentId,
                    tournamentData: fields.tournamentData,
                    point: fields.point,
                    nonce: fields.nonce,
                    deadline: fields.deadline,
                },
                signature
            );
            expect(recovered).to.equal(signer.address);
        });

        it("allows distinct users to finalize with their own nonces", async function () {
            const { tournamentFinalizer, caller, signer, other } =
                await loadFixture(deployTournamentFinalizerFixture);

            const data = encodeUint16ArrayBE(range(4));
            const deadline = await futureDeadline();

            for (const user of [caller, other]) {
                const nonce = await tournamentFinalizer.nonces(user.address);
                const signature = await signFinalize(signer, tournamentFinalizer, {
                    user: user.address,
                    tournamentId: 1,
                    tournamentData: data,
                    point: 1,
                    nonce,
                    deadline,
                });
                await expect(
                    tournamentFinalizer
                        .connect(user)
                        .finalizeTournament(1, data, 1, deadline, signature)
                ).to.emit(tournamentFinalizer, "TournamentFinalized");
                expect(await tournamentFinalizer.nonces(user.address)).to.equal(1n);
            }
        });
    });

    describe("finalizeTournament (rejections)", function () {
        it("reverts with ExpiredSignature when the deadline has passed", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const data = encodeUint16ArrayBE(range(4));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = BigInt(await time.latest()) - 1n; // already in the past

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce,
                deadline,
            });

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, signature)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "ExpiredSignature");
        });

        it("reverts with InvalidSigner when signed by an unauthorized account", async function () {
            const { tournamentFinalizer, caller, other } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const data = encodeUint16ArrayBE(range(4));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();

            // `other` is not the authorized signer
            const signature = await signFinalize(other, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce,
                deadline,
            });

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, signature)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "InvalidSigner");
        });

        it("reverts with InvalidSigner when the caller differs from the signed user", async function () {
            const { tournamentFinalizer, caller, signer, other } =
                await loadFixture(deployTournamentFinalizerFixture);

            const data = encodeUint16ArrayBE(range(4));
            const nonce = await tournamentFinalizer.nonces(other.address);
            const deadline = await futureDeadline();

            // signature binds user = caller, but `other` sends the tx
            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce,
                deadline,
            });

            await expect(
                tournamentFinalizer
                    .connect(other)
                    .finalizeTournament(1, data, 1, deadline, signature)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "InvalidSigner");
        });

        it("reverts with InvalidSigner when the tournament data is tampered after signing", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const signedData = encodeUint16ArrayBE(range(4));
            const tamperedData = encodeUint16ArrayBE(range(4, 100));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: signedData,
                point: 1,
                nonce,
                deadline,
            });

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, tamperedData, 1, deadline, signature)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "InvalidSigner");
        });

        it("reverts with InvalidSigner when the point is tampered after signing", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const data = encodeUint16ArrayBE(range(4));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 2,
                nonce,
                deadline,
            });

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 999, deadline, signature)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "InvalidSigner");
        });

        it("prevents replay: reusing the same signature reverts (nonce already consumed)", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const data = encodeUint16ArrayBE(range(4));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce,
                deadline,
            });

            await tournamentFinalizer
                .connect(caller)
                .finalizeTournament(1, data, 1, deadline, signature);

            // nonce is now 1, so the same signature (over nonce 0) no longer recovers the signer
            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, signature)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "InvalidSigner");
        });

        it("reverts on a malformed signature", async function () {
            const { tournamentFinalizer, caller } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const data = encodeUint16ArrayBE(range(4));
            const deadline = await futureDeadline();

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, "0xdeadbeef")
            ).to.be.reverted;
        });
    });

    describe("finalizeTournament (no on-chain data validation)", function () {
        it("accepts a non-power-of-two data length (validation was removed)", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            // 3 participants -> 6 bytes (not a power of two: previously reverted)
            const data = encodeUint16ArrayBE(range(3));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce,
                deadline,
            });

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, signature)
            ).to.emit(tournamentFinalizer, "TournamentFinalized");
        });

        it("accepts data with duplicate item ids (uniqueness check was removed)", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            // duplicate id 7 (previously reverted with InvalidItem)
            const data = encodeUint16ArrayBE([7, 7, 7, 7]);
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce,
                deadline,
            });

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, signature)
            ).to.emit(tournamentFinalizer, "TournamentFinalized");
        });

        it("accepts data longer than the old 2048-byte cap", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            // 1025 participants -> 2050 bytes (previously reverted)
            const data = encodeUint16ArrayBE(range(1025));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce,
                deadline,
            });

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, signature)
            ).to.emit(tournamentFinalizer, "TournamentFinalized");
        });

        it("processes tournamentId 0 normally", async function () {
            const { tournamentFinalizer, caller, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const data = encodeUint16ArrayBE(range(4));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 0,
                tournamentData: data,
                point: 1,
                nonce,
                deadline,
            });

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(0, data, 1, deadline, signature)
            )
                .to.emit(tournamentFinalizer, "TournamentFinalized")
                .withArgs(caller.address, ethers.keccak256(data), 0, data);
        });
    });

    describe("setFinalizeSigner", function () {
        it("lets the owner update the signer and emits SignerUpdated", async function () {
            const { tournamentFinalizer, owner, signer, other } =
                await loadFixture(deployTournamentFinalizerFixture);

            await expect(
                tournamentFinalizer
                    .connect(owner)
                    .setFinalizeSigner(other.address)
            )
                .to.emit(tournamentFinalizer, "SignerUpdated")
                .withArgs(signer.address, other.address);
        });

        it("makes signatures from the new signer pass and the old signer fail", async function () {
            const { tournamentFinalizer, owner, caller, signer, other } =
                await loadFixture(deployTournamentFinalizerFixture);

            await tournamentFinalizer.connect(owner).setFinalizeSigner(other.address);

            const data = encodeUint16ArrayBE(range(4));
            const deadline = await futureDeadline();

            // old signer now rejected
            const oldNonce = await tournamentFinalizer.nonces(caller.address);
            const oldSig = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce: oldNonce,
                deadline,
            });
            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, oldSig)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "InvalidSigner");

            // new signer accepted
            const newSig = await signFinalize(other, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce: oldNonce,
                deadline,
            });
            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, newSig)
            ).to.emit(tournamentFinalizer, "TournamentFinalized");
        });

        it("reverts for a non-owner", async function () {
            const { tournamentFinalizer, caller, other } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .setFinalizeSigner(other.address)
            ).to.be.revertedWithCustomError(
                tournamentFinalizer,
                "OwnableUnauthorizedAccount"
            );
        });

        it("reverts on the zero address", async function () {
            const { tournamentFinalizer, owner } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            await expect(
                tournamentFinalizer
                    .connect(owner)
                    .setFinalizeSigner(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "ZeroAddress");
        });

        it("reverts when set to the current signer (ValueUnchanged)", async function () {
            const { tournamentFinalizer, owner, signer } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            await expect(
                tournamentFinalizer
                    .connect(owner)
                    .setFinalizeSigner(signer.address)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "ValueUnchanged");
        });
    });

    describe("setFinalizeTypeHash", function () {
        it("lets the owner update the typehash and emits TypeHashUpdated", async function () {
            const { tournamentFinalizer, owner } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            const newTypeString =
                "FinalizeTournament(address user,uint256 tournamentId,bytes tournamentData,uint256 point,uint256 score,uint256 nonce,uint256 deadline)";
            const oldHash = ethers.keccak256(ethers.toUtf8Bytes(TYPE_STRING));
            const newHash = ethers.keccak256(ethers.toUtf8Bytes(newTypeString));

            await expect(
                tournamentFinalizer
                    .connect(owner)
                    .setFinalizeTypeHash(newTypeString)
            )
                .to.emit(tournamentFinalizer, "TypeHashUpdated")
                .withArgs(oldHash, newHash);
        });

        it("makes the original signature invalid after the typehash changes", async function () {
            const { tournamentFinalizer, owner, caller, signer } =
                await loadFixture(deployTournamentFinalizerFixture);

            const data = encodeUint16ArrayBE(range(4));
            const nonce = await tournamentFinalizer.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signFinalize(signer, tournamentFinalizer, {
                user: caller.address,
                tournamentId: 1,
                tournamentData: data,
                point: 1,
                nonce,
                deadline,
            });

            await tournamentFinalizer
                .connect(owner)
                .setFinalizeTypeHash(
                    "FinalizeTournament(address user,uint256 tournamentId,bytes tournamentData,uint256 point,uint256 score,uint256 nonce,uint256 deadline)"
                );

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .finalizeTournament(1, data, 1, deadline, signature)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "InvalidSigner");
        });

        it("reverts for a non-owner", async function () {
            const { tournamentFinalizer, caller } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            await expect(
                tournamentFinalizer
                    .connect(caller)
                    .setFinalizeTypeHash("Foo(uint256 bar)")
            ).to.be.revertedWithCustomError(
                tournamentFinalizer,
                "OwnableUnauthorizedAccount"
            );
        });

        it("reverts when the typehash is unchanged (ValueUnchanged)", async function () {
            const { tournamentFinalizer, owner } = await loadFixture(
                deployTournamentFinalizerFixture
            );

            await expect(
                tournamentFinalizer
                    .connect(owner)
                    .setFinalizeTypeHash(TYPE_STRING)
            ).to.be.revertedWithCustomError(tournamentFinalizer, "ValueUnchanged");
        });
    });
});

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { VotePointManager } from "../typechain-types";

// EIP-712 type string baked into the contract at deploy time.
// MUST match PNYX-BE's EIP712_VOTE_TYPES (field order + types).
const TYPE_STRING =
    "Vote(address user,uint256 tournamentId,uint256 itemId,uint256 amount,string option,uint256 nonce,uint256 deadline)";

const VOTE_TYPES = {
    Vote: [
        { name: "user", type: "address" },
        { name: "tournamentId", type: "uint256" },
        { name: "itemId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "option", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
    ],
};

const EIP712_NAME = "VotePointManager";
const EIP712_VERSION = "1";

type VoteFields = {
    user: string;
    tournamentId: number | bigint;
    itemId: number | bigint;
    amount: number | bigint;
    option: string;
    nonce: bigint;
    deadline: bigint;
};

async function deployVotePointManagerFixture() {
    const [owner, caller, signer, other] = await ethers.getSigners();

    const VotePointManager = await ethers.getContractFactory("VotePointManager");
    // `signer` is the authorized EIP-712 signer.
    const votePointManager = await VotePointManager.deploy(
        signer.address,
        TYPE_STRING
    );
    await votePointManager.waitForDeployment();

    return { votePointManager, owner, caller, signer, other };
}

async function buildDomain(votePointManager: VotePointManager) {
    const verifyingContract = await votePointManager.getAddress();
    const { chainId } = await ethers.provider.getNetwork();
    return {
        name: EIP712_NAME,
        version: EIP712_VERSION,
        chainId,
        verifyingContract,
    };
}

async function signVote(
    signerWallet: HardhatEthersSigner,
    votePointManager: VotePointManager,
    fields: VoteFields
): Promise<string> {
    const domain = await buildDomain(votePointManager);
    const value = {
        user: fields.user,
        tournamentId: fields.tournamentId,
        itemId: fields.itemId,
        amount: fields.amount,
        option: fields.option,
        nonce: fields.nonce,
        deadline: fields.deadline,
    };
    return signerWallet.signTypedData(domain, VOTE_TYPES, value);
}

async function futureDeadline(secondsAhead = 3600): Promise<bigint> {
    return BigInt(await time.latest()) + BigInt(secondsAhead);
}

describe("VotePointManager", function () {
    describe("settle (happy path)", function () {
        for (const option of ["bet", "cancel", "reward"]) {
            it(`verifies a valid "${option}" signature, emits Settled, and increments the nonce`, async function () {
                const { votePointManager, caller, signer } = await loadFixture(
                    deployVotePointManagerFixture
                );

                const tournamentId = 1;
                const itemId = 7;
                const amount = 100;
                const nonce = await votePointManager.nonces(caller.address);
                expect(nonce).to.equal(0n);
                const deadline = await futureDeadline();

                const signature = await signVote(signer, votePointManager, {
                    user: caller.address,
                    tournamentId,
                    itemId,
                    amount,
                    option,
                    nonce,
                    deadline,
                });

                const tx = await votePointManager
                    .connect(caller)
                    .settle(tournamentId, itemId, amount, option, deadline, signature);
                const blockTimestamp = await time.latest();

                await expect(tx)
                    .to.emit(votePointManager, "Settled")
                    .withArgs(
                        blockTimestamp,
                        caller.address,
                        tournamentId,
                        itemId,
                        amount,
                        option
                    );

                expect(await votePointManager.nonces(caller.address)).to.equal(1n);
            });
        }

        it("produces a signature that recovers to the authorized signer (cross-check with verifyTypedData)", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();
            const fields: VoteFields = {
                user: caller.address,
                tournamentId: 3,
                itemId: 42,
                amount: 500,
                option: "bet",
                nonce,
                deadline,
            };

            const signature = await signVote(signer, votePointManager, fields);
            const domain = await buildDomain(votePointManager);

            const recovered = ethers.verifyTypedData(
                domain,
                VOTE_TYPES,
                {
                    user: fields.user,
                    tournamentId: fields.tournamentId,
                    itemId: fields.itemId,
                    amount: fields.amount,
                    option: fields.option,
                    nonce: fields.nonce,
                    deadline: fields.deadline,
                },
                signature
            );
            expect(recovered).to.equal(signer.address);
        });

        it("allows distinct users to settle with their own nonces", async function () {
            const { votePointManager, caller, signer, other } = await loadFixture(
                deployVotePointManagerFixture
            );

            const deadline = await futureDeadline();

            for (const user of [caller, other]) {
                const nonce = await votePointManager.nonces(user.address);
                const signature = await signVote(signer, votePointManager, {
                    user: user.address,
                    tournamentId: 1,
                    itemId: 2,
                    amount: 10,
                    option: "bet",
                    nonce,
                    deadline,
                });
                await expect(
                    votePointManager
                        .connect(user)
                        .settle(1, 2, 10, "bet", deadline, signature)
                ).to.emit(votePointManager, "Settled");
                expect(await votePointManager.nonces(user.address)).to.equal(1n);
            }
        });
    });

    describe("settle (rejections)", function () {
        it("reverts with ExpiredSignature when the deadline has passed", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = BigInt(await time.latest()) - 1n; // already in the past

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 10, "bet", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "ExpiredSignature");
        });

        it("reverts with InvalidSigner when signed by an unauthorized account", async function () {
            const { votePointManager, caller, other } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            // `other` is not the authorized signer
            const signature = await signVote(other, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 10, "bet", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");
        });

        it("reverts with InvalidSigner when the caller differs from the signed user", async function () {
            const { votePointManager, caller, signer, other } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(other.address);
            const deadline = await futureDeadline();

            // signature binds user = caller, but `other` sends the tx
            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            await expect(
                votePointManager
                    .connect(other)
                    .settle(1, 2, 10, "bet", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");
        });

        it("reverts with InvalidSigner when the itemId is tampered after signing", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 999, 10, "bet", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");
        });

        it("reverts with InvalidSigner when the amount is tampered after signing", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 999, "bet", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");
        });

        it("reverts with InvalidSigner when the tournamentId is tampered after signing", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            await expect(
                votePointManager
                    .connect(caller)
                    .settle(999, 2, 10, "bet", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");
        });

        it("prevents replay: reusing the same signature reverts (nonce already consumed)", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            await votePointManager
                .connect(caller)
                .settle(1, 2, 10, "bet", deadline, signature);

            // nonce is now 1, so the same signature (over nonce 0) no longer recovers the signer
            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 10, "bet", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");
        });

        it("reverts on a malformed signature", async function () {
            const { votePointManager, caller } = await loadFixture(
                deployVotePointManagerFixture
            );

            const deadline = await futureDeadline();

            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 10, "bet", deadline, "0xdeadbeef")
            ).to.be.reverted;
        });
    });

    describe("settle (option integrity — cross-use blocked)", function () {
        it("reverts with InvalidSigner when a 'bet' signature is submitted as 'reward'", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            // signed with option = "bet"
            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            // submitted with option = "reward"
            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 10, "reward", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");
        });

        it("reverts with InvalidSigner when the option casing differs (\"Bet\" vs \"bet\")", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 10, "Bet", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");
        });
    });

    describe("settle (edge cases — no on-chain value validation)", function () {
        it("processes zero tournamentId / itemId / amount normally", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 0,
                itemId: 0,
                amount: 0,
                option: "cancel",
                nonce,
                deadline,
            });

            const tx = await votePointManager
                .connect(caller)
                .settle(0, 0, 0, "cancel", deadline, signature);
            const blockTimestamp = await time.latest();

            await expect(tx)
                .to.emit(votePointManager, "Settled")
                .withArgs(blockTimestamp, caller.address, 0, 0, 0, "cancel");
        });

        it("accepts an empty option string", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "",
                nonce,
                deadline,
            });

            const tx = await votePointManager
                .connect(caller)
                .settle(1, 2, 10, "", deadline, signature);
            const blockTimestamp = await time.latest();

            await expect(tx)
                .to.emit(votePointManager, "Settled")
                .withArgs(blockTimestamp, caller.address, 1, 2, 10, "");
        });

        it("accepts a max-uint256 amount and a long option string", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const maxUint256 = 2n ** 256n - 1n;
            const longOption = "reward".repeat(50);
            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 65535,
                itemId: 12345,
                amount: maxUint256,
                option: longOption,
                nonce,
                deadline,
            });

            const tx = await votePointManager
                .connect(caller)
                .settle(65535, 12345, maxUint256, longOption, deadline, signature);
            const blockTimestamp = await time.latest();

            await expect(tx)
                .to.emit(votePointManager, "Settled")
                .withArgs(
                    blockTimestamp,
                    caller.address,
                    65535,
                    12345,
                    maxUint256,
                    longOption
                );
        });
    });

    describe("setVoteSigner", function () {
        it("lets the owner update the signer and emits SignerUpdated", async function () {
            const { votePointManager, owner, signer, other } = await loadFixture(
                deployVotePointManagerFixture
            );

            await expect(
                votePointManager.connect(owner).setVoteSigner(other.address)
            )
                .to.emit(votePointManager, "SignerUpdated")
                .withArgs(signer.address, other.address);
        });

        it("makes signatures from the new signer pass and the old signer fail", async function () {
            const { votePointManager, owner, caller, signer, other } =
                await loadFixture(deployVotePointManagerFixture);

            await votePointManager.connect(owner).setVoteSigner(other.address);

            const deadline = await futureDeadline();
            const oldNonce = await votePointManager.nonces(caller.address);

            // old signer now rejected
            const oldSig = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce: oldNonce,
                deadline,
            });
            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 10, "bet", deadline, oldSig)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");

            // new signer accepted
            const newSig = await signVote(other, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce: oldNonce,
                deadline,
            });
            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 10, "bet", deadline, newSig)
            ).to.emit(votePointManager, "Settled");
        });

        it("reverts for a non-owner", async function () {
            const { votePointManager, caller, other } = await loadFixture(
                deployVotePointManagerFixture
            );

            await expect(
                votePointManager.connect(caller).setVoteSigner(other.address)
            ).to.be.revertedWithCustomError(
                votePointManager,
                "OwnableUnauthorizedAccount"
            );
        });

        it("reverts on the zero address", async function () {
            const { votePointManager, owner } = await loadFixture(
                deployVotePointManagerFixture
            );

            await expect(
                votePointManager.connect(owner).setVoteSigner(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(votePointManager, "ZeroAddress");
        });

        it("reverts when set to the current signer (ValueUnchanged)", async function () {
            const { votePointManager, owner, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            await expect(
                votePointManager.connect(owner).setVoteSigner(signer.address)
            ).to.be.revertedWithCustomError(votePointManager, "ValueUnchanged");
        });
    });

    describe("setVoteTypeHash", function () {
        it("lets the owner update the typehash and emits TypeHashUpdated", async function () {
            const { votePointManager, owner } = await loadFixture(
                deployVotePointManagerFixture
            );

            const newTypeString =
                "Vote(address user,uint256 tournamentId,uint256 itemId,uint256 amount,string option,uint256 extra,uint256 nonce,uint256 deadline)";
            const oldHash = ethers.keccak256(ethers.toUtf8Bytes(TYPE_STRING));
            const newHash = ethers.keccak256(ethers.toUtf8Bytes(newTypeString));

            await expect(
                votePointManager.connect(owner).setVoteTypeHash(newTypeString)
            )
                .to.emit(votePointManager, "TypeHashUpdated")
                .withArgs(oldHash, newHash);
        });

        it("makes the original signature invalid after the typehash changes", async function () {
            const { votePointManager, owner, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const nonce = await votePointManager.nonces(caller.address);
            const deadline = await futureDeadline();

            const signature = await signVote(signer, votePointManager, {
                user: caller.address,
                tournamentId: 1,
                itemId: 2,
                amount: 10,
                option: "bet",
                nonce,
                deadline,
            });

            await votePointManager
                .connect(owner)
                .setVoteTypeHash(
                    "Vote(address user,uint256 tournamentId,uint256 itemId,uint256 amount,string option,uint256 extra,uint256 nonce,uint256 deadline)"
                );

            await expect(
                votePointManager
                    .connect(caller)
                    .settle(1, 2, 10, "bet", deadline, signature)
            ).to.be.revertedWithCustomError(votePointManager, "InvalidSigner");
        });

        it("reverts for a non-owner", async function () {
            const { votePointManager, caller } = await loadFixture(
                deployVotePointManagerFixture
            );

            await expect(
                votePointManager.connect(caller).setVoteTypeHash("Foo(uint256 bar)")
            ).to.be.revertedWithCustomError(
                votePointManager,
                "OwnableUnauthorizedAccount"
            );
        });

        it("reverts when the typehash is unchanged (ValueUnchanged)", async function () {
            const { votePointManager, owner } = await loadFixture(
                deployVotePointManagerFixture
            );

            await expect(
                votePointManager.connect(owner).setVoteTypeHash(TYPE_STRING)
            ).to.be.revertedWithCustomError(votePointManager, "ValueUnchanged");
        });
    });

    describe("settle (load)", function () {
        it("processes many sequential settles from one caller with a monotonically increasing nonce", async function () {
            const { votePointManager, caller, signer } = await loadFixture(
                deployVotePointManagerFixture
            );

            const iterations = 100;
            const deadline = await futureDeadline(24 * 3600);

            for (let i = 0; i < iterations; i++) {
                const nonce = await votePointManager.nonces(caller.address);
                expect(nonce).to.equal(BigInt(i));

                const signature = await signVote(signer, votePointManager, {
                    user: caller.address,
                    tournamentId: i,
                    itemId: i + 1,
                    amount: i * 10,
                    option: "bet",
                    nonce,
                    deadline,
                });

                await expect(
                    votePointManager
                        .connect(caller)
                        .settle(i, i + 1, i * 10, "bet", deadline, signature)
                ).to.emit(votePointManager, "Settled");
            }

            expect(await votePointManager.nonces(caller.address)).to.equal(
                BigInt(iterations)
            );
        });
    });
});

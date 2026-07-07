// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract VotePointManager is Ownable, EIP712 {
    // =========================
    // ERROR
    // =========================
    /// @notice Thrown when the signature deadline has passed.
    error ExpiredSignature();
    /// @notice Thrown when the signature cannot be recovered to a valid address.
    error InvalidSignature();
    /// @notice Thrown when the recovered signer is not the authorized signer.
    error InvalidSigner();
    /// @notice Thrown when a zero address is supplied where it is not allowed.
    error ZeroAddress();
    /// @notice Thrown when a setter is called with the value already in storage.
    error ValueUnchanged();

    // =========================
    // STATE
    // =========================
    /// @notice EIP-712 typehash for the Vote struct.
    bytes32 private voteTypeHash;
    /// @notice Address authorized to sign settle payloads.
    address private voteSigner;
    /// @notice Per-user nonce, consumed on each successful settle (replay protection).
    mapping(address => uint256) public nonces;

    // =========================
    // EVENT
    // =========================
    /**
     * @notice Vote settled event
     * @dev Emitted after a settle signature is verified
     * @param timestamp Block timestamp when the vote was settled
     * @param user Caller address (the signed `user`)
     * @param tournamentId Tournament ID
     * @param itemId Item ID
     * @param amount Bet/cancel amount, or reward payout (disambiguated by `option`)
     * @param option Signed intent: "bet" | "cancel" | "reward"
     */
    event Settled(
        uint256 indexed timestamp,
        address indexed user,
        uint256 indexed tournamentId,
        uint256 itemId,
        uint256 amount,
        string option
    );
    /**
     * @notice Emitted when the authorized signer is updated.
     * @param oldSigner The previous signer address
     * @param newSigner The new signer address
     */
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    /**
     * @notice Emitted when the EIP-712 typehash is updated.
     * @param oldHash The previous typehash
     * @param newHash The new typehash
     */
    event TypeHashUpdated(bytes32 oldHash, bytes32 newHash);

    // =========================
    // CONSTRUCTOR
    // =========================
    /**
     * @notice Creates the VotePointManager contract.
     * @param _voteSigner Address authorized to sign settle payloads
     * @param _typeString EIP-712 type string for the Vote struct
     */
    constructor(
        address _voteSigner,
        string memory _typeString
    ) Ownable(msg.sender) EIP712("VotePointManager", "1") {
        if (_voteSigner == address(0)) revert ZeroAddress();

        voteSigner = _voteSigner;
        voteTypeHash = keccak256(bytes(_typeString));
    }

    // =========================
    // WRITE FUNCTION
    // =========================
    /**
     * @notice Settles a vote (bet/cancel/reward) after verifying an EIP-712 signature.
     * @dev Verifies the backend-issued Vote signature over the caller, tournamentId,
     *      itemId, amount, option, the caller's current nonce, and the deadline, then
     *      emits an event. No vote state is stored on-chain besides the nonce bump.
     * @param _tournamentId Tournament ID
     * @param _itemId Item ID
     * @param _amount Bet/cancel amount, or reward payout (disambiguated by `_option`)
     * @param _option Signed intent: "bet" | "cancel" | "reward"
     * @param _deadline Signature expiration timestamp (unix seconds)
     * @param _signature EIP-712 signature produced by the authorized signer
     */
    function settle(
        uint256 _tournamentId,
        uint256 _itemId,
        uint256 _amount,
        string calldata _option,
        uint256 _deadline,
        bytes calldata _signature
    ) external {
        if (block.timestamp > _deadline) revert ExpiredSignature();

        bytes32 structHash = keccak256(
            abi.encode(
                voteTypeHash,
                msg.sender,
                _tournamentId,
                _itemId,
                _amount,
                keccak256(bytes(_option)),
                nonces[msg.sender],
                _deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, _signature);

        if (recoveredSigner == address(0)) revert InvalidSignature();
        if (recoveredSigner != voteSigner) revert InvalidSigner();

        unchecked {
            nonces[msg.sender] += 1;
        }

        emit Settled(
            block.timestamp,
            msg.sender,
            _tournamentId,
            _itemId,
            _amount,
            _option
        );
    }

    // =========================
    // SET FUNCTION
    // =========================
    /**
     * @notice Updates the EIP-712 typehash for the Vote struct.
     * @param _typeString The new type string
     */
    function setVoteTypeHash(string calldata _typeString) external onlyOwner {
        bytes32 newHash = keccak256(bytes(_typeString));
        if (voteTypeHash == newHash) revert ValueUnchanged();

        bytes32 oldHash = voteTypeHash;
        voteTypeHash = newHash;

        emit TypeHashUpdated(oldHash, newHash);
    }

    /**
     * @notice Updates the authorized signer address.
     * @param _voteSigner The new signer address
     */
    function setVoteSigner(address _voteSigner) external onlyOwner {
        if (_voteSigner == address(0)) revert ZeroAddress();
        if (_voteSigner == voteSigner) revert ValueUnchanged();

        address oldSigner = voteSigner;
        voteSigner = _voteSigner;

        emit SignerUpdated(oldSigner, _voteSigner);
    }
}

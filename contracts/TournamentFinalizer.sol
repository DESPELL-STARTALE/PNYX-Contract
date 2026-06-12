// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract TournamentFinalizer is Ownable, EIP712 {
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
    /// @notice EIP-712 typehash for the FinalizeTournament struct.
    bytes32 private finalizeTypeHash;
    /// @notice Address authorized to sign finalizeTournament payloads.
    address private finalizeSigner;
    /// @notice Per-user nonce, consumed on each successful finalize (replay protection).
    mapping(address => uint256) public nonces;

    // =========================
    // EVENT
    // =========================
    /**
     * @notice Tournament finalized event
     * @dev Emitted after a finalizeTournament signature is verified
     * @param timestamp Block timestamp when the tournament was finalized
     * @param user Caller address (the signed `user`)
     * @param tournamentDataHash Tournament data hash (keccak256)
     * @param tournamentId Tournament ID
     * @param tournamentData Tournament data
     */
    event TournamentFinalized(
        uint256 timestamp,
        address indexed user,
        bytes32 indexed tournamentDataHash,
        uint16 tournamentId,
        bytes tournamentData
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
     * @notice Creates the TournamentFinalizer contract.
     * @param _finalizeSigner Address authorized to sign finalizeTournament payloads
     * @param _typeString EIP-712 type string for the FinalizeTournament struct
     */
    constructor(
        address _finalizeSigner,
        string memory _typeString
    ) Ownable(msg.sender) EIP712("TournamentFinalizer", "1") {
        if (_finalizeSigner == address(0)) revert ZeroAddress();

        finalizeSigner = _finalizeSigner;
        finalizeTypeHash = keccak256(bytes(_typeString));
    }

    // =========================
    // WRITE FUNCTION
    // =========================
    /**
     * @notice Finalizes a tournament after verifying an EIP-712 signature.
     * @dev Verifies the backend-issued signature over the caller, tournament data,
     *      point, the caller's current nonce, and the deadline, then emits an event.
     *      No tournament state is stored on-chain.
     * @param _tournamentId Tournament ID
     * @param _tournamentData Tournament data (big-endian packed uint16 item IDs)
     * @param _point Point bound to the signature by the backend
     * @param _deadline Signature expiration timestamp (unix seconds)
     * @param _signature EIP-712 signature produced by the authorized signer
     */
    function finalizeTournament(
        uint16 _tournamentId,
        bytes calldata _tournamentData,
        uint256 _point,
        uint256 _deadline,
        bytes calldata _signature
    ) external {
        if (block.timestamp > _deadline) revert ExpiredSignature();

        bytes32 tournamentDataHash = keccak256(_tournamentData);

        bytes32 structHash = keccak256(
            abi.encode(
                finalizeTypeHash,
                msg.sender,
                _tournamentId,
                tournamentDataHash,
                _point,
                nonces[msg.sender],
                _deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, _signature);

        if (recoveredSigner == address(0)) revert InvalidSignature();
        if (recoveredSigner != finalizeSigner) revert InvalidSigner();

        unchecked {
            nonces[msg.sender] += 1;
        }

        emit TournamentFinalized(
            block.timestamp,
            msg.sender,
            tournamentDataHash,
            _tournamentId,
            _tournamentData
        );
    }

    // =========================
    // SET FUNCTION
    // =========================
    /**
     * @notice Updates the EIP-712 typehash for the FinalizeTournament struct.
     * @param _typeString The new type string
     */
    function setFinalizeTypeHash(
        string calldata _typeString
    ) external onlyOwner {
        bytes32 newHash = keccak256(bytes(_typeString));
        if (finalizeTypeHash == newHash) revert ValueUnchanged();

        bytes32 oldHash = finalizeTypeHash;
        finalizeTypeHash = newHash;

        emit TypeHashUpdated(oldHash, newHash);
    }

    /**
     * @notice Updates the authorized signer address.
     * @param _finalizeSigner The new signer address
     */
    function setFinalizeSigner(address _finalizeSigner) external onlyOwner {
        if (_finalizeSigner == address(0)) revert ZeroAddress();
        if (_finalizeSigner == finalizeSigner) revert ValueUnchanged();

        address oldSigner = finalizeSigner;
        finalizeSigner = _finalizeSigner;

        emit SignerUpdated(oldSigner, _finalizeSigner);
    }
}

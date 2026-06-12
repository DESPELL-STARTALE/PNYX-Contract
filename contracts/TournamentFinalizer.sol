// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

contract TournamentFinalizer is Ownable {
    // def. STRUCT
    /**
     * @notice Item statistics struct
     * @dev Stores winner and runner-up counts
     * @param firstCnt Winner (first place) count
     * @param secondCnt Runner-up (second place) count
     */
    struct ItemStat {
        uint256 firstCnt;
        uint256 secondCnt;
    }

    // def. EVENT
    /**
     * @notice Tournament finalized event
     * @dev Emitted when a tournament is finalized
     * @param user Caller address
     * @param tournamentDataHash Tournament data hash (keccak256)
     * @param tournamentId Tournament ID
     * @param tournamentData Tournament data
     */
    event TournamentFinalized(
        address indexed user,
        bytes32 indexed tournamentDataHash,
        uint16 tournamentId,
        bytes tournamentData
    );

    // def. ERROR
    /**
     * @notice Tournament data validation error
     * @dev Thrown when the tournament data length is not 128
     * @param bytesLength Tournament data length
     */
    error InvalidTournament(uint256 bytesLength);
    /**
     * @notice Item validation error
     * @dev Thrown when an item value is not valid
     * @param value Item value
     */
    error InvalidItem(uint16 value);

    // def. VARIABLE
    /**
     * @notice Theme count mapping
     * @dev Stores theme ID and count
     */
    mapping(uint16 => uint256) public tournamentCnt;
    /**
     * @notice Item statistics mapping
     * @dev Stores theme ID, item ID, and counts
     */
    mapping(uint16 => mapping(uint16 => ItemStat)) public stats;

    // def. CONSTANT

    // def. MODIFIER

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Tournament finalize function
     * @dev Called when a tournament is finalized
     * @param _tournamentId Tournament ID
     * @param _tournamentData Tournament data
     */
    function finalizeTournament(
        uint16 _tournamentId,
        bytes calldata _tournamentData
    ) external {
        uint256 len = _tournamentData.length; // tournament data array length
        require(
            len >= 4 && len <= 2048 && (len & (len - 1)) == 0,
            "Invalid bytes length"
        ); // tournament data length must be between 4 and 2048 and a power of two
        _requireAllUniqueUint16BE(_tournamentData); // every item must be non-negative and unique

        // increment theme count
        tournamentCnt[_tournamentId] += 1;

        // increment winner and runner-up counts
        uint16 first = _readUint16BE(_tournamentData, 0);
        uint256 secondOffset = len / 2;
        uint16 second = _readUint16BE(_tournamentData, secondOffset);
        stats[_tournamentId][first].firstCnt += 1;
        stats[_tournamentId][second].secondCnt += 1;

        // compute tournament data hash
        bytes32 tournamentDataHash = keccak256(_tournamentData);

        emit TournamentFinalized(msg.sender, tournamentDataHash, _tournamentId, _tournamentData);
    }

    /**
     * @notice Every item must be non-negative and unique
     * @dev Every item must be non-negative and unique
     * @param data Tournament data
     */
    function _requireAllUniqueUint16BE(bytes calldata data) internal pure {
        uint256 n = data.length / 2; // participant count
        uint256[256] memory seen; // bitset covering the full 0 .. 2^16-1 range

        for (uint256 i = 0; i < n; i++) {
            // every item must be non-negative and unique
            uint256 off = i * 2;

            // Big-endian: [MSB][LSB]
            uint16 v = _readUint16BE(data, off);

            uint256 wordIndex = uint256(v) >> 8; // high 8 bits (0..255)
            uint256 bitIndex = uint256(v) & 0xFF; // low 8 bits (0..255)
            uint256 mask = 1 << bitIndex;

            uint256 word = seen[wordIndex];
            if ((word & mask) != 0) revert InvalidItem(v);

            seen[wordIndex] = word | mask;
        }
    }

    /**
     * @notice Big-endian: [MSB][LSB]
     * @dev Big-endian: [MSB][LSB]
     * @param data Tournament data
     * @param offset Offset
     * @return v Item ID
     */
    function _readUint16BE(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (uint16 v) {
        v =
            (uint16(uint8(data[offset])) << 8) |
            uint16(uint8(data[offset + 1]));
    }
}

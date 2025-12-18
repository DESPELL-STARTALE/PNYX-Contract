// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

contract TournamentFinalizer is Ownable {
    // def. STRUCT
    struct ItemStat {
        uint256 firstCnt;
        uint256 secondCnt;
    }

    // def. EVENT
    event TournamentFinalized(
        address indexed user,
        uint16 themeId,
        bytes tournamentData
    );

    // def. ERROR
    error InvalidTournament(uint256 bytesLength);
    error InvalidItem(uint16 value);

    // def. VARIABLE
    mapping(uint16 => uint256) public themeCnt;
    mapping(uint16 => mapping(uint16 => ItemStat)) public stats;

    // def. CONSTANT

    // def. MODIFIER

    constructor() Ownable(msg.sender) {}

    function finalizeTournament(
        uint16 _themeId,
        bytes calldata _tournamentData
    ) external {
        uint256 len = _tournamentData.length; // 토너먼트 정보 배열 길이
        if (len != 128) revert InvalidTournament(len); // 토너먼트 정보 배열 길이는 128 (64강 고정)
        _requireAllUniqueUint16BE(_tournamentData); // 모든 아이템은 0이상이며 다른 값을 가지고 있어야 함

        // 테마 횟수 증가
        themeCnt[_themeId] += 1;

        // 우승자와 준우승자 횟수 증가
        uint16 first = _readUint16BE(_tournamentData, 0);
        uint256 secondOffset = len / 2;
        uint16 second = _readUint16BE(_tournamentData, secondOffset);
        stats[_themeId][first].firstCnt += 1;
        stats[_themeId][second].secondCnt += 1;

        emit TournamentFinalized(msg.sender, _themeId, _tournamentData);
    }

    function _requireAllUniqueUint16BE(
        bytes calldata data
    ) internal pure {
        uint256 n = data.length / 2; // 참가자 수
        uint256[256] memory seen; // 0 ~ 2^16-1 까지만 커버할 수 있는 배열

        for (uint256 i = 0; i < n; i++) {
            // 모든 아이템은 0이상이며 다른 값을 가지고 있어야 함
            uint256 off = i * 2;

            // Big-endian: [MSB][LSB]
            uint16 v = _readUint16BE(data, off);

            uint256 wordIndex = uint256(v) >> 8; // 상위 8비트 (0..255)
            uint256 bitIndex = uint256(v) & 0xFF; // 하위 8비트 (0..255)
            uint256 mask = 1 << bitIndex;

            uint256 word = seen[wordIndex];
            if ((word & mask) != 0) revert InvalidItem(v);

            seen[wordIndex] = word | mask;
        }
    }

    function _readUint16BE(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (uint16 v) {
        v =
            (uint16(uint8(data[offset])) << 8) |
            uint16(uint8(data[offset + 1]));
    }
}

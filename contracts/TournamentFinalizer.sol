// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

contract TournamentFinalizer is Ownable {
    // def. STRUCT
    /**
     * @notice 아이템 통계 구조체
     * @dev 우승자와 준우승자 횟수를 저장
     * @param firstCnt 우승자 횟수
     * @param secondCnt 준우승자 횟수
     */
    struct ItemStat {
        uint256 firstCnt;
        uint256 secondCnt;
    }

    // def. EVENT
    /**
     * @notice 토너먼트 종료 이벤트
     * @dev 토너먼트 종료 시 발생
     * @param user 주소
     * @param tournamentDataHash 토너먼트 데이터 해시 (keccak256)
     * @param tournamentId 토너먼트 ID
     * @param tournamentData 토너먼트 데이터
     */
    event TournamentFinalized(
        address indexed user,
        bytes32 indexed tournamentDataHash,
        uint16 tournamentId,
        bytes tournamentData
    );

    // def. ERROR
    /**
     * @notice 토너먼트 데이터 유효성 검사 오류
     * @dev 토너먼트 데이터 길이가 128이 아닐 때 발생
     * @param bytesLength 토너먼트 데이터 길이
     */
    error InvalidTournament(uint256 bytesLength);
    /**
     * @notice 아이템 유효성 검사 오류
     * @dev 아이템 값이 0이상이 아닐 때 발생
     * @param value 아이템 값
     */
    error InvalidItem(uint16 value);

    // def. VARIABLE
    /**
     * @notice 테마 횟수 매핑
     * @dev 테마 ID와 횟수를 저장
     */
    mapping(uint16 => uint256) public tournamentCnt;
    /**
     * @notice 아이템 통계 매핑
     * @dev 테마 ID와 아이템 ID와 횟수를 저장
     */
    mapping(uint16 => mapping(uint16 => ItemStat)) public stats;

    // def. CONSTANT

    // def. MODIFIER

    constructor() Ownable(msg.sender) {}

    /**
     * @notice 토너먼트 종료 함수
     * @dev 토너먼트 종료 시 발생
     * @param _tournamentId 토너먼트 ID
     * @param _tournamentData 토너먼트 데이터
     */
    function finalizeTournament(
        uint16 _tournamentId,
        bytes calldata _tournamentData
    ) external {
        uint256 len = _tournamentData.length; // 토너먼트 정보 배열 길이
        require(
            len >= 4 && len <= 2048 && (len & (len - 1)) == 0,
            "Invalid bytes length"
        ); // 토너먼트 정보 배열 길이는 4 ~ 2048 이며 2의 제곱수여야 함
        _requireAllUniqueUint16BE(_tournamentData); // 모든 아이템은 0이상이며 다른 값을 가지고 있어야 함

        // 테마 횟수 증가
        tournamentCnt[_tournamentId] += 1;

        // 우승자와 준우승자 횟수 증가
        uint16 first = _readUint16BE(_tournamentData, 0);
        uint256 secondOffset = len / 2;
        uint16 second = _readUint16BE(_tournamentData, secondOffset);
        stats[_tournamentId][first].firstCnt += 1;
        stats[_tournamentId][second].secondCnt += 1;

        // 토너먼트 데이터 해시 계산
        bytes32 tournamentDataHash = keccak256(_tournamentData);

        emit TournamentFinalized(msg.sender, tournamentDataHash, _tournamentId, _tournamentData);
    }

    /**
     * @notice 모든 아이템은 0이상이며 다른 값을 가지고 있어야 함
     * @dev 모든 아이템은 0이상이며 다른 값을 가지고 있어야 함
     * @param data 토너먼트 데이터
     */
    function _requireAllUniqueUint16BE(bytes calldata data) internal pure {
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

    /**
     * @notice Big-endian: [MSB][LSB]
     * @dev Big-endian: [MSB][LSB]
     * @param data 토너먼트 데이터
     * @param offset 오프셋
     * @return v 아이템 ID
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

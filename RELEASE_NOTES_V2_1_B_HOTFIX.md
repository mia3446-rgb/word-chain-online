# Word Chain Arena V2.1-B Hotfix

## 수정
- 랜덤 매칭 후 준비 버튼이 작동하지 않던 문제 수정
  - 원인: 서버가 roomMatched 이벤트를 보냈지만 클라이언트가 기존 joinedRoom/roomCreated 흐름을 타지 않아 myRoomCode가 비어 있었음
  - 해결: 랜덤 매칭도 일반 방과 동일하게 roomCreated/joinedRoom 이벤트 사용
- start/ready 버튼에서 현재 방번호를 한 번 더 보정
- 로비 업데이트 패널을 V2.1-B 내용으로 수정

## 유지
- V2.1-B 레벨 보상 시스템 유지
- 기존 상점/업적/랭킹/설정 유지

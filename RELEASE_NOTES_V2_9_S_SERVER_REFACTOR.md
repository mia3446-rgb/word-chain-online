# Word Chain Arena V2.9-S — Server Refactor

- 루트 `server.js`를 최소 실행 진입점으로 축소
- Express/HTTP/Socket.IO 조합을 `server/app.js`로 이동
- Socket.IO 연결 등록 경계를 `server/socketHandlers.js`로 분리
- 인증/암호화, 공용 유틸리티, 플레이어 저장소, 사전 로더를 실제 모듈로 추출
- 방/게임/소셜/상점/컬렉션/업적 이벤트 소유권 모듈 추가
- 프로젝트 루트 기준 public/data/words 경로 호환 유지
- 이벤트명, 이벤트 payload, 게임 규칙, 저장 데이터 형식 변경 없음

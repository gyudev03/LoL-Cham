# Chamlog

개인용 League of Legends 챔피언 숙련도 분석 웹앱입니다. 사용자가 선택한 챔피언의 공식 숙련도와 최근 솔로랭크·자유랭크 전적을 분석합니다.

## 실행

```powershell
npm install
Copy-Item .env.example .env
```

`.env`의 `RIOT_API_KEY`에 [Riot Developer Portal](https://developer.riotgames.com/)에서 발급한 키를 입력한 다음 실행합니다.

```powershell
npm run dev
```

- 웹 화면: `http://localhost:5173`
- API 서버: `http://localhost:8787`

`RIOT_API_KEY`는 서버만 읽습니다. 키를 `VITE_` 환경 변수로 만들거나 Git에 커밋하면 안 됩니다.

## 수동 동기화 범위

사용자가 **데이터 새로고침**을 눌렀을 때만 다음을 갱신합니다.

- Riot ID와 태그를 통한 PUUID 조회
- KR 랭크 정보
- 공식 챔피언 숙련도
- 솔로랭크(420)와 자유랭크(440)의 최근 매치 목록
- 최근 게임을 기반으로 한 챔피언별 개인 통계 및 AI 숙련도

AI 숙련도는 역할별 핵심 지표 50%, 최근 승률 20%, 최근 플레이 빈도 15%, 플레이 횟수 10%, 비교 기준 5%의 내부 가중치를 사용합니다. 메타 티어·카운터·룬은 외부 데이터 수집 규정을 검토한 뒤 별도로 연동합니다.

## 검증

```powershell
npm run build
```

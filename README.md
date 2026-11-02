# 🏮 소원 등불 (Wish Lanterns)

밤 호숫가에서 등불에 한마디를 적어 띄우고, 떠다니는 다른 등불을 읽고 ♡를 보내는 힐링 웹 게임.
점수도 경쟁도 없이, 잠깐 머물다 가는 곳.

- three.js + 절차적 그래픽/사운드 (외부 에셋 없음)
- 등불 색 5종, 30자 한마디(프리셋 문구 제공), 물 위로 / 하늘로
- 다른 등불 읽기 · ♡ 보내기 · 내 화면에서 숨기기, 기록은 브라우저에 저장
- **멀티플레이**: 같은 페이지를 연 사람끼리 하나의 호수를 공유 — 서로의 등불이 실시간으로 떠오르고,
  ♡를 보내면 상대에게 알림이 감. 서버 없이 브라우저끼리 직접 연결(WebRTC, [Trystero](https://github.com/dmotz/trystero)
  + 공개 Nostr 릴레이로 신호 교환)하므로 GitHub Pages 같은 정적 호스팅에서 그대로 동작.
  등불은 지금 접속해 있는 사람들 사이에서만 공유되고 서버에 저장되지 않음.
  일부 회사/모바일 네트워크처럼 직접 연결이 막힌 환경에서는 혼자 모드가 됨(필요하면 TURN 서버 추가).

## GitHub Pages 배포

`main`에 push하면 `.github/workflows/pages.yml`이 빌드해서 Pages로 배포함.
처음 한 번: 저장소를 Public으로 바꾸고 Settings → Pages → Source를 **GitHub Actions**로 선택.

## 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # dist/ 에 정적 빌드
```

설계 문서: `docs/lantern-design.md` · 개발 노트: `NOTES.md`

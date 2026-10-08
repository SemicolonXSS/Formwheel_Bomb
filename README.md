# Formwheel_Bomb

폭탄을 넘기며 제한 시간 안에 살아남는 멀티 게임.

- 실행: https://semicolonxss.github.io/Formwheel_Bomb/
- 프로젝트 목록: https://semicolonxss.github.io/Formwheel/
- 진행 상태: https://semicolonxss.github.io/Formwheel_Check/

## 사용

브라우저에서 실행 링크를 여세요. 화면에 표시된 설명과 버튼으로 진행합니다. 온라인 기능은 Firebase 연결이 필요하며, 방 게임은 같은 코드로 참가합니다. 로컬 저장은 현재 브라우저에만 남습니다.

## 2026-10-08 개선

폭탄 넘기기/폭발의 만료 시각 경계, 중복 폭발, 최종 생존자 회귀 테스트를 추가했습니다.

## 개발 및 검증

정적 HTML/JavaScript 프로젝트입니다. HTTP 서버로 제공하세요. Firebase 운영 설정·Rules는 이 저장소의 화면 파일만 배포해서 바뀌지 않습니다.

```sh
node scripts/check-syntax.cjs
node tests/regression.test.cjs
```

첫 검사는 JavaScript 구문과 상대경로 파일 존재를 확인합니다. 모든 앱의 실제 멀티플레이와 운영 권한을 보증하는 검사는 아닙니다.

## 데이터 및 운영 보안

공통 안내: https://semicolonxss.github.io/Formwheel/privacy.html

닉네임·답안·점수·채팅 등이 서버에 저장될 수 있습니다. 새 보안 스키마와 서버 코드는 [Formwheel/firebase-security](https://github.com/SemicolonXSS/Formwheel/tree/main/firebase-security)에 준비했습니다. 현재 운영 적용 및 기존 경로 전환이 완료되었다고 가정하지 마세요. 계정/제공자 설정, 서버 보안 검증이 필요한 항목은 Check에서 별도로 남겨둡니다.

화면 마크업은 `index.html`, 앱별 스타일과 실행 코드는 `assets/`에 분리했습니다. 공통 UI는 Formwheel 저장소의 `shared/`를 사용합니다.

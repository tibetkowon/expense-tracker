# 가계부 (Expense Tracker)

개인용 지출 관리 앱. Google Sheets를 유일한 저장소로 써서 본인 Google Drive 안에 지출 내역을 정리합니다. 서버 데이터베이스 없음 — 모든 데이터는 사용자 본인의 Google 계정 안에 있습니다.

## 주요 기능

- **지출 수동 입력/수정/삭제** — 날짜, 금액, 카테고리, 메모, 결제수단. 월별 시트 탭으로 자동 관리.
- **영수증 사진 OCR** — 영수증 사진을 올리면 Vertex AI(Gemini)가 날짜/금액/가맹점/카테고리를 읽어 폼에 초안으로 채워줍니다. **자동 저장은 하지 않으며**, 항상 사람이 확인 후 저장.
- **결제 알림 자동 캡처 (iOS 단축어 연동)** — iOS 27 단축어의 알림 캡처 기능으로 카드/은행 결제 알림을 서버에 보내면, Vertex AI가 파싱해 "확인 대기" 목록에 쌓입니다. 결제할 때마다 화면이 뜨지 않고, 원하는 시점에 몰아서 확인 후 저장(또는 취소 거래 리마인더 확인). 입금/홍보성 알림은 자동으로 걸러짐.
- **결제수단 자동 등록** — 새 결제수단을 입력해서 저장하면 다음부터 자동완성 목록에 나타남.
- **Drive 폴더/파일명 관리** — 지출 스프레드시트를 저장할 폴더와 파일명을 앱에서 직접 선택/변경 가능.
- **PWA** — 아이폰에서 "홈 화면에 추가"로 앱처럼 사용 가능.

## 기술 스택

- Next.js (App Router) + TypeScript, Vercel 배포
- NextAuth(Auth.js) v5, Google OAuth (`drive.file` + `drive.readonly` + `spreadsheets` 스코프)
- Google Sheets API — 유일한 영구 저장소 (서버 DB 없음)
- `@ai-sdk/google-vertex` — Vertex AI Gemini 기반 영수증/알림 텍스트 파싱
- Vitest + Testing Library

## 시작하기 (로컬 개발)

```bash
npm install
cp .env.local.example .env.local   # 아래 "환경변수" 참고해서 값 채우기
npm run dev
```

### 환경변수

`.env.local.example`에 있는 항목들:

| 변수 | 용도 |
|---|---|
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth 클라이언트 (로그인 + Drive/Sheets 접근) |
| `AUTH_SECRET` | NextAuth 세션 암호화 키 (`npx auth secret`으로 생성) |
| `NEXT_PUBLIC_GOOGLE_API_KEY` | Google Picker(폴더 선택 UI)용 API 키 |
| `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_VERTEX_CREDENTIALS` | 영수증 OCR용 Vertex AI 서비스 계정. `GOOGLE_VERTEX_LOCATION`은 반드시 `global` (특정 리전 아님 — `gemini-3.5-flash-lite`가 리전별 엔드포인트에서 안 열림) |
| `SHORTCUT_SERVICE_ACCOUNT_CREDENTIALS`, `SHORTCUT_SERVICE_ACCOUNT_EMAIL` | 알림 자동 캡처용 별도 서비스 계정 (Vertex AI 계정과는 다른, Drive/Sheets 전용 계정) |
| `SHORTCUT_API_KEY` | iOS 단축어 → 서버 호출 인증용 임의의 비밀 문자열 (직접 생성, 예: `openssl rand -hex 32`) |

각 서비스 계정을 만드는 법은 아래 "결제 알림 자동 캡처 설정" 참고.

### 개발 명령어

```bash
npm run dev              # 로컬 개발 서버 (Turbopack)
npm run test             # 전체 테스트 (Vitest)
npm run lint             # ESLint
npx next build --webpack # 프로덕션 빌드 검증 (Codex 샌드박스에서 Turbopack 대신 이걸 씀)
```

## 앱 사용 흐름

1. **로그인** — Google 계정으로 로그인.
2. **저장 위치 설정 (최초 1회, 선택)** — 설정에서 지출 스프레드시트를 저장할 Drive 폴더와 파일명을 지정. 안 하면 "내 드라이브"에 기본 파일명으로 자동 생성됨.
3. **지출 입력** — 폼에 직접 입력하거나, 영수증 사진을 올려 자동 채워진 값을 확인 후 저장.
4. **월별 조회/수정/삭제** — 상단 월 선택기로 지난 달 내역 확인, 각 항목 수정/삭제 가능.
5. **(선택) 결제 알림 자동 캡처 연동** — 아래 안내대로 설정하면, 카드 결제할 때마다 직접 입력할 필요 없이 알림에서 자동으로 초안이 쌓입니다.

## 결제 알림 자동 캡처 설정

설계 배경과 상세 구현은 `docs/superpowers/specs/2026-09-18-notification-capture-design.md`와 관련 플랜 문서 참고. 여기서는 실제로 켜는 방법만 정리합니다.

### 1) 서비스 계정 준비 (최초 1회, GCP 콘솔)

1. [GCP 콘솔](https://console.cloud.google.com) → 기존 OAuth 로그인에 쓰는 프로젝트 선택(Drive/Sheets API가 이미 켜져 있을 가능성이 높음. 안 켜져 있으면 API 및 서비스 → 라이브러리에서 "Google Drive API", "Google Sheets API" 사용 설정).
2. IAM 및 관리자 → 서비스 계정 → 새로 만들기 (예: `expense-tracker-shortcuts`). 프로젝트 IAM 역할은 필요 없음(파일 공유로 권한을 주기 때문).
3. 키 → JSON 키 발급 → 다운로드.
4. 이 JSON 전체를 `SHORTCUT_SERVICE_ACCOUNT_CREDENTIALS`에, 이메일 주소(`client_email` 값)를 `SHORTCUT_SERVICE_ACCOUNT_EMAIL`에 등록.
5. `SHORTCUT_API_KEY`는 임의의 긴 문자열을 직접 정해서 등록 (`openssl rand -hex 32`).
6. Vercel Production/Preview 환경변수에 세 값을 등록하고 재배포.

### 2) 앱에서 시트 공유 켜기

배포된 앱에 로그인 → 대시보드의 **"단축어 연동 켜기"** 버튼 클릭. 지금 쓰고 있는 지출 스프레드시트 파일을 서비스 계정과 "편집자"로 공유하는 동작이며, 그 파일 하나에만 권한이 생깁니다. 나중에 끄고 싶으면 그 시트 파일의 공유 설정에서 서비스 계정을 빼면 즉시 끊깁니다.

### 3) Vercel Deployment Protection 우회 토큰 확인

배포에 Vercel의 Deployment Protection(SSO)이 켜져 있으면, 외부에서 오는 단축어 요청이 우리 앱 인증 이전에 막힙니다. Vercel 프로젝트 → Settings → Deployment Protection → **Protection Bypass for Automation**에서 토큰을 발급/확인하세요. (프로젝트에 보호가 꺼져 있다면 이 단계는 필요 없습니다.)

### 4) iOS 단축어 만들기

1. 단축어 앱 → **자동화** 탭 → **+** → **앱** → "알림을 받을 때" → 감시할 카드/은행 앱 선택.
2. 다음 화면에서 **"실행 전 확인"을 끄기** (완전 백그라운드로 동작하게).
3. 알림의 **앱 이름**, **내용**을 변수로 뽑아온 뒤, **"URL의 콘텐츠 가져오기"** 액션 추가:
   - **URL**: `https://<배포 도메인>/api/shortcuts/parse`
   - **방법**: POST
   - **머리글**:
     - `Content-Type`: `application/json`
     - `x-shortcut-api-key`: (위에서 만든 `SHORTCUT_API_KEY` 값)
     - `x-vercel-protection-bypass`: (3단계에서 확인한 토큰 — 프로젝트에 보호가 꺼져 있으면 생략)
   - **요청 본문(JSON)**:
     - `appName`: 알림의 앱 이름 변수
     - `text`: 알림의 내용 변수
4. 응답은 따로 처리할 필요 없음(알림을 띄우지 않는 설계).

### 5) 확인

- 단축어를 "지금 실행"으로 테스트하거나 실제 결제를 기다린 뒤, 앱을 열어 **"확인 대기"** 섹션(이번 달 합계와 영수증 업로드 사이)에 항목이 뜨는지 확인. 항목이 없으면 섹션 자체가 안 보입니다.
- **결제** 항목: 눌러서 내용 확인/수정 후 저장하면 실제 지출로 기록되고 대기 목록에서 사라짐. "무시"를 누르면 기록 없이 삭제.
- **취소** 항목: 원거래를 자동으로 찾아 지우지 않습니다 — 안내 문구를 보고 기존 지출 목록에서 직접 찾아 삭제한 뒤 "확인"을 눌러 리마인더만 지웁니다.
- 입금 알림과 홍보/로그인/보안 알림 등 실제 거래가 아닌 알림은 자동으로 걸러지고 대기 목록에 올라오지 않습니다.

## 참고 문서

- `docs/superpowers/specs/` — 기능별 설계 배경과 결정 이유
- `docs/superpowers/plans/` — 구현 태스크 단위 계획과 진행 상태
- `CLAUDE.md` — 프로젝트 제약사항, 아키텍처 메모, 개발 워크플로(Claude Code + Codex)

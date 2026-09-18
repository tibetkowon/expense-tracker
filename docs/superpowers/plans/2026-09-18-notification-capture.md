# 결제 알림 자동 캡처 — 구현 계획

> **실행 방식 안내 (이 프로젝트 전용):** `2026-09-08-payment-method-management.md` 계획과 동일하게, 아래 태스크는 `superpowers:subagent-driven-development`/`superpowers:executing-plans`가 아니라 **각 태스크를 하나씩 `codex-auto` 스킬에 위임**하는 방식으로 실행한다. 구현 코드는 미리 적지 않고, Codex가 구현을 결정할 수 있도록 정확한 인터페이스/요구사항/테스트 시나리오만 명시한다. Codex 샌드박스는 네트워크가 없으므로, 실제 Vertex AI 호출과 실제 Google Drive/Sheets 공유 동작 검증은 Codex의 단위 테스트(모킹)로 커버하고, 실제 API 연동 검증은 Claude Code가 별도로 수행한다.

**Goal:** iOS 단축어가 백그라운드에서 캡처한 카드/은행 결제 알림 텍스트를 서버가 파싱해 스프레드시트의 `대기` 탭에 초안으로 쌓고, 사용자는 앱을 열 때 원하는 시점에 몰아서 확인/저장(또는 취소 리마인더 확인)할 수 있게 한다.

**Architecture:** 단축어 → API 키로 인증하는 신규 라우트(`/api/shortcuts/parse`) → 기존 영수증 OCR과 동일한 Vertex AI Gemini 모델로 텍스트 파싱 → 사용자 세션과 무관하게 항상 쓰기 가능해야 하므로 별도 구글 서비스 계정으로 `대기` 탭에 기록. 사용자는 브라우저 세션(기존 방식)으로 `대기` 탭을 읽고/확인/삭제한다. 서비스 계정에게 스프레드시트 편집 권한을 주는 것은 사용자가 앱 내 버튼으로 1회 수행(기존 `drive.file` 스코프로 충분, 새 OAuth 스코프 없음).

**Tech Stack:** Next.js App Router, googleapis (Sheets/Drive API v4), `@ai-sdk/google-vertex` + `ai`(Vertex AI Gemini), Zod, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-18-notification-capture-design.md`

## Global Constraints

- 새 OAuth 스코프를 요청하지 않는다 — 서비스 계정 공유는 기존 `drive.file` 권한으로 수행한다 (스펙 §3).
- 알림(푸시)을 보내지 않는다 — `/api/shortcuts/parse`는 어떤 경우에도 사용자에게 보여줄 알림 텍스트를 만들지 않는다 (스펙 §2).
- 취소 항목은 리마인더로만 동작한다 — 원거래를 자동으로 찾아 매칭/삭제/상쇄하는 로직을 만들지 않는다 (스펙 §9).
- `대기` 탭에는 파싱이 실패/애매해도 항상 원문(`원문` 컬럼)과 함께 한 줄이 올라간다 — 조용히 버리지 않는다 (스펙 §2, §8).
- 같은 원문 텍스트가 이미 `대기` 탭에 있으면 새로 추가하지 않는다 (스펙 §4).
- `lib/pending.ts`의 함수들은 **사용자 세션(accessToken)과 서비스 계정(JWT) 양쪽에서 호출되므로**, 기존 `lib/sheets.ts`/`lib/drive.ts`의 "매 파일마다 비공개 `authClient(accessToken)` 헬퍼로 accessToken 문자열만 받는" 관례를 그대로 따르지 않는다. 대신 각 함수는 실제 호출되는 자격증명 종류에 맞는 타입을 그대로 받는다 — `readPendingRows`/`deletePendingRow`는 `accessToken: string`(세션 전용 호출), `appendPendingRow`는 `auth: InstanceType<typeof google.auth.JWT>`(서비스 계정 전용 호출)를 받는다. 이건 실제 호출 그래프상 이 함수들이 각각 정확히 한 종류의 자격증명으로만 호출되기 때문이며(Task 1 설명 참고), 불필요하게 유니온 타입을 만들지 않기 위한 의도적 설계다.

---

## 사용자가 먼저 해야 할 일 (Task 3, 4 구현 전 필요)

Codex는 GCP 콘솔 작업이나 실제 네트워크 호출을 할 수 없으므로, 아래는 사용자(또는 Claude Code가 사용자 대신 안내)가 미리 준비해야 한다:

1. GCP 콘솔 → IAM & 관리자 → 서비스 계정 → 새 서비스 계정 생성 (예: `expense-tracker-shortcuts`). 프로젝트 IAM 역할은 부여하지 않아도 된다 — Drive/Sheets 파일 접근은 IAM 역할이 아니라 "그 파일을 이 계정과 공유했는지"로 결정되기 때문이다.
2. 키 발급(JSON) → Vercel 환경변수 `SHORTCUT_SERVICE_ACCOUNT_CREDENTIALS`에 JSON 원문으로 등록.
3. 같은 서비스 계정의 이메일 주소를 `SHORTCUT_SERVICE_ACCOUNT_EMAIL` 환경변수로 등록.
4. 임의의 긴 무작위 문자열을 하나 정해 `SHORTCUT_API_KEY` 환경변수로 등록 — 이후 iOS 단축어의 요청 헤더에 그대로 붙여넣을 값이다.
5. `.env.local.example`에도 위 세 변수의 빈 줄을 추가해 둔다(Task 3에서 같이 처리).
6. Task 4 구현·배포 완료 후, 앱의 "단축어 연동 켜기" 버튼을 한 번 눌러 스프레드시트를 서비스 계정과 공유해야 Task 3의 엔드포인트가 실제로 쓰기에 성공한다.

이 문서는 iOS 단축어 앱 내부 구성(자동화 트리거, "URL 콘텐츠 가져오기" 액션 설정)은 다루지 않는다 — Task 3 구현이 끝나면 실제 엔드포인트 URL/헤더/바디 형식을 정리해 별도로 안내한다 (스펙 §11).

---

### Task 1: 대기 탭 데이터 레이어 (`lib/pending.ts`)

**Files:**
- Create: `lib/pending.ts`
- Create: `lib/pending.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PENDING_SHEET_TITLE = '대기';

  export type PendingRow = {
    date: string;
    amount: number;
    category: string;
    memo: string;
    method: string;
    type: '결제' | '취소';
    rawText: string;
  };
  export type PendingRowWithNumber = PendingRow & { rowNumber: number };

  export async function readPendingRows(
    accessToken: string,
    spreadsheetId: string
  ): Promise<PendingRowWithNumber[]>;

  export async function deletePendingRow(
    accessToken: string,
    spreadsheetId: string,
    rowNumber: number
  ): Promise<void>;

  export async function appendPendingRow(
    auth: InstanceType<typeof google.auth.JWT>, // `import { google } from 'googleapis'`
    spreadsheetId: string,
    row: PendingRow
  ): Promise<{ added: boolean }>;
  ```

**Definition of Done:**
- [ ] 헤더 행은 `['날짜', '금액', '카테고리', '메모', '결제수단', '유형', '원문']` (A:G), `lib/sheets.ts`의 `ensureMonthSheet`(`lib/sheets.ts:48-104`)와 동일한 2단계 멱등 패턴(`addSheet` → 헤더 없을 때만 `values.update(A1:G1)`)을 내부 헬퍼로 구현해 `appendPendingRow`가 쓰기 전에 호출한다. `readPendingRows`/`deletePendingRow`는 시트를 새로 만들지 않는다(읽기/삭제는 존재 여부만 확인).
- [ ] `readPendingRows`: `google.auth.OAuth2()` + `setCredentials({access_token: accessToken})`로 클라이언트를 만든다(기존 `lib/sheets.ts:14-18`, `lib/drive.ts:10-14`와 동일한 패턴, 이 파일 안에 비공개로 구현). `대기` 탭이 없으면 빈 배열을 반환한다(에러를 던지지 않음 — 알림을 한 번도 못 받은 사용자에게 정상 상태). 있으면 `대기!A2:G` 범위를 읽어 `rowNumber`(2부터 시작)와 함께 반환한다. `readExpenseRows`(`lib/sheets.ts:255-277`)와 동일한 매핑 스타일을 따른다.
- [ ] `deletePendingRow`: 같은 방식으로 OAuth2 클라이언트를 만든다. `대기` 탭이 없으면 `Error('대기 시트를 찾을 수 없습니다')`를 던진다(`deleteExpenseRow`, `lib/sheets.ts:226-253`과 동일한 관례). `deleteDimension`으로 해당 행만 삭제한다.
- [ ] `appendPendingRow`: 파라미터로 받은 `auth`(서비스 계정 JWT)를 그대로 `google.sheets({version:'v4', auth})`에 넘긴다(이 함수는 자체적으로 인증 클라이언트를 만들지 않는다 — 호출자가 이미 만들어서 넘긴다). 먼저 `대기` 탭 헤더를 보장한 뒤, 기존 행들의 `원문` 컬럼을 읽어 `row.rawText`와 정확히 일치하는 값이 있으면 아무것도 쓰지 않고 `{ added: false }`를 반환한다(중복 방지, 스펙 §4). 없으면 `values.append`로 `[row.date, row.amount, row.category, row.memo, row.method, row.type, row.rawText]`를 추가하고 `{ added: true }`를 반환한다.
- [ ] `lib/pending.test.ts`에서 `lib/sheets.test.ts`(파일 상단의 `vi.mock('googleapis', ...)` 패턴)와 동일하게 `googleapis`를 모킹한다. `google.auth.JWT`도 모킹 대상에 추가해야 한다(`vi.fn(function JWT() { return {}; })` 형태). 다음 시나리오를 테스트한다:
  - `readPendingRows`가 `대기` 탭이 없을 때 빈 배열을 반환한다.
  - `readPendingRows`가 값이 있을 때 `rowNumber`를 2부터 채워 순서대로 반환한다.
  - `appendPendingRow`가 `대기` 탭이 없을 때 헤더를 먼저 쓴다.
  - `appendPendingRow`가 동일한 `rawText`를 가진 기존 행이 있으면 `values.append`를 호출하지 않고 `{ added: false }`를 반환한다.
  - `appendPendingRow`가 새 `rawText`면 7개 컬럼 순서대로 `values.append`를 호출하고 `{ added: true }`를 반환한다.
  - `deletePendingRow`가 `대기` 탭이 없으면 에러를 던진다.
  - `deletePendingRow`가 올바른 `sheetId`/`startIndex`/`endIndex`로 `batchUpdate`를 호출한다.
- [ ] `npm run test -- lib/pending.test.ts`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- lib/pending.test.ts`로 신규 테스트 먼저 확인 후 `npm run test` 전체 회귀 확인.

---

### Task 2: 알림 텍스트 파싱 (`lib/notificationParse.ts`)

**Files:**
- Create: `lib/notificationParse.ts`
- Create: `lib/notificationParse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type NotificationExtraction = {
    type: '결제' | '입금' | '취소' | null;
    date: string | null;
    amount: number | null;
    merchant: string | null;
    categoryGuess: string | null;
    method: string | null;
  };

  export async function extractNotificationData(
    appName: string,
    text: string
  ): Promise<NotificationExtraction>;
  ```

**Definition of Done:**
- [ ] `lib/ocr.ts`(`lib/ocr.ts:1-44`)와 정확히 동일한 구조를 따른다: `createVertex({ project: process.env.GOOGLE_VERTEX_PROJECT, location: process.env.GOOGLE_VERTEX_LOCATION, googleAuthOptions: { credentials: JSON.parse(process.env.GOOGLE_VERTEX_CREDENTIALS!) } })` + `generateText({ model: vertex('gemini-3.5-flash-lite'), output: Output.object({ schema }) })`. **같은 Vertex AI 프로젝트/자격증명을 재사용한다** — 이 파싱을 위한 별도 GCP 설정은 필요 없다(영수증 OCR과 다른 용도지만 같은 Vertex AI 연결).
- [ ] Zod 스키마(`NotificationSchema`)는 각 필드에 `.describe()`로 한국어 은행/카드 알림 문맥을 명시한다. 특히 `type` 필드 설명에 다음을 포함한다: "결제/승인/출금은 '결제', 입금/입금완료는 '입금', 승인취소/취소/환불은 '취소'로 분류하라. 애매하면 '결제'로 분류하라." — 스펙 §4가 "파싱 실패해도 항상 대기 탭에 올린다"고 결정했으므로, 모델이 애매한 경우 조용히 `null`을 반환하기보다 안전한 기본값(`결제`)을 고르도록 프롬프트 단계에서 유도한다.
- [ ] `messages`는 이미지 파트 없이 텍스트 파트 하나만 사용한다: `content: [{ type: 'text', text: '앱 이름: ${appName}\n알림 원문: ${text}\n\n이 결제/계좌 알림에서 거래 유형, 날짜(YYYY-MM-DD), 금액(원, 숫자만), 가맹점명, 한국어 카테고리 추정, 결제수단을 추출해줘. 읽을 수 없는 필드는 null로 남겨줘.' }]`.
- [ ] `lib/notificationParse.test.ts`는 `lib/ocr.test.ts`(`lib/ocr.test.ts:1-74`)와 동일한 모킹 패턴(`vi.mock('@ai-sdk/google-vertex', ...)`, `vi.mock('ai', ...)`, `vi.stubEnv`)을 사용한다. 다음 시나리오를 테스트한다:
  - 모델이 `type: '결제'`와 모든 필드를 채워 반환하면 그대로 반환된다.
  - 모델이 일부 필드를 `null`로 반환하면 그대로 전달된다(값을 가공하지 않음).
  - `createVertex`/`vertex('gemini-3.5-flash-lite')`가 `lib/ocr.ts`와 동일한 인자로 호출된다.
- [ ] `npm run test -- lib/notificationParse.test.ts`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- lib/notificationParse.test.ts` 확인 후 전체 회귀 확인. (실제 Vertex AI 호출 검증은 Task 3 완료 후 Claude Code가 수행.)

---

### Task 3: 서비스 계정 인증 + `/api/shortcuts/parse` 라우트

**Files:**
- Create: `lib/serviceAccount.ts`
- Create: `lib/serviceAccount.test.ts`
- Create: `app/api/shortcuts/parse/route.ts`
- Create: `app/api/shortcuts/parse/route.test.ts`
- Modify: `.env.local.example` (`SHORTCUT_SERVICE_ACCOUNT_CREDENTIALS=`, `SHORTCUT_SERVICE_ACCOUNT_EMAIL=`, `SHORTCUT_API_KEY=` 추가)

**Interfaces:**
- Consumes: Task 1의 `appendPendingRow(auth, spreadsheetId, row)`, Task 2의 `extractNotificationData(appName, text)`.
- Produces:
  ```ts
  // lib/serviceAccount.ts
  export function getServiceAccountAuth(): InstanceType<typeof google.auth.JWT>; // `import { google } from 'googleapis'`
  export async function findServiceAccountSpreadsheetId(
    auth: InstanceType<typeof google.auth.JWT>
  ): Promise<string | null>;
  ```

**Definition of Done:**
- [ ] `getServiceAccountAuth()`는 `process.env.SHORTCUT_SERVICE_ACCOUNT_CREDENTIALS`를 `JSON.parse`해서 `new google.auth.JWT({ email: credentials.client_email, key: credentials.private_key, scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'] })`를 반환한다.
- [ ] `findServiceAccountSpreadsheetId(auth)`는 `google.drive({version:'v3', auth})`로 `lib/sheets.ts`의 canonical 파일 조회와 동일한 쿼리(`lib/sheets.ts:302-306`, `appProperties has { key='expenseTrackerCanonical' and value='true' } and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`)를 실행한다. 파일을 찾으면 그 `id`를, 못 찾으면(서비스 계정이 아직 어떤 파일과도 공유되지 않음) `null`을 반환한다 — **새 파일을 만들지 않는다** (서비스 계정은 파일을 생성할 권한도 이유도 없다).
- [ ] `app/api/shortcuts/parse/route.ts`의 `POST` 핸들러:
  1. 요청 헤더 `x-shortcut-api-key`가 `process.env.SHORTCUT_API_KEY`와 정확히 일치하는지 확인한다. 불일치/누락이면 `NextResponse.json({ error: '인증에 실패했습니다.' }, { status: 401 })`.
  2. Body `{ appName: string, text: string }`를 파싱한다. `text`가 빈 문자열이거나 없으면 `400`.
  3. `extractNotificationData(appName, text)` 호출을 `try/catch`로 감싼다. 실패하면 `NextResponse.json({ error: '알림 파싱 중 오류가 발생했습니다.' }, { status: 500 })` (`app/api/ocr/route.ts:16-24`와 동일한 관례 — 에러를 삼키지 않음).
  4. `extraction.type === '입금'`이면 아무것도 쓰지 않고 `NextResponse.json({ ok: true, skipped: true, reason: 'deposit' })`를 반환한다.
  5. `const pendingType: '결제' | '취소' = extraction.type === '취소' ? '취소' : '결제';` (null이거나 '결제'면 '결제'로 처리 — Global Constraints 참고).
  6. `const auth = getServiceAccountAuth(); const spreadsheetId = await findServiceAccountSpreadsheetId(auth);` — `spreadsheetId`가 `null`이면 `NextResponse.json({ error: '스프레드시트가 아직 서비스 계정과 공유되지 않았습니다.' }, { status: 500 })`를 반환한다(이 문구로 "아직 연동 안 됨" 상태를 구분 가능하게 한다).
  7. `appendPendingRow(auth, spreadsheetId, { date: extraction.date ?? '', amount: extraction.amount ?? 0, category: extraction.categoryGuess ?? '', memo: extraction.merchant ?? '', method: extraction.method ?? '', type: pendingType, rawText: text })`를 호출하고 `NextResponse.json({ ok: true })`를 반환한다.
- [ ] `.env.local.example`에 `SHORTCUT_SERVICE_ACCOUNT_CREDENTIALS=`, `SHORTCUT_SERVICE_ACCOUNT_EMAIL=`, `SHORTCUT_API_KEY=` 세 줄을 추가한다(기존 `GOOGLE_VERTEX_*` 줄 근처).
- [ ] `lib/serviceAccount.test.ts`: `googleapis`를 모킹해 `getServiceAccountAuth`가 올바른 `email`/`key`/`scopes`로 `google.auth.JWT`를 생성하는지, `findServiceAccountSpreadsheetId`가 올바른 쿼리로 `drive.files.list`를 호출하고 결과가 없을 때 `null`을 반환하는지 테스트한다.
- [ ] `app/api/shortcuts/parse/route.test.ts`: `lib/serviceAccount.ts`, `lib/notificationParse.ts`, `lib/pending.ts`를 모두 모킹해서 다음을 테스트한다:
  - API 키 헤더가 없거나 틀리면 401, `extractNotificationData`가 호출되지 않는다.
  - `extraction.type === '입금'`이면 `appendPendingRow`가 호출되지 않고 `{ ok: true, skipped: true, reason: 'deposit' }`가 반환된다.
  - `extraction.type === '취소'`면 `type: '취소'`로 `appendPendingRow`가 호출된다.
  - `extraction.type === null`이면 `type: '결제'`로 `appendPendingRow`가 호출된다.
  - `findServiceAccountSpreadsheetId`가 `null`을 반환하면 500과 "공유되지 않았습니다" 문구가 포함된 에러가 반환된다.
  - `extractNotificationData`가 reject하면 500이 반환된다.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- lib/serviceAccount.test.ts app/api/shortcuts/parse/route.test.ts` 확인 후 전체 회귀. 실제 Vertex AI/서비스 계정 자격증명을 이용한 실제 호출 검증(네트워크 필요)은 Codex 완료 후 Claude Code가 수행한다(`CLAUDE.md` "Codex 환경 제약" 참고).

---

### Task 4: `/api/shortcuts/link-sheet` 라우트 + "단축어 연동 켜기" 설정 UI

**Files:**
- Modify: `lib/sheets.ts` (신규 함수 `shareSpreadsheetWithServiceAccount` 추가)
- Modify: `lib/sheets.test.ts`
- Create: `app/api/shortcuts/link-sheet/route.ts`
- Create: `app/api/shortcuts/link-sheet/route.test.ts`
- Modify: `components/FileNameSetting.tsx` — 근처에 새 버튼 컴포넌트를 추가하거나, 신규 `components/ShortcutLinkButton.tsx`를 만들어 같은 설정 영역에 배치한다(어느 쪽이든 기존 설정 UI 레이아웃과 일관되게 스타일링).
- Modify: `components/ExpenseDashboard.tsx` (새 버튼 컴포넌트를 렌더링, `dataSource` 전달)

**Interfaces:**
- Produces: `lib/sheets.ts`에 `export async function shareSpreadsheetWithServiceAccount(accessToken: string, spreadsheetId: string, serviceAccountEmail: string): Promise<void>`.
- Consumes: 기존 `findOrCreateSpreadsheet`(`lib/sheets.ts:294-342`).

**Definition of Done:**
- [ ] `shareSpreadsheetWithServiceAccount`는 기존 파일 내 비공개 `authClient(accessToken)`(`lib/sheets.ts:14-18`)로 OAuth2 클라이언트를 만들고, `google.drive({version:'v3', auth})`로 `drive.permissions.create({ fileId: spreadsheetId, sendNotificationEmail: false, requestBody: { type: 'user', role: 'writer', emailAddress: serviceAccountEmail } })`를 호출한다.
- [ ] `app/api/shortcuts/link-sheet/route.ts`의 `POST` 핸들러:
  1. `session = await auth()`; `session?.accessToken` 없으면 401.
  2. Body `{ folderId?: string, fileName?: string }`.
  3. `process.env.SHORTCUT_SERVICE_ACCOUNT_EMAIL`이 없으면 `NextResponse.json({ error: '서비스 계정 이메일이 설정되지 않았습니다.' }, { status: 500 })`.
  4. `findOrCreateSpreadsheet(session.accessToken, folderId, fileName)`로 `spreadsheetId`를 구한다.
  5. `shareSpreadsheetWithServiceAccount(session.accessToken, spreadsheetId, serviceAccountEmail)` 호출 후 `NextResponse.json({ ok: true })`.
- [ ] 새 버튼 컴포넌트("단축어 연동 켜기"): 클릭 시 `POST /api/shortcuts/link-sheet`를 `{ folderId: getSavedFolderId(), fileName: getSavedFileName() }`로 호출한다. 성공/실패 메시지를 보여준다(기존 `Toast` 컴포넌트 재사용 — `ExpenseDashboard`가 이미 갖고 있는 `showToast`를 prop으로 내려받거나 콜백으로 전달). 로딩 중에는 버튼을 비활성화한다.
- [ ] `lib/sheets.test.ts`에 `shareSpreadsheetWithServiceAccount`가 올바른 `fileId`/`requestBody`로 `drive.permissions.create`를 호출하는 테스트를 추가한다.
- [ ] `app/api/shortcuts/link-sheet/route.test.ts`: 미인증 401, 환경변수 없을 때 500, 정상 흐름에서 `findOrCreateSpreadsheet` → `shareSpreadsheetWithServiceAccount` 순서로 호출되고 `{ ok: true }`가 반환되는지 테스트한다.
- [ ] 새 버튼 컴포넌트에 대한 컴포넌트 테스트를 추가한다: 클릭 시 올바른 body로 fetch 호출, 성공/실패 시 각각 다른 토스트 메시지.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- lib/sheets.test.ts app/api/shortcuts/link-sheet/route.test.ts` 확인 후 전체 회귀. 실제 Drive 공유 동작(네트워크 필요)은 Task 3와 마찬가지로 Codex 완료 후 Claude Code가 수행한다.

---

### Task 5: 세션 인증 대기 API (`GET`/`DELETE /api/pending`, `POST /api/pending/confirm`)

**Files:**
- Create: `app/api/pending/route.ts`
- Create: `app/api/pending/route.test.ts`
- Create: `app/api/pending/confirm/route.ts`
- Create: `app/api/pending/confirm/route.test.ts`

**Interfaces:**
- Consumes: Task 1의 `readPendingRows`, `deletePendingRow`; 기존 `lib/sheets.ts`의 `findOrCreateSpreadsheet`, `appendExpenseRow`; 기존 `lib/expense.ts`의 `validateExpenseInput`.
- Produces:
  - `GET /api/pending` 응답: `{ items: PendingRowWithNumber[] }`.
  - `DELETE /api/pending` body: `{ folderId?: string, fileName?: string, rowNumber: number }` → `{ ok: true }`.
  - `POST /api/pending/confirm` body: `{ folderId?: string, fileName?: string, pendingRowNumber: number, date, amount, category, memo, method }`(나머지 필드는 `ExpenseInputSchema`와 동일) → `{ ok: true }`.

**Definition of Done:**
- [ ] `GET`: `app/api/expenses/route.ts:20-57`의 GET 핸들러와 동일한 인증/쿼리파라미터 관례(`session?.accessToken` 401, `folderId`/`fileName` 쿼리)를 따른다. `findOrCreateSpreadsheet` → `readPendingRows(session.accessToken, spreadsheetId)` → `{ items }`.
- [ ] `DELETE`: `z.object({ rowNumber: z.number().int().min(2) })`로 body를 검증한다(`app/api/expenses/route.ts:80-83`의 `rowLocationSchema`와 동일한 스타일). 검증 실패 시 400. `findOrCreateSpreadsheet` → `deletePendingRow(session.accessToken, spreadsheetId, rowNumber)` → `{ ok: true }`.
- [ ] `POST /api/pending/confirm`: `z.object({ pendingRowNumber: z.number().int().min(2) })`로 `pendingRowNumber`를 검증한다. 나머지 body(`folderId`, `fileName`, `pendingRowNumber` 제외)는 `validateExpenseInput`(`lib/expense.ts:13-15`)으로 검증한다. `findOrCreateSpreadsheet` → `month = expense.date.slice(0,7)` → `appendExpenseRow(session.accessToken, spreadsheetId, month, expense)` → 성공하면 `deletePendingRow(session.accessToken, spreadsheetId, pendingRowNumber)` → `{ ok: true }`. `appendExpenseRow`가 실패하면 `deletePendingRow`를 호출하지 않는다(대기 항목을 잃지 않기 위해 — 실패 시 사용자가 다시 시도할 수 있도록 남겨둔다).
- [ ] `app/api/pending/route.test.ts`: 미인증 401(GET/DELETE 각각), GET이 `readPendingRows` 결과를 그대로 `items`로 반환, DELETE가 잘못된 body에 400, 정상 흐름에서 `deletePendingRow`가 올바른 인자로 호출됨을 테스트한다.
- [ ] `app/api/pending/confirm/route.test.ts`: 미인증 401, `pendingRowNumber` 누락 시 400, `validateExpenseInput` 실패(예: amount 누락) 시 400(zod 에러 그대로 전파되는 기존 관례 확인), 정상 흐름에서 `appendExpenseRow` → `deletePendingRow` 순서로 호출됨, `appendExpenseRow`가 reject하면 `deletePendingRow`가 호출되지 않고 에러가 전파됨을 테스트한다.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- app/api/pending` 확인 후 전체 회귀.

---

### Task 6: `ExpenseForm`/`ExpenseDashboard`에 "확인 대기" 흐름 통합

**Files:**
- Modify: `components/ExpenseForm.tsx`
- Modify: `components/ExpenseForm.test.tsx`
- Create: `components/PendingList.tsx`
- Create: `components/PendingList.test.tsx`
- Modify: `components/ExpenseDashboard.tsx`
- Modify: `components/ExpenseDashboard.test.tsx`

**Interfaces:**
- Consumes: Task 5의 `GET /api/pending`(`{ items: PendingRowWithNumber[] }`), `DELETE /api/pending`, `POST /api/pending/confirm`; Task 1의 `PendingRowWithNumber` 타입(프론트엔드에서는 `lib/pending.ts`에서 타입만 import).
- Produces: `ExpenseForm`에 다음 props가 추가된다:
  ```ts
  confirmingPendingRowNumber?: number;
  confirmFolderId?: string | null;
  confirmFileName?: string;
  onCancelConfirm?: () => void;
  ```
- Produces: `components/PendingList.tsx`:
  ```ts
  type PendingListProps = {
    items: PendingRowWithNumber[];
    onConfirmPayment: (item: PendingRowWithNumber) => void;
    onDismiss: (item: PendingRowWithNumber) => void | Promise<void>;
  };
  export default function PendingList(props: PendingListProps): JSX.Element | null;
  ```

**Definition of Done:**
- [ ] `ExpenseForm.tsx`: `confirming = confirmingPendingRowNumber !== undefined`를 `editing`(50행)과 나란히 정의한다. `handleSubmit`(76-111행)에서 `folderId`/`fileName` 결정 로직에 `confirming` 분기를 추가한다(`editing ? (editFolderId ?? getSavedFolderId()) : confirming ? (confirmFolderId ?? getSavedFolderId()) : getSavedFolderId()`, `fileName`도 동일 패턴). fetch 대상을 `confirming ? '/api/pending/confirm' : '/api/expenses'`로 바꾸고, body에 `...(confirming ? { pendingRowNumber: confirmingPendingRowNumber } : {})`를 추가한다(`editing`일 때의 `month`/`rowNumber`와 동일한 패턴, `confirming`이면 `editing`은 항상 false이므로 서로 배타적). 취소 버튼(147-151행)을 `editing || confirming`일 때 보이도록 바꾸고 `onClick`을 `editing ? onCancelEdit : onCancelConfirm`으로 분기한다. 저장 버튼 라벨은 `confirming`일 때도 기존 새 지출과 동일하게 `'저장'`으로 둔다(수정 라벨과만 구분되면 충분).
- [ ] `components/PendingList.tsx`: `items`가 비어있으면 `null`을 반환한다(섹션 자체가 안 보임). `type: '결제'` 항목은 날짜/금액/가맹점(메모)/카테고리를 보여주고 "확인"(→ `onConfirmPayment(item)`) / "무시"(→ `onDismiss(item)`) 버튼 두 개를 렌더링한다. `type: '취소'` 항목은 같은 요약 정보 + "이 거래를 지출 목록에서 찾아 삭제해 주세요" 안내 텍스트 + "확인"(→ `onDismiss(item)`) 버튼 하나만 렌더링한다(폼을 열지 않음 — 스펙 §9).
- [ ] `ExpenseDashboard.tsx`:
  - `pendingItems: PendingRowWithNumber[]`, `confirmingPending: PendingRowWithNumber | null` state를 추가한다.
  - `fetchPending` callback을 추가한다(`fetchMonth`, 72-107행과 같은 구조): `getSavedFolderId()`/`getSavedFileName()`으로 쿼리스트링을 만들어 `GET /api/pending` 호출, 결과를 `pendingItems`에 저장. 실패 시 조용히 무시해도 된다(로딩 스피너/에러 배너 없이 — 확인 대기 섹션이 그냥 비어 보이면 됨, `fetchMonth`처럼 별도 `loadError` state를 만들 필요는 없다).
  - `useEffect(() => { void fetchMonth(); void fetchPending(); }, [fetchMonth, fetchPending])`로 마운트 시 둘 다 호출한다.
  - `<PendingList items={pendingItems} onConfirmPayment={(item) => { if (item.type !== '결제') return; setEditingExpense(null); clearReceiptDraft(); setConfirmingPending(item); formSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} onDismiss={async (item) => { await fetch('/api/pending', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: dataSource.folderId, fileName: dataSource.fileName, rowNumber: item.rowNumber }) }); if (confirmingPending?.rowNumber === item.rowNumber) setConfirmingPending(null); await fetchPending(); }} />`를 `MonthlySummary`와 `ReceiptUpload` 사이에 렌더링한다.
  - 기존 `onEdit`(188-192행) 콜백에 `setConfirmingPending(null)`을 추가한다(편집 시작 시 확인 대기 상태를 해제 — 기존에 이미 `clearReceiptDraft()`를 호출하는 것과 동일한 이유).
  - `ReceiptUpload`의 `onExtracted`(158-162행) 콜백에도 `setConfirmingPending(null)`을 추가한다(영수증 업로드 시에도 확인 대기 상태 해제).
  - `ExpenseForm`에 전달하는 `initialValues` 우선순위를 `editingExpense ?? confirmingPendingAsPartialExpenseInput ?? draftValuesAsPartialExpenseInput ?? undefined`로 확장한다. `confirmingPendingAsPartialExpenseInput`은 `confirmingPending`이 있을 때 `{ date: confirmingPending.date || undefined, amount: confirmingPending.amount || undefined, category: confirmingPending.category || undefined, memo: confirmingPending.memo || undefined, method: confirmingPending.method || undefined }`로 변환한다(빈 문자열/0은 "파싱 실패로 비어있음"을 의미하므로 `undefined`로 바꿔 폼이 빈 칸으로 보이게 한다 — `draftValuesAsPartialExpenseInput`, 49-56행과 동일한 사고방식).
  - `<ExpenseForm>`에 `confirmingPendingRowNumber={confirmingPending?.rowNumber}`, `confirmFolderId={dataSource.folderId}`, `confirmFileName={dataSource.fileName}`, `onCancelConfirm={() => setConfirmingPending(null)}`를 전달한다. `key` prop을 `editingExpense ? \`edit-${editingExpense.month}-${editingExpense.rowNumber}\` : confirmingPending ? \`confirm-${confirmingPending.rowNumber}\` : 'new'`로 확장한다.
  - `onSubmitted` 콜백(175-178행)에 `setConfirmingPending(null); await fetchPending();`를 추가한다(기존 `clearReceiptDraft(); await fetchMonth(month);`와 나란히).
- [ ] `ExpenseForm.test.tsx`에 다음을 추가한다: `confirmingPendingRowNumber`가 주어지면 제출 시 `/api/pending/confirm`으로 `pendingRowNumber`를 포함해 POST 요청이 간다, 취소 버튼이 보이고 클릭 시 `onCancelConfirm`이 호출된다.
- [ ] `components/PendingList.test.tsx`: 빈 배열이면 아무것도 렌더링하지 않는다, `결제` 항목의 "확인" 클릭 시 `onConfirmPayment`가 해당 item으로 호출된다, `취소` 항목은 안내 텍스트와 "확인" 버튼만 있고 클릭 시 `onDismiss`가 호출된다, `결제` 항목의 "무시" 클릭 시 `onDismiss`가 호출된다.
- [ ] `ExpenseDashboard.test.tsx`에 다음을 추가한다: 마운트 시 `/api/pending`도 호출된다, 확인 대기 항목의 "확인"을 누르면 폼이 그 항목 값으로 채워진다, 제출 후 `/api/pending`이 다시 조회된다(목록 갱신), 편집 시작/영수증 업로드 시 확인 대기 상태가 해제된다.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- ExpenseForm PendingList ExpenseDashboard` 확인 후 전체 테스트 스위트 통과 확인. Task 3~5가 실제로 배포되고 서비스 계정 연동이 끝난 뒤, `npm run dev`로 브라우저에서 확인 대기 섹션이 실제로 나타나는지 수동 확인 권장(자동화된 대기 항목 생성은 Task 3 완료 후 실제 알림/수동 curl 테스트로 검증).

---

## Self-Review 메모

- 스펙 §2(요약 흐름)~§9(취소 리마인더)가 각각 Task 1~6에 매핑됨: §3(인증) → Task 3·4, §4(데이터 모델) → Task 1, §6(API) → Task 3·4·5, §7(UI 흐름) → Task 6, §8(에러 처리) → Task 3 5단계·6단계, §9(취소 처리 근거) → Task 6의 `PendingList` 취소 렌더링. §10(비용)·§11(범위 밖)·§12(미해결)은 계획에 포함하지 않음 — 의도된 제외.
- Task 1이 정의하는 `PendingRow`/`PendingRowWithNumber` 타입이 Task 3(`appendPendingRow` 호출 시 만드는 객체), Task 5(`readPendingRows`/`deletePendingRow` 소비), Task 6(`PendingListProps.items`)에서 동일하게 쓰이는지 확인함 — 일치.
- `lib/pending.ts`의 세 함수가 서로 다른 자격증명 타입(accessToken 문자열 vs JWT 인스턴스)을 받는 비대칭 설계임을 Global Constraints에 명시해, Codex가 "왜 일관성이 없지?"라고 판단해 임의로 통일하지 않도록 함.
- Task 4의 "단축어 연동 켜기" 버튼이 어느 파일에 들어갈지("FileNameSetting.tsx 근처" 또는 신규 컴포넌트)는 Codex의 재량으로 열어뒀다 — 기존 설정 UI 레이아웃(`components/FileNameSetting.tsx`, `components/FolderPicker.tsx`)을 참고해 일관된 위치에 배치하면 된다.

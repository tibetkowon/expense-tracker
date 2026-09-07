# Drive 폴더 브라우저로 Picker 교체 — 구현 계획

> **실행 방식 안내 (이 프로젝트 전용):** 이 프로젝트는 `CLAUDE.md`에 정의된 대로 Claude Code가 감독자, Codex가 구현 담당자다. 아래 태스크는 `superpowers:subagent-driven-development`나 `superpowers:executing-plans`가 아니라, **각 태스크를 하나씩 `codex-auto` 스킬에 위임**하는 방식으로 실행한다 (Task 1 완료 → 사용자 확인 → Task 2 진행, 이전 두 항목과 동일한 패턴). 그래서 아래 태스크에는 구현 코드 전체를 미리 적지 않고, Codex가 구현을 결정할 수 있도록 정확한 인터페이스/요구사항/테스트 시나리오만 명시한다.

**Goal:** iOS standalone PWA에서 동작하지 않는 Google Picker 기반 폴더 선택을, 우리 도메인에서 직접 렌더링하는 커스텀 Drive 폴더 브라우저로 교체한다.

**Architecture:** `drive.readonly` 스코프를 추가해 백엔드가 임의 폴더 목록을 조회하는 API 라우트를 만들고(Task 1), 프론트엔드는 그 API를 호출하는 자체 UI 컴포넌트로 Picker를 대체한다(Task 2). Google 도메인 콘텐츠를 페이지에 임베드하지 않으므로 iOS standalone WKWebView의 서드파티 쿠키 제약이 적용되지 않는다.

**Tech Stack:** Next.js App Router, NextAuth v5, googleapis (Drive API v3), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-drive-folder-browser-design.md`

## Global Constraints

- OAuth 스코프는 `drive.file` + `drive.readonly` + `spreadsheets`로 확장한다 (스펙 §3). `drive.readonly`는 폴더 브라우징 전용이며 쓰기 작업에는 절대 쓰지 않는다.
- 기존 로그인 세션이 새 스코프 없이 API를 호출하면 403이 오는데, 이를 다른 서버 에러와 구분해 `REAUTH_REQUIRED`로 매핑해야 한다 (스펙 §3).
- 폴더 목록 조회는 폴더당 최대 100개, 정렬은 이름순. 페이지네이션은 이번 스코프 밖 (스펙 §4, §6).
- 새 UI는 앱 자체 디자인 시스템을 따르고, Google Picker 관련 코드/스크립트 로딩은 완전히 제거한다 (스펙 §5).

---

### Task 1: Drive 폴더 조회 API (백엔드)

**Files:**
- Modify: `auth.ts` (SCOPES에 `drive.readonly` 추가)
- Create: `lib/drive.ts`
- Create: `lib/drive.test.ts`
- Create: `app/api/drive/folders/route.ts`
- Create: `app/api/drive/folders/route.test.ts`
- Modify: `CLAUDE.md` ("OAuth 스코프는 `drive.file` + `spreadsheets`로 유지" 문구를 "`drive.file` + `drive.readonly` + `spreadsheets`"로 갱신, Constraints 섹션)

**Interfaces:**
- Produces: `lib/drive.ts`가 export하는 `listFolders(accessToken: string, parentId: string): Promise<{ id: string; name: string }[]>`. 내부적으로 `lib/sheets.ts:14-16`의 `authClient(accessToken)` 헬퍼와 동일한 패턴으로 OAuth2 클라이언트를 만들고, `google.drive({ version: 'v3', auth })`를 사용한다 (`lib/sheets.ts:220`, `:331`과 동일 패턴).
- Produces: `listFolders`가 Drive API의 403(insufficient scope) 응답을 받으면 별도 식별 가능한 에러(예: `DriveScopeError`라는 이름의 커스텀 Error 서브클래스, 또는 `{ code: 'REAUTH_REQUIRED' }`를 담은 에러)를 던진다 — Task 2 이후의 프론트가 이 값을 그대로 UI 메시지에 매핑하므로, 정확한 판별 방법(에러 클래스명 또는 코드 값)을 라우트 핸들러와 일관되게 유지한다.
- Produces: `GET /api/drive/folders?parentId=<id>` — `parentId` 쿼리 파라미터 생략 시 `'root'`로 취급. 성공 시 `200 { folders: { id: string, name: string }[] }`. 미인증 시 `401 { error: string }`. 스코프 부족 시 `403 { error: 'REAUTH_REQUIRED' }` (일반 500 `{ error: string }`과 구분되는 별도 상태 코드+본문). 그 외 실패 시 `500 { error: string }`.

**Definition of Done:**
- [ ] `auth.ts`의 `SCOPES` 배열에 `'https://www.googleapis.com/auth/drive.readonly'`를 추가한다.
- [ ] `lib/drive.ts`에 `listFolders`를 구현한다. Drive API 쿼리: `mimeType='application/vnd.google-apps.folder' and '<parentId>' in parents and trashed=false`, `fields: 'files(id,name)'`, `orderBy: 'name'`, `pageSize: 100`.
- [ ] `app/api/drive/folders/route.ts`에 GET 핸들러를 구현한다. 기존 라우트(`app/api/file-name/route.ts`)와 동일하게 `auth()`로 세션을 확인하고, try/catch로 감싸 구조화된 에러 응답을 반환한다.
- [ ] `lib/drive.test.ts`: 다음 시나리오를 커버하는 테스트를 작성한다 — (a) 정상적으로 폴더 목록을 반환, (b) `parentId` 생략 시 `'root'`로 쿼리, (c) 403 응답을 스코프 부족 에러로 변환.
- [ ] `app/api/drive/folders/route.test.ts`: 다음 시나리오를 커버한다 — (a) 미인증 401, (b) 정상 200 + `{ folders }`, (c) 스코프 부족 시 403 + `REAUTH_REQUIRED`, (d) 그 외 예외 시 500.
- [ ] `CLAUDE.md`의 "Constraints" 섹션에서 OAuth 스코프 문구를 갱신한다.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- lib/drive.test.ts app/api/drive/folders/route.test.ts`로 새 테스트만 먼저 확인 후, 전체 `npm run test`로 회귀 없는지 확인.

---

### Task 2: 폴더 브라우저 UI (프론트엔드)

**Files:**
- Modify: `components/FolderPicker.tsx` (Google Picker 관련 코드 전체 제거, 새 브라우저 컴포넌트로 교체)
- Create: `components/FolderPicker.test.tsx` (기존 테스트 파일이 있다면 이름 확인 후 그 파일을 갱신 — 없으면 새로 생성)
- Modify: `app/page.tsx:28-31` (`FolderPickerSection`에 더 이상 `apiKey` prop을 전달하지 않도록 수정)

**Interfaces:**
- Consumes: Task 1의 `GET /api/drive/folders?parentId=<id>` — 응답 형태 `{ folders: { id: string, name: string }[] }`, 스코프 부족 시 `403 { error: 'REAUTH_REQUIRED' }`.
- Consumes: 기존 `saveFolderId`(`lib/folderStorage.ts`), `Toast` 컴포넌트(`components/Toast.tsx`) — 항목 1에서 이미 구현된 로컬 토스트 패턴(`FolderPicker.tsx`의 `showToast`, 1800ms 자동 dismiss)을 그대로 재사용한다.
- Produces: `FolderPickerSection`의 public prop 타입에서 `apiKey`를 제거 (`Omit<FolderPickerProps, 'onPicked'>` 대신 `apiKey` 없는 새 타입 정의).

**Definition of Done:**
- [ ] `FolderPicker.tsx`에서 `gapi`/`google.picker` 관련 코드(3, 9-10, 21-62행 부근 — 정확한 라인은 Task 1 완료 시점 파일 기준으로 확인)를 전부 제거한다.
- [ ] "변경" 버튼을 누르면 모달(또는 바텀시트)이 열리고 `/api/drive/folders`를 호출해 현재 폴더의 하위 폴더 목록을 보여준다. 시작 위치는 `parentId` 없이 호출(=root).
- [ ] 폴더 항목을 탭하면 그 폴더로 들어가 하위 목록을 다시 조회한다. 뒤로가기(또는 브레드크럼)로 상위 폴더로 이동할 수 있다.
- [ ] "이 폴더 선택" 버튼으로 현재 폴더를 확정하면 `saveFolderId(id)` + 폴더명 저장 + `showToast('저장 위치가 변경되었습니다')`를 호출하고 모달을 닫는다 (기존 `onPicked` 핸들러가 하던 일과 동일).
- [ ] API가 `403 REAUTH_REQUIRED`를 반환하면, 모달 안에 "다시 로그인하면 사용할 수 있어요" 안내 문구와 로그아웃 버튼(또는 안내 링크)을 보여준다. 그 외 API 실패는 에러 메시지를 모달 안에 표시한다.
- [ ] `app/page.tsx`에서 `FolderPickerSection`에 `apiKey={process.env.NEXT_PUBLIC_GOOGLE_API_KEY!}`를 더 이상 전달하지 않는다.
- [ ] `FolderPicker.test.tsx` (또는 기존 테스트 파일 갱신): 다음 시나리오를 커버한다 — (a) 모달 열기 시 root 폴더 목록 조회 및 표시, (b) 폴더 탭 시 하위 목록으로 이동, (c) "이 폴더 선택" 시 `saveFolderId` 호출 및 토스트 표시, (d) `REAUTH_REQUIRED` 응답 시 재로그인 안내 표시.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- FolderPicker`로 새/갱신 테스트 확인 후 전체 테스트 스위트 통과 확인. 이 작업 완료 후 사용자가 실기기(iOS 홈화면 추가 PWA)에서 직접 확인 필요 (스펙 §7 — Codex 샌드박스도, 로컬 개발 환경도 iOS standalone 모드를 재현할 수 없음).

---

## Self-Review 메모

- 스펙 §3(스코프 변경 + 재인증 처리), §4(API 설계), §5(UI 설계) 모두 Task 1/2에 매핑됨. §6(다루지 않는 것), §7(후속 정리)은 계획에 포함하지 않음 — 의도된 범위 제외.
- Task 1과 Task 2는 API 계약(`GET /api/drive/folders` 요청/응답 형태, `REAUTH_REQUIRED` 에러 코드)으로만 연결되어 있어 독립적으로 리뷰 가능. Task 1이 PASS해야 Task 2의 실제 동작을 검증할 수 있음 (Task 2 테스트는 API를 모킹하므로 순서만 지키면 됨).

# 접속 경로에 무관하게 항상 같은 파일 찾기 — 구현 계획

> **실행 방식 안내 (이 프로젝트 전용):** 다른 계획 문서들과 동일하게, 아래 태스크는 각각 `codex-auto` 스킬에 하나씩 위임한다. 구현 코드는 미리 적지 않고, 인터페이스/요구사항/테스트 시나리오만 명시한다.

**Goal:** 웹/앱/기기와 무관하게 항상 같은 스프레드시트 파일을 찾도록, 파일 식별 방식을 `localStorage` 기반에서 Drive `appProperties` 마커 기반으로 바꾼다.

**Architecture:** 파일 생성 시 Drive `appProperties`에 마커를 남기고, 이후 검색은 폴더+이름이 아니라 이 마커로 한다(Task 1). "저장 위치"/"파일명" 표시는 그 파일의 실제 현재 위치를 매번 조회해서 보여주고, "폴더 변경"은 실제 파일 이동으로 동작한다(Task 2).

**Tech Stack:** Next.js App Router, googleapis (Drive API v3, Sheets API v4), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-canonical-file-identity-design.md`

## Global Constraints

- `appProperties` 마커 키/값: `expenseTrackerCanonical: 'true'` (스펙 §3).
- 자동 데이터 병합은 하지 않는다 — 마커 없는 기존 파일들은 그냥 더 이상 참조되지 않는다 (스펙 §8, YAGNI).
- `lib/folderStorage.ts`/`lib/fileNameStorage.ts`는 삭제하지 않는다 — 최초 생성 폴백 힌트로만 계속 쓰인다 (스펙 §7).
- 동시 이동 요청에 대한 별도 동시성 제어는 하지 않는다 (스펙 §10).

---

### Task 1: 마커 기반 파일 검색 + 위치 조회/이동 함수 (백엔드)

**Files:**
- Modify: `lib/sheets.ts` (`findOrCreateSpreadsheet` 로직 변경, `getSpreadsheetLocation`/`moveSpreadsheetFile` 추가)
- Modify: `lib/sheets.test.ts`
- Create: `app/api/file-location/route.ts`
- Create: `app/api/file-location/route.test.ts`

**Interfaces:**
- Produces: `findOrCreateSpreadsheet(accessToken: string, folderId?: string, fileName?: string): Promise<string>`(기존 시그니처 동일하게 유지) — 내부 동작만 변경: (1) `appProperties has { key='expenseTrackerCanonical' and value='true' }` 마커로 우선 검색, (2) 못 찾으면 기존처럼 `folderId`/`fileName`으로 폴백 검색 후 찾으면 마커를 붙여 승격, (3) 그래도 못 찾으면 새로 생성하며 마커도 함께 설정.
- Produces: `getSpreadsheetLocation(accessToken: string, spreadsheetId: string): Promise<{ folderId: string; folderName: string; fileName: string }>` — `drive.files.get({fileId, fields:'name,parents'})`로 조회. 부모가 없거나 `'root'`면 `folderId: 'root'`, `folderName: '내 드라이브'`. 있으면 `drive.files.get({fileId: parentId, fields:'name'})`로 실제 폴더 이름 조회.
- Produces: `moveSpreadsheetFile(accessToken: string, spreadsheetId: string, newFolderId: string): Promise<void>` — 현재 parents 조회 후 `drive.files.update({fileId, addParents: newFolderId, removeParents: <현재 parents 조인>, fields:'id,parents'})`.
- Produces: `GET /api/file-location` — 인증 필요(401), 성공 시 `200 { folderId, folderName, fileName }`.
- Produces: `POST /api/file-location` — body `{ folderId: string }`, 인증 필요(401), 성공 시 `200 { ok: true }`, 그 외 실패 `500 { error: string }` (기존 라우트들과 동일하게 try/catch로 구조화된 에러 응답).

**Definition of Done:**
- [ ] `lib/sheets.ts`의 `findOrCreateSpreadsheet`(294-326행)을 스펙 §4 순서대로 재작성한다. 기존 `migrateLegacySheetIfPresent` 호출은 마커로 찾은 경우와 폴백으로 찾은 경우 모두에서 동일하게 유지한다.
- [ ] `getSpreadsheetLocation`, `moveSpreadsheetFile`을 위 인터페이스대로 구현한다. 파일 내 기존 관례(`authClient`, `google.drive({version:'v3',auth})`, `escapeForDriveQuery` 등)를 그대로 따른다.
- [ ] `app/api/file-location/route.ts`에 GET/POST 핸들러를 구현한다. 기존 라우트(`app/api/file-name/route.ts`)와 동일한 인증/에러 응답 패턴을 따른다.
- [ ] `lib/sheets.test.ts`에 다음 시나리오를 추가한다:
  - 마커로 파일을 찾으면 `folderId`/`fileName` 인자와 무관하게 그 파일을 반환한다.
  - 마커로 못 찾고 폴더+이름 폴백으로 찾으면, 찾은 파일에 마커를 붙이는 `drive.files.update` 호출이 일어난다.
  - 마커도 폴백도 못 찾으면 새로 생성하면서 마커를 함께 설정한다.
  - `getSpreadsheetLocation`이 부모 없음/`root`일 때 `'내 드라이브'`를 반환한다.
  - `getSpreadsheetLocation`이 실제 부모 폴더가 있을 때 그 폴더 이름을 조회해 반환한다.
  - `moveSpreadsheetFile`이 현재 parents를 제거하고 새 폴더를 추가하는 `addParents`/`removeParents` 호출을 정확히 만든다.
- [ ] `app/api/file-location/route.test.ts`: GET 성공/401, POST 성공/401/500 케이스.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- lib/sheets.test.ts app/api/file-location/route.test.ts` 먼저 확인 후 전체 회귀 확인.

---

### Task 2: 위치 표시 및 이동 UI 연결 (프론트엔드)

**Files:**
- Modify: `components/FolderPicker.tsx` (`FolderPickerSection` 마운트 시 `/api/file-location` 조회로 교체, `FolderBrowser`의 "이 폴더 선택"이 `POST /api/file-location` 호출하도록 변경)
- Modify: `components/FileNameSetting.tsx` (마운트 시 `/api/file-location` 조회로 교체)
- Modify: `components/SettingsFeedback.test.tsx` (또는 관련 기존 테스트 파일 — 정확한 파일명 확인 후 갱신)

**Interfaces:**
- Consumes: Task 1의 `GET /api/file-location` → `{ folderId, folderName, fileName }`, `POST /api/file-location` (body `{ folderId }`) → `{ ok: true }`.

**Definition of Done:**
- [ ] `FolderPickerSection`이 마운트 시 `localStorage` 읽기 대신 `GET /api/file-location`을 호출해 `folderName`을 표시한다. 로딩 중/실패 시의 표시는 기존 폴백 문구("Drive 루트" 등)를 참고해 자연스럽게 처리한다.
- [ ] `FolderBrowser`(폴더 브라우저 모달)의 "이 폴더 선택" 버튼이, 기존 `saveFolderId`+`localStorage` 저장 대신 `POST /api/file-location`으로 실제 이동을 요청한다. 성공하면 토스트("저장 위치가 변경되었습니다", 기존 패턴 재사용) 표시 후 위치 표시를 갱신한다(재조회 또는 응답 기반 갱신). 실패 시 에러를 모달 안에 표시한다(기존 API 실패 처리 패턴 재사용).
- [ ] `FileNameSetting`이 마운트 시 `getSavedFileName()`(`localStorage`) 대신 `GET /api/file-location`을 호출해 `fileName`을 표시한다. 파일명 변경(rename) 자체는 기존 `POST /api/file-name` 흐름을 그대로 유지한다 — 이번 태스크에서 rename 로직 자체는 바꾸지 않는다.
- [ ] `lib/folderStorage.ts`/`lib/fileNameStorage.ts`와 이를 쓰는 다른 호출부(`ExpenseDashboard.fetchMonth`, `ExpenseForm` 제출 등)는 건드리지 않는다 — 여전히 최초 생성 폴백 힌트로 유효하다.
- [ ] 관련 테스트 파일에 다음 시나리오를 추가/갱신한다: (a) 마운트 시 `/api/file-location`을 호출해 받은 값으로 위치/파일명이 표시됨, (b) "이 폴더 선택" 시 `POST /api/file-location`이 선택한 폴더 id로 호출됨, (c) 이동 성공 시 토스트 표시, (d) 이동 실패 시 에러 표시.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** 관련 테스트 통과 확인 후 전체 스위트 회귀 확인. 로컬 `npm run dev`로 실제 폴더 이동 후 새로고침해도 같은 위치가 유지되는지 수동 확인 권장.

---

## Self-Review 메모

- 스펙 §4(검색 로직), §5(위치 조회/이동 함수), §6(API), §7(프론트엔드)이 각각 Task 1, Task 1, Task 1, Task 2에 매핑됨. §8(마이그레이션 영향), §9(범위 밖), §10(미해결)은 계획에 포함하지 않음 — 문서화만으로 충분.
- Task 1의 `GET`/`POST /api/file-location` 응답 계약과 Task 2가 소비하는 타입이 정확히 일치.
- Task 1과 Task 2는 API 계약으로만 연결되어 독립적으로 리뷰 가능.

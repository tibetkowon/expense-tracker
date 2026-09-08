# 접속 경로에 무관하게 항상 같은 파일 찾기 — 설계 문서

- 날짜: 2026-09-08
- 상태: 초안 (사용자 리뷰 대기)
- 배경: 2026-09-08 세 번째 피드백 라운드 항목 1("세션에 따른 신규파일 생성"). 사용자 확인: 폰 앱(PWA), 폰 Safari, PC 웹 — 접속 경로마다 각자 다른 스프레드시트 파일을 보고 있음.

## 1. 문제

`lib/folderStorage.ts`/`lib/fileNameStorage.ts`는 순수 `localStorage` 래퍼다. `findOrCreateSpreadsheet`(`lib/sheets.ts:294-326`)는 이 값들(폴더 id, 파일명)로 Drive에서 파일을 검색하고, 못 찾으면 새로 만든다. `localStorage`는 브라우저/기기마다 완전히 독립적이므로, 사용자가 어디서 접속하든 각 컨텍스트가 서로 다른 (또는 비어있는) 폴더/파일명 값을 갖게 되고, 결과적으로 서로 다른 파일을 찾거나 새로 만들어버린다. iOS PWA에 국한된 문제가 아니라 — 웹 vs 앱, PC vs 폰 등 모든 조합에서 재현된다(사용자 확인 완료).

## 2. 접근 방식

"어떤 파일이 내 파일인지"를 브라우저 저장소가 아니라 **Google Drive 자체의 메타데이터**로 판별하도록 바꾼다. 파일을 처음 만들 때 Drive의 `appProperties`(이 앱만 읽고 쓸 수 있는 비공개 커스텀 메타데이터, `drive.file` 스코프로 접근 가능)에 식별 마커를 남기고, 이후 파일을 찾을 때는 폴더/파일명이 아니라 이 마커로 검색한다. Drive API 호출은 Google 계정 자체에 대한 조회이므로, 어떤 브라우저/기기에서 요청하든 항상 같은 결과(같은 파일)를 반환한다.

`localStorage`(`folderStorage.ts`, `fileNameStorage.ts`)는 완전히 없애지 않는다 — 파일이 아직 한 번도 만들어지지 않은 최초 생성 시점에 "어디에, 어떤 이름으로 만들지"에 대한 힌트로만 계속 쓰인다. 파일을 **찾는** 데는 더 이상 이 값들에 의존하지 않는다.

## 3. 데이터 모델

- 스프레드시트 파일 생성 시 `appProperties: { expenseTrackerCanonical: 'true' }`를 함께 설정한다.
- 검색 쿼리: `appProperties has { key='expenseTrackerCanonical' and value='true' } and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`.
- 마커가 여러 파일에 붙어있는 상황(정상 흐름에서는 발생하지 않아야 하지만, 방어적으로)은 첫 번째 결과를 사용하고 별도 정리 로직은 만들지 않는다 (§6).

## 4. `findOrCreateSpreadsheet` 로직 변경

`lib/sheets.ts:294-326`을 다음 순서로 바꾼다:

1. **마커로 검색.** 있으면 그 파일 ID를 쓴다 (기존과 동일하게 `migrateLegacySheetIfPresent` 호출).
2. **마커로 못 찾으면** (이 변경이 처음 배포된 시점, 또는 아직 아무 파일도 만든 적 없는 신규 사용자) — 기존 방식대로 `folderId`/`fileName` 힌트로 폴더+이름 검색을 한다 (하위 호환을 위한 폴백, §7).
   - 이 폴백으로 찾은 파일에는 마커가 없으므로, 찾자마자 `drive.files.update`로 `appProperties` 마커를 붙인다("이 파일을 정식 파일로 승격"). 이후 어떤 기기에서 접속하든 1번 단계에서 이 파일을 찾게 된다.
3. **폴백도 못 찾으면** 기존과 동일하게 새로 만들되, 생성 시점에 `appProperties` 마커를 함께 설정한다.

`folderId`/`fileName` 매개변수 시그니처는 그대로 유지한다 — 2번, 3번 케이스에서만 실제로 쓰인다.

## 5. 파일의 실제 위치/이름 조회 + 이동

지금까지 "저장 위치"/"파일명" UI는 `localStorage` 값을 그대로 보여줬다. 이제 파일을 찾는 방식이 바뀌었으니(다른 기기가 만든 파일을 마커로 찾아올 수도 있음), 표시도 **그 파일의 실제 현재 위치/이름**을 Drive에서 읽어와 보여줘야 한다. 그렇지 않으면 "루트"라고 표시되는데 실제로는 다른 폴더에 저장되는 혼란이 생긴다.

- `lib/sheets.ts`에 `getSpreadsheetLocation(accessToken, spreadsheetId): Promise<{ folderId: string; folderName: string; fileName: string }>`를 추가한다. `drive.files.get({ fileId, fields: 'name,parents' })`로 파일명과 부모 폴더 id를 가져오고, 부모가 없거나 `root`면 `folderName`은 `'내 드라이브'`로 고정, 있으면 `drive.files.get({ fileId: parentId, fields: 'name' })`로 폴더 이름을 조회한다.
- `lib/sheets.ts`에 `moveSpreadsheetFile(accessToken, spreadsheetId, newFolderId): Promise<void>`를 추가한다. 현재 부모를 조회한 뒤 `drive.files.update({ fileId, addParents: newFolderId, removeParents: <현재 부모들>, fields: 'id, parents' })`로 실제로 파일을 옮긴다. "저장 위치 변경"이 이제 로컬 포인터 교체가 아니라 **실제 파일 이동**이 되므로, 어느 기기에서 봐도 새 위치가 반영된다 (파일명 변경이 이미 실제 rename인 것과 일관됨).

## 6. API 변경

새 라우트 `app/api/file-location/route.ts`:

- `GET /api/file-location` — 세션 인증 후 `findOrCreateSpreadsheet`(마커 우선 검색)로 정식 파일을 찾고, `getSpreadsheetLocation`으로 현재 위치/이름을 조회해 `200 { folderId, folderName, fileName }`로 반환한다. 미인증 401.
- `POST /api/file-location` — body `{ folderId: string }`. `findOrCreateSpreadsheet`로 정식 파일을 찾은 뒤 `moveSpreadsheetFile`로 그 폴더로 옮긴다. 성공 시 `200 { ok: true }`. 미인증 401, 그 외 실패 500 (기존 라우트들과 동일한 구조화된 에러 응답 패턴).

기존 `POST /api/file-name`(rename)은 그대로 둔다 — 이름 변경과 위치 이동은 별개 동작으로 유지한다.

## 7. 프론트엔드 변경

- `components/FolderPicker.tsx`의 `FolderPickerSection`: 마운트 시 `localStorage` 대신 `GET /api/file-location`을 호출해 `folderName`을 표시한다.
- `FolderBrowser`(폴더 브라우저 모달)의 "이 폴더 선택" 동작: 지금은 `saveFolderId` + `localStorage` 저장만 하는데, 이제 `POST /api/file-location`을 호출해 실제로 파일을 이동시킨다. 성공하면 토스트 표시 + 위치 표시를 갱신한다(성공 응답 후 `GET /api/file-location`을 다시 부르거나, 선택한 폴더 이름을 그대로 반영).
- `components/FileNameSetting.tsx`: 마운트 시 `getSavedFileName()`(`localStorage`) 대신 `GET /api/file-location`을 호출해 `fileName`을 표시한다. (이 컴포넌트는 이미 자체적으로 데이터를 읽어오는 구조라 — 마운트 시 자체 fetch를 추가하는 게 기존 컨벤션과 맞다. `FolderPickerSection`과 상태를 공유하려 하지 말 것.)
- `lib/folderStorage.ts`/`lib/fileNameStorage.ts`와 그걸 쓰는 기존 호출부(`ExpenseDashboard.fetchMonth`, `ExpenseForm` 제출 시 등)는 그대로 둔다 — 여전히 §4의 폴백 힌트로 쓰이므로 삭제하지 않는다.

## 8. 마이그레이션 / 기존 사용자에게 미치는 영향

이 변경이 배포된 후 **가장 먼저 앱을 여는 기기/브라우저**가 그 시점에 자신의 `localStorage` 값으로 찾거나 만든 파일이 마커를 얻어 "정식 파일"이 된다. 그 뒤로는 모든 기기가 그 파일로 수렴한다.

- **자동 데이터 병합은 하지 않는다.** 사용자가 이미 여러 기기에서 각자 다른 파일에 지출을 기록해왔다면, 이번 변경 이후에는 그중 하나만 "정식 파일"이 되고 나머지는 더 이상 앱에서 보이지 않는다 (Drive에서 파일 자체가 삭제되지는 않으므로, 필요하면 사용자가 직접 Drive에서 찾아 데이터를 옮길 수 있다).
- 이유: 여러 파일의 월별 시트를 자동으로 병합하려면 중복 판정, 행 순서, 설정 시트(결제수단) 병합 등 위험도 높은 로직이 필요하고, 잘못 병합되면 되돌리기 어렵다. 이번 스펙 범위에서는 다루지 않는다.

## 9. 이 스펙에서 다루지 않는 것

- 여러 기기에 흩어진 기존 데이터의 자동 병합.
- 마커가 여러 파일에 붙는 비정상 상황에 대한 정리/복구 로직.
- `localStorage` 유틸리티 자체의 제거 — 여전히 폴백 힌트로 쓰이므로 유지.

## 10. 미해결 사항

- `POST /api/file-location`으로 이동 중 다른 기기가 동시에 다른 폴더로 이동을 요청하면 마지막 요청이 이긴다(일반적인 last-write-wins). 개인용 단일 사용자 도구 규모에서는 문제되지 않는다고 판단 — 별도 동시성 제어는 하지 않는다.

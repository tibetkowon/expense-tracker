# Drive 폴더 브라우저로 Picker 교체 — 설계 문서

- 날짜: 2026-09-08
- 상태: 초안 (사용자 리뷰 대기)
- 배경: 2026-09-07 사용자 피드백 2차 라운드 항목 4("앱을 킬 때마다 저장 위치 초기화 및 쿠키 관련 에러 발생")를 다룸. 같은 라운드의 항목 1(저장위치/파일명 변경 피드백), 항목 3(빈 Sheet1 정리)은 이미 별도로 완료됨. 항목 2(결제수단 관리)는 이 스펙과 무관한 별개 작업.

## 1. 근본 원인 (재확인)

`components/FolderPicker.tsx`의 `folderId`/`folderName`은 Google Picker의 `onPicked` 콜백에서만 `localStorage`에 저장된다. Google Picker는 항상 `picker.google.com`의 cross-origin iframe을 페이지에 오버레이로 띄우는 방식으로 동작하는데, iOS 홈화면 추가(standalone) 모드의 WKWebView는 일반 Safari와 쿠키/스토리지 저장소가 완전히 분리되어 있고 서드파티 쿠키 접근을 구조적으로 차단한다. 그 결과:

- Picker iframe이 Google 세션 쿠키를 못 읽어 "Can't access your Google Account" 에러가 뜨고,
- Picker가 한 번도 성공적으로 완료되지 않으니 `onPicked`이 불리지 않아 저장 위치가 영구히 기본값("Drive 루트")으로 보인다.

두 증상은 하나의 원인(Picker의 iframe 의존성)에서 나온다. 이 스펙은 iframe에 의존하지 않는 방식으로 폴더 선택 기능을 다시 구현해 이 제약을 근본적으로 없앤다.

## 2. 접근 방식

Google Picker(cross-origin iframe 위젯)를 걷어내고, 우리 도메인 안에서 직접 렌더링하는 커스텀 폴더 브라우저로 교체한다. 폴더 목록은 우리 백엔드가 Drive API로 조회해서 내려주고, 프론트는 그 결과로 리스트 UI를 그린다 — Google 도메인 콘텐츠를 페이지에 임베드하지 않으므로 standalone WKWebView의 서드파티 쿠키 제약 자체가 적용되지 않는다.

이전에(2026-09-07) 같은 방향이 "Picker 테마를 앱 디자인에 맞추고 싶다"는 순수 UI 취향 이유로 스코프 확장을 피하기 위해 거절된 적이 있다. 이번엔 다르다 — 폴더 선택 기능이 특정 환경(iOS PWA)에서 아예 동작하지 않는 기능 결함이 원인이며, 취향이 아니라 필요조건이다.

## 3. OAuth 스코프 변경

`auth.ts`의 `SCOPES`에 `https://www.googleapis.com/auth/drive.readonly`를 추가한다.

- 기존 `drive.file`은 그대로 유지한다 — 앱이 만든 스프레드시트 파일 자체의 생성/rename/쓰기 권한(`findOrCreateSpreadsheet`, `renameSpreadsheetFile`, `appendExpenseRow` 등)은 계속 이 스코프로 처리한다.
- `drive.readonly`는 오직 "임의 폴더 목록을 읽기 전용으로 탐색"하는 데만 쓴다. 파일 생성/수정/삭제에는 이 스코프를 쓰지 않는다.
- `drive.file`만으로는 앱이 만들지 않은 임의 폴더를 `files.list`로 조회할 수 없다(사용자가 Picker로 명시적으로 연 파일/폴더만 보임) — 그래서 브라우징 목적만을 위한 최소 범위로 `drive.readonly`를 추가하는 것이며, 전체 쓰기 권한을 갖는 `drive` 풀스코프는 쓰지 않는다.
- `CLAUDE.md`의 "OAuth 스코프는 `drive.file` + `spreadsheets`로 유지" 제약은 이 스펙 승인 시 "`drive.file` + `drive.readonly` + `spreadsheets`"로 갱신한다.

### 기존 로그인 사용자 처리

이미 로그인된 세션은 기존 스코프(`drive.file` + `spreadsheets`)로 발급된 토큰을 갖고 있어 `drive.readonly` 권한이 없다. Drive API가 403(insufficient scope)을 반환하면, 폴더 브라우저 API 라우트는 이를 구분해서 `{ error: 'REAUTH_REQUIRED', message: '...' }` 형태로 응답하고, 프론트는 "다시 로그인하면 사용할 수 있어요" 안내와 함께 로그아웃 버튼을 보여준다. `auth.ts`에 이미 `prompt: 'consent'`가 설정돼 있어 재로그인 시 새 스코프 동의가 정상적으로 이뤄진다.

## 4. API 설계

새 라우트: `GET /api/drive/folders?parentId=<id>`

- `parentId` 생략 시 `root`(내 드라이브 최상위)를 조회한다.
- 인증: 기존 라우트들과 동일하게 `auth()`로 세션의 `accessToken`을 사용. 미로그인 시 401.
- 내부적으로 `lib/drive.ts`(신규 파일)에 `listFolders(accessToken, parentId)`를 추가한다. `drive.files.list`에 `q: "mimeType='application/vnd.google-apps.folder' and '<parentId>' in parents and trashed=false"`, `fields: 'files(id,name)'`, `orderBy: 'name'`, `pageSize: 100`을 사용한다.
- 응답: `{ folders: { id: string, name: string }[] }`. 한 레벨에 폴더가 100개를 넘는 극단적 케이스는 이번 스펙 범위 밖(§6).
- Drive API가 403(스코프 부족)을 반환하면 위 §3대로 `REAUTH_REQUIRED` 에러 코드로 매핑해서 502가 아닌 별도 처리를 한다. 그 외 실패는 기존 라우트들과 동일하게 구조화된 `{ error: string }` + 500으로 처리한다.

`lib/sheets.ts`는 스프레드시트 파일 자체를 다루는 함수들에 집중하고, 임의 폴더 브라우징은 성격이 달라 새 `lib/drive.ts`로 분리한다.

## 5. UI 설계

`components/FolderPicker.tsx`를 다음과 같이 교체한다:

- Google Picker 스크립트 로딩(`gapi.load('picker', ...)`), `google.picker.PickerBuilder` 관련 코드를 전부 제거한다.
- `FolderPicker`(버튼 + Picker 트리거)를 새 컴포넌트로 교체 — "변경" 버튼을 누르면 페이지 이동 없이 모달/바텀시트로 폴더 브라우저를 띄운다.
  - 브라우저는 `/api/drive/folders`를 호출해 현재 폴더의 하위 폴더 목록을 보여준다.
  - 폴더를 탭하면 그 폴더 안으로 들어가고(다시 `/api/drive/folders?parentId=...` 호출), 브레드크럼(또는 "뒤로" 버튼)으로 상위 폴더로 돌아갈 수 있다.
  - 현재 보고 있는 폴더를 저장 위치로 선택하는 "이 폴더 선택" 버튼을 둔다.
  - 시작 위치는 `root`("내 드라이브").
- 선택 완료 시 기존과 동일하게 `saveFolderId`/`localStorage` 저장 + 토스트 표시(항목 1에서 이미 구현된 패턴 재사용).
- `FolderPickerSection`의 `apiKey` prop(Picker developer key 용도였음)은 더 이상 필요 없으므로 제거하고, `app/page.tsx`에서 `NEXT_PUBLIC_GOOGLE_API_KEY` 전달도 제거한다. 환경 변수 자체는 이 스펙 범위에서 삭제하지 않는다(§7 후속 정리로 남김).
- 새 UI는 앱 자체 디자인 시스템으로 그리므로, 2026-09-07에 "Picker는 테마를 커스터마이징할 수 없다"는 이유로 보류됐던 디자인 일관성 요청도 부수적으로 해결된다.

## 6. 이 스펙에서 다루지 않는 것

- 폴더가 한 레벨에 100개를 넘는 경우의 페이지네이션/검색 — 필요 시 별도 재검토.
- 결제수단 관리(피드백 항목 2) — 완전히 별개 작업.
- `NEXT_PUBLIC_GOOGLE_API_KEY` 환경 변수 자체의 삭제/문서 정리.

## 7. 미해결 사항 / 후속 정리

- 폴더 브라우저 모달의 정확한 시각 디자인(바텀시트 vs 중앙 모달 등)은 구현 단계에서 앱 기존 UI 패턴에 맞춰 결정.
- `NEXT_PUBLIC_GOOGLE_API_KEY`는 이 변경 이후 코드에서 참조되지 않게 되지만, 배포 환경(Vercel) 환경 변수 자체는 사용자가 원할 때 별도로 정리.
- 실기기(iOS 홈화면 추가 PWA) 검증은 구현 완료 후 사용자가 직접 확인 필요 — Codex 샌드박스와 현재 개발 환경 모두 실제 iOS standalone 모드를 재현할 수 없음.

# 결제수단 관리 — 구현 계획

> **실행 방식 안내 (이 프로젝트 전용):** `2026-09-08-drive-folder-browser.md` 계획과 동일하게, 아래 태스크는 `superpowers:subagent-driven-development`/`superpowers:executing-plans`가 아니라 **각 태스크를 하나씩 `codex-auto` 스킬에 위임**하는 방식으로 실행한다. 구현 코드는 미리 적지 않고, Codex가 구현을 결정할 수 있도록 정확한 인터페이스/요구사항/테스트 시나리오만 명시한다.

**Goal:** 하드코딩된 4개 결제수단 `&lt;select&gt;`를, `설정` 시트에 저장되고 사용하면 자동으로 늘어나는 콤보박스(드롭다운+자유입력)로 교체한다.

**Architecture:** 백엔드는 스프레드시트에 `설정` 시트를 추가해 결제수단 목록을 읽고(`GET /api/expenses` 응답에 포함), 지출 저장/수정 시 새 값을 자동 등록한다(Task 1). 프론트엔드는 카테고리 필드가 이미 쓰는 `&lt;input list&gt;`+`&lt;datalist&gt;` 패턴을 결제수단에도 적용한다(Task 2).

**Tech Stack:** Next.js App Router, googleapis (Sheets API v4), Zod, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-payment-method-management-design.md`

## Global Constraints

- 새 API 라우트를 만들지 않는다 — 읽기는 기존 `GET /api/expenses` 응답 확장, 쓰기는 기존 `appendExpenseRow`/`updateExpenseRow` 내부에 통합한다 (스펙 §4).
- `설정` 시트가 없거나 비어있으면 기본값 `['체크카드', '신용카드', '현금', '계좌이체']`로 폴백한다 — 이 폴백은 API 라우트 레벨에서 처리하고 `lib/sheets.ts`는 시트의 원시 상태만 반환한다 (스펙 §4).
- 결제수단 삭제/관리 UI는 만들지 않는다 (스펙 §6, YAGNI).
- 결제수단 이름 정규화는 trim만 한다 — 대소문자 통일 등 과도한 정규화는 하지 않는다 (스펙 §7).

---

### Task 1: 설정 시트 읽기/쓰기 + API 응답 확장 (백엔드)

**Files:**
- Modify: `lib/sheets.ts` (`listPaymentMethods`, `ensurePaymentMethodRegistered` 추가, `appendExpenseRow`/`updateExpenseRow`에서 호출)
- Modify: `lib/sheets.test.ts`
- Modify: `app/api/expenses/route.ts` (GET 핸들러 응답에 `paymentMethods` 추가 + 기본값 폴백)
- Modify: `app/api/expenses/route.test.ts` (해당 파일이 없다면 기존 테스트 파일 이름 확인 후 갱신)

**Interfaces:**
- Produces: `lib/sheets.ts`가 export하는 `listPaymentMethods(accessToken: string, spreadsheetId: string): Promise<string[]>` — `설정` 시트가 없으면 빈 배열 반환. 있으면 `A2` 이하의 값을 순서 그대로 반환(빈 문자열 행 제외).
- Produces: `lib/sheets.ts`가 export하는 `ensurePaymentMethodRegistered(accessToken: string, spreadsheetId: string, method: string): Promise<void>` — `설정` 시트가 없으면 헤더(`결제수단`, `A1`)와 함께 생성한다(`ensureMonthSheet`의 `addSheet` + `values.update(A1)` 2단계 패턴을 그대로 따른다, `lib/sheets.ts:48-104` 참고). `method.trim()`이 이미 목록에 있으면 아무것도 하지 않는다. 없으면 `values.append`로 추가한다. 빈 문자열(trim 후)이면 아무것도 하지 않는다.
- Consumes: 기존 `appendExpenseRow`(`lib/sheets.ts:~119`)와 `updateExpenseRow`(`lib/sheets.ts:~138`)가 각자 행 쓰기에 성공한 뒤 `ensurePaymentMethodRegistered(accessToken, spreadsheetId, row.method)`를 호출하도록 수정한다.
- Produces: `GET /api/expenses` 응답 JSON에 `paymentMethods: string[]` 필드가 추가된다. `listPaymentMethods` 결과가 빈 배열이면 `['체크카드', '신용카드', '현금', '계좌이체']`로 대체한다.

**Definition of Done:**
- [ ] `lib/sheets.ts`에 `listPaymentMethods`, `ensurePaymentMethodRegistered`를 위 인터페이스대로 구현한다. `authClient`/`google.sheets({version:'v4', auth})` 등 파일 내 기존 관례(`lib/sheets.ts:14-18` 패턴)를 그대로 따른다. 시트 존재 확인은 `listSheets()`를 재사용한다. 값 쓰기는 `valueInputOption: 'USER_ENTERED'`를 사용한다(파일 내 기존 관례).
- [ ] `appendExpenseRow`, `updateExpenseRow`가 성공적으로 행을 쓴 뒤 `ensurePaymentMethodRegistered`를 호출하도록 수정한다.
- [ ] `app/api/expenses/route.ts`의 GET 핸들러가 `listPaymentMethods`를 호출해 응답에 `paymentMethods`를 포함시키고, 빈 배열일 때 기본값으로 폴백한다.
- [ ] `lib/sheets.test.ts`에 다음 시나리오 테스트를 추가한다: (a) `설정` 시트가 없을 때 `listPaymentMethods`가 빈 배열 반환, (b) 값이 있을 때 순서대로 반환, (c) `ensurePaymentMethodRegistered`가 시트를 새로 만들며 헤더+값을 씀, (d) 이미 존재하는 값이면 `values.append`를 호출하지 않음(멱등성), (e) `appendExpenseRow` 호출 시 `ensurePaymentMethodRegistered`가 저장된 `method` 값으로 호출됨, (f) `updateExpenseRow`도 동일.
- [ ] `app/api/expenses/route.test.ts`에 GET 응답에 `paymentMethods`가 포함되는 케이스와, 빈 목록일 때 기본값 4개로 폴백하는 케이스를 추가한다.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- lib/sheets.test.ts app/api/expenses/route.test.ts`로 새 테스트 먼저 확인 후 전체 `npm run test` 회귀 확인.

---

### Task 2: 결제수단 콤보박스 UI (프론트엔드)

**Files:**
- Modify: `components/ExpenseForm.tsx` (25행 하드코딩 `payments` 배열 제거, `paymentMethods` prop 추가, 결제수단 필드를 `&lt;select&gt;`에서 `&lt;input list&gt;`+`&lt;datalist&gt;`로 교체)
- Modify: `components/ExpenseDashboard.tsx` (`ExpensesResponse` 타입에 `paymentMethods` 추가, state 추가, `ExpenseForm`에 prop 전달)
- Modify: `components/ExpenseForm.test.tsx` (파일명이 다르면 기존 테스트 파일 확인 후 갱신)

**Interfaces:**
- Consumes: Task 1의 `GET /api/expenses` 응답 `paymentMethods: string[]`.
- Produces: `ExpenseForm`의 props 타입에 `paymentMethods: string[]`를 추가 (필수 prop).

**Definition of Done:**
- [ ] `components/ExpenseDashboard.tsx`의 `ExpensesResponse` 타입에 `paymentMethods: string[]`를 추가한다.
- [ ] `paymentMethods` state를 추가하고 초기값은 `['체크카드', '신용카드', '현금', '계좌이체']`로 시작한다. `fetchMonth` 안에서 `data.paymentMethods`로 갱신한다.
- [ ] `&lt;ExpenseForm&gt;`에 `paymentMethods={paymentMethods}`를 전달한다.
- [ ] `ExpenseForm.tsx`에서 25행의 하드코딩 `payments` 배열을 제거하고 `paymentMethods` prop을 사용한다.
- [ ] 결제수단 필드(127-133행)를 카테고리 필드(118-121행)와 동일한 구조로 교체한다: `&lt;input list="expense-payment-method-options" className={fieldClassName} .../&gt;` + `&lt;datalist id="expense-payment-method-options"&gt;{paymentMethods.map(...)}&lt;/datalist&gt;`. 기존 `&lt;select&gt;` 전용 스타일(`appearance-none`, SVG 셰브런 배경 이미지)은 제거한다. 130행의 "목록에 없는 현재 값 주입" 방어 로직은 `&lt;input list&gt;` 방식에서 불필요하므로 제거한다.
- [ ] `ExpenseForm.test.tsx`(또는 기존 테스트 파일)에 다음 시나리오를 추가/갱신한다: (a) `paymentMethods` prop으로 받은 값들이 datalist 옵션으로 렌더링됨, (b) 목록에 없는 새 값을 입력해도 폼 제출이 막히지 않음(자유 입력 허용 확인), (c) 기존 결제수단 관련 테스트 중 `&lt;select&gt;` 특정 동작(예: 옵션 선택 시뮬레이션)을 가정한 테스트가 있다면 `&lt;input list&gt;` 방식에 맞게 갱신.
- [ ] `npm run test`, `npm run lint`, `next build --webpack` 모두 통과.

**Verification:** `npm run test -- ExpenseForm` 확인 후 전체 테스트 스위트 통과 확인. 로컬에서 `npm run dev`로 실제 폼을 눌러 새 결제수단 입력 → 저장 → 다음 조회 시 자동완성에 나타나는지 수동 확인 권장(Task 1 완료 후 실제 스프레드시트에 반영되므로).

---

## Self-Review 메모

- 스펙 §3(데이터 모델), §4(API), §5(UI)가 각각 Task 1, Task 1, Task 2에 매핑됨. §6(범위 밖), §7(미해결)은 계획에 포함하지 않음 — 의도된 제외.
- Task 1의 `paymentMethods: string[]` 응답 필드와 Task 2가 소비하는 타입이 정확히 일치.
- Task 1과 Task 2는 `GET /api/expenses` 응답 계약으로만 연결되어 독립적으로 리뷰 가능.

# 결제수단 관리 — 설계 문서

- 날짜: 2026-09-08
- 상태: 초안 (사용자 리뷰 대기)
- 배경: 2026-09-07 사용자 피드백 2차 라운드 항목 2("결제수단 관리")를 다룸. 같은 라운드의 항목 1, 3은 완료됨. 항목 4(iOS PWA 쿠키 에러)는 별도 스펙(`2026-09-08-drive-folder-browser-design.md`)으로 분리, 구현은 보류 중.

## 1. 현재 상태 / 문제

`components/ExpenseForm.tsx:25`에 결제수단이 하드코딩되어 있다:

```ts
const payments = ['체크카드', '신용카드', '현금', '계좌이체'];
```

`&lt;select&gt;`로 렌더링되어(127-133행) 이 4개 중에서만 고를 수 있고, "신용카드"가 모든 신용카드사를 뭉뚱그린 단일 옵션이라 어떤 카드로 결제했는지 구분이 안 된다. 서버(`lib/expense.ts:8`, Zod 스키마 `method: z.string().min(1)`)는 이미 임의 문자열을 허용하지만, 폼 UI가 4개 옵션으로 막고 있는 게 실제 제약이다.

흥미롭게도 바로 옆 "카테고리" 필드는 이미 다른 패턴이다 — `&lt;input list="..."&gt;` + `&lt;datalist&gt;`(118-121행)로, 하드코딩된 제안 목록을 보여주되 자유 입력을 막지 않는다. 다만 카테고리도 입력값이 어디에도 저장/관리되지 않아 "관리되는 목록"이라 부르긴 어렵다.

## 2. 결정된 방향

- **저장 위치:** 스프레드시트 안에 `설정` 시트를 추가해 결제수단 목록을 저장한다 (사용자 확인 완료 — 기기 간 동기화됨, `localStorage` 방식은 기기를 바꾸면 목록이 사라지므로 제외).
- **입력 UI:** 드롭다운 + 직접입력(자동완성) 콤보박스로 바꾼다. 별도의 "결제수단 관리" 화면은 만들지 않는다 (사용자 확인 완료) — 새 값을 입력해서 저장하면 그 자리에서 자동으로 목록에 추가된다.
- 카테고리 필드가 이미 쓰고 있는 `&lt;input list&gt;` + `&lt;datalist&gt;` 패턴이 정확히 이 요구사항(선택 가능 + 자유 입력)과 일치하므로, 새 커스텀 드롭다운 컴포넌트를 만들지 않고 이 기존 패턴을 결제수단에도 그대로 적용한다. 카테고리 자체를 관리 목록으로 바꾸는 건 이번 스펙 범위 밖이다(§6).
- 삭제/수정 UI는 만들지 않는다(YAGNI) — 목록은 오직 "사용하면 추가됨" 방식으로만 늘어난다. 필요해지면 별도 스펙으로 재검토.

## 3. 데이터 모델

새 시트 `설정`을 스프레드시트 안에 추가한다 (기존 `findOrCreateSpreadsheet`가 관리하는 같은 파일 안, 월별 시트들과 나란히).

- `A1`: 헤더 `결제수단`.
- `A2` 이하: 등록된 결제수단 이름을 한 줄에 하나씩, 중복 없이.
- 순서: 처음 등록된 순서 그대로 (정렬하지 않음 — 최근에 자주 쓰는 게 자연스럽게 위쪽에 모임).
- 시트가 아직 없거나(신규 사용자) 비어있으면(기존 사용자가 아직 한 번도 새 값을 입력하지 않음), 기존 하드코딩 값 4개(`체크카드, 신용카드, 현금, 계좌이체`)를 API 응답의 기본값으로 사용한다 — 시트에 미리 써넣지는 않고, 실제로 그 값으로 지출이 저장되는 시점에 자연스럽게 시트에 등록되게 한다(§4).

## 4. API 변경

### 읽기 — 기존 `GET /api/expenses` 확장

`docs/superpowers/specs/2026-09-06-monthly-sheet-management-design.md`에서 `availableMonths`를 응답에 추가했던 것과 동일한 방식으로, `paymentMethods: string[]`을 추가한다.

- `lib/sheets.ts`에 `listPaymentMethods(accessToken, spreadsheetId): Promise<string[]>`을 추가한다. `설정` 시트가 없으면 빈 배열을 반환한다.
- API 라우트(`app/api/expenses/route.ts`의 GET 핸들러)에서 `listPaymentMethods` 결과가 비어있으면 기본값 4개(§3)로 폴백한다. 이 폴백 로직은 `lib/sheets.ts`가 아니라 라우트 레벨에 둔다 — `lib/sheets.ts`는 시트의 실제 상태를 있는 그대로 반환하는 책임만 지도록 기존 관례(`listSheets`, `readExpenseRows` 등도 가공 없이 원시 상태를 반환)를 따른다.

### 쓰기 — 기존 지출 저장/수정 흐름에 통합 (새 API 라우트 없음)

새 엔드포인트를 따로 만들지 않는다. 대신 `lib/sheets.ts`의 `appendExpenseRow`/`updateExpenseRow`가 각자 저장을 마친 뒤, 그 지출의 `method` 값이 `설정` 시트에 없으면 추가하는 단계를 내부적으로 수행한다.

- `lib/sheets.ts`에 `ensurePaymentMethodRegistered(accessToken, spreadsheetId, method): Promise&lt;void&gt;`을 추가한다.
  - `설정` 시트가 없으면 헤더(`결제수단`)와 함께 생성한다 (`ensureMonthSheet`가 월 시트를 만드는 것과 동일한 `addSheet` + `values.update(A1)` 2단계 패턴을 따른다).
  - 이미 존재하는 값이면 아무것도 하지 않는다(멱등성).
  - 없으면 `values.append`로 마지막 행에 추가한다.
- `appendExpenseRow`와 `updateExpenseRow`가 각자 성공적으로 행을 쓴 뒤 `ensurePaymentMethodRegistered`를 호출한다. 이렇게 하면 지출을 저장하는 모든 경로(새로 입력, 수정해서 값 변경)가 자동으로 결제수단 등록도 같이 처리한다 — 프론트가 별도로 "이 결제수단 등록해줘" 요청을 보낼 필요가 없다.

### 프론트엔드 반영

- `components/ExpenseDashboard.tsx`의 `ExpensesResponse` 타입에 `paymentMethods: string[]`을 추가하고, `fetchMonth`가 이를 `paymentMethods` state에 반영한다. 초기값은 §3의 기본값 4개로 시작한다(첫 조회가 끝나기 전에도 폼이 비어 보이지 않도록).
- `ExpenseForm`에 `paymentMethods: string[]` prop을 추가하고, 25행의 하드코딩된 `payments` 배열을 제거한다.
- `onSubmitted={fetchMonth}`(기존에 이미 저장 성공 후 재조회하는 콜백)가 그대로 `paymentMethods`도 최신 상태로 갱신해준다 — 새 결제수단을 입력해서 저장하면, 그다음 조회부터 자동완성 목록에 나타난다. 별도의 낙관적 업데이트는 필요 없다.

## 5. UI 설계

`components/ExpenseForm.tsx`의 결제수단 `&lt;select&gt;`(127-133행)를 카테고리(118-121행)와 동일한 구조로 바꾼다:

```
&lt;input list="expense-payment-method-options" ... className={fieldClassName} /&gt;
&lt;datalist id="expense-payment-method-options"&gt;
  {paymentMethods.map((m) =&gt; &lt;option key={m} value={m} /&gt;)}
&lt;/datalist&gt;
```

- `appearance-none` + SVG 셰브런 배경 이미지(`&lt;select&gt;` 전용으로 붙어있던 스타일, 129행)는 제거한다 — 카테고리 인풋처럼 `fieldClassName`만 그대로 쓴다(126행과 동일한 스타일 기반).
- 라벨 wrapper(`&lt;label className="flex flex-col gap-1 text-[11px] text-gray-400"&gt;`)는 기존과 동일하게 유지한다.
- 기존 방어 로직(130행 — 현재 값이 목록에 없으면 옵션을 끼워 넣던 것)은 `&lt;input list&gt;` 방식에서는 애초에 필요 없다 — datalist는 목록에 없는 값도 자유롭게 입력/표시할 수 있다.

## 6. 이 스펙에서 다루지 않는 것

- 결제수단 삭제/이름변경/관리 화면 — 현재는 "쓰면 자동 등록"만 지원.
- 카테고리 필드를 같은 방식(설정 시트 기반 관리 목록)으로 바꾸는 것 — 카테고리는 현재도 자유 입력이 이미 가능해서 이번 피드백 항목의 대상이 아니었다. 필요하면 별도로 논의.
- 신용카드 발급사별 사전 정의 목록 제공(예: "신한카드", "삼성카드" 등을 미리 채워두는 것) — 사용자가 처음 입력하는 값 그대로 등록되는 방식으로 자연스럽게 해결되므로 별도 시딩 로직을 만들지 않는다.

## 7. 미해결 사항

- 결제수단 이름의 대소문자/공백 차이로 인한 중복(예: "신한카드"와 "신한카드 ")을 어느 수준까지 정규화할지는 구현 단계에서 결정 (트림 정도만 할지, 대소문자까지 통일할지). 과도한 정규화는 사용자가 의도한 표기를 바꿔버릴 수 있어 최소한(trim)으로 시작하는 걸 권장.

# OCR: AI Gateway → Google AI Studio 직접 연결 전환 (다음 세션 재개용 메모)

- 날짜: 2026-09-08
- 상태: 결정만 됨, 구현 미착수 — 다음에 이어서 진행
- 배경: 2026-09-08 세 번째 피드백 라운드 항목 3("결제내역 인식 기능 설계"). Task 6(영수증 OCR)은 이미 구현/단위테스트 완료 상태로 `AI_GATEWAY_API_KEY` 빌링 결정 때문에 보류돼 있었음(`docs/superpowers/plans/2026-09-01-expense-tracker-mvp.md` Task 6/7, `CLAUDE.md` Status 섹션). 이번에 그 결정을 내림: Vercel AI Gateway 대신 Google AI Studio API 키로 직접 연결한다.

## 결정 사항

- **AI Gateway를 쓰지 않는다.** 대신 `@ai-sdk/google` 패키지로 Gemini를 직접 호출한다.
- 이유: 사용자에게 매달 약 $10 규모의 GCP 크레딧이 자연 발생하고 있음. Google AI Studio API 키를 GCP 결제 계정에 연결하면 이 크레딧이 OCR 사용량에 그대로 적용된다. AI Gateway를 쓰면 이 크레딧을 못 쓰고 Vercel 쪽 별도 빌링이 발생한다.
- Vertex AI(서비스 계정 기반 GCP 네이티브 방식)는 고려했으나 기각 — 개인 프로젝트 규모에 비해 설정(서비스 계정, Vertex AI API 활성화 등)이 과함. AI Studio API 키가 훨씬 간단하고 이 프로젝트 규모에 맞음.

## 사용자가 먼저 해야 할 일 (구현 전 필요)

1. [aistudio.google.com](https://aistudio.google.com)에서 API 키 발급.
2. 그 키가 속한 GCP 프로젝트에 결제 계정(월 ~$10 크레딧이 쌓이는 그 계정)을 연결/확인.
3. 발급받은 키를 Claude Code 세션에 전달하거나, 직접 `.env.local`과 Vercel 프로젝트 환경변수에 등록.

## 구현 시 변경 사항 (다음 세션에서 진행)

1. **의존성 추가**: `@ai-sdk/google` 패키지를 설치한다.
2. **`lib/ocr.ts:16-32`** — `extractReceiptData`의 `generateText` 호출에서 `model: 'google/gemini-3.5-flash-lite'`(AI Gateway용 `provider/model` 문자열)를 `@ai-sdk/google`의 직접 provider 호출로 교체한다: `import { google } from '@ai-sdk/google'` 후 `model: google('<model-id>')` 형태. **정확한 모델 ID는 구현 시점에 Google AI Studio 공식 문서로 재검증할 것** — Gateway 문자열의 `gemini-3.5-flash-lite`가 AI Studio 쪽 모델 ID와 이름이 다를 수 있고, Gemini 모델 라인업 자체가 계속 바뀌므로 과거 값을 그대로 믿지 않는다(`2026-09-01-expense-tracker-mvp.md` Task 6에 있던 것과 동일한 주의사항).
3. **환경변수**: `.env.local.example`의 `AI_GATEWAY_API_KEY=` 줄을 `GOOGLE_GENERATIVE_AI_API_KEY=`로 교체한다(`@ai-sdk/google`이 기본으로 읽는 환경변수명 — 구현 시 패키지 문서로 정확한 이름 재확인).
4. **에러 처리 보완 (기존에 이미 알려진 갭)** — `app/api/ocr/route.ts`가 `extractReceiptData` 호출을 try/catch 없이 그대로 두고 있어 provider 쪽 오류(키 누락, 할당량 초과, 이미지 처리 실패 등)가 구조화되지 않은 500으로 그대로 나간다. 이번 전환 작업에서 같이 고친다 — try/catch로 감싸고 `{ error: string }` 형태의 구조화된 응답을 반환하도록.
5. Task 7(OCR-to-Form 연동, `2026-09-01-expense-tracker-mvp.md` 참고)은 Task 6이 다시 동작하는 걸 확인한 뒤 이어서 진행한다.

## 이 메모에서 다루지 않는 것

- 실제 코드 구현 — 이건 다음 세션에서 위 내용을 바탕으로 codex-auto에 위임해 진행한다.
- Task 7(OCR-to-Form 통합)의 세부 설계 — 이미 `2026-09-01-expense-tracker-mvp.md`에 있으므로 재작성하지 않는다.

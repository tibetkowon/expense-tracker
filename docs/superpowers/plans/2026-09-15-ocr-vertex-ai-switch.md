# OCR: AI Studio 계획 폐기 → Vertex AI 직접 연결로 전환 (다음 세션 재개용 메모)

- 날짜: 2026-09-15
- 상태: 결정만 됨, 구현 미착수 — 다음에 이어서 진행
- 이 문서는 `docs/superpowers/plans/2026-09-08-ocr-google-ai-studio-switch.md`를 대체한다 (그 문서의 결정은 폐기).

## 왜 계획이 바뀌었나

2026-09-08 계획은 "Google AI Studio API 키로 직접 연결하면 월 ~$10 GCP 크레딧(Google Developer Program premium benefit, `CREDIT_TYPE_MONTHLY`)이 OCR 비용에 그대로 적용된다"고 가정하고 Vertex AI를 "개인 프로젝트치곤 설정이 과함"이라는 이유로 기각했었다.

실제로 연결해보니 그 가정이 틀렸다:

- Google AI Studio의 Gemini API는 **Prepay(선불) 모델**로 바뀌어 있다. 쓰려면 카드로 prepaid 크레딧을 먼저 충전해야 하고, GCP Cloud Billing 크레딧(월간 Developer Program 크레딧이든 $300 웰컴 크레딧이든)으로는 이 prepay 충전 자체를 살 수 없다.
- 월 $10 Developer Program 크레딧은 결제 계정(Cloud Billing account)에는 정상적으로 쌓이지만, AI Studio는 그걸 "즉시 쓸 수 있는 잔액"으로 인식하지 않는다 → "No available credits" 에러.
- **Vertex AI는 Postpay(후불) 모델**이라 Cloud Billing 계정에서 바로 차감된다. 크레딧이 실제로 적용되는 곳은 AI Studio가 아니라 Vertex AI였다.

즉, 크레딧을 실제로 쓰려면 "설정이 더 간단한 AI Studio"가 아니라 "크레딧이 실제로 먹히는 Vertex AI"로 가야 한다. 사용자 확인: Vertex AI 전환 선택함 (2026-09-15).

## 결정 사항

- **Vertex AI로 직접 연결한다.** `@ai-sdk/google-vertex` 패키지로 Gemini를 호출한다.
- 인증 방식은 **서비스 계정 키 JSON** (Application Default Credentials)로 한다. Vercel의 OIDC/Workload Identity Federation 방식(`@vercel/oidc` + External Account Client)도 검토했으나, 이건 프로덕션 배포에서만 동작하고 GCP 콘솔에 Workload Identity Pool/Provider/IAM 바인딩을 여러 단계 설정해야 하는 엔터프라이즈급 구성이라 개인 프로젝트 규모에는 과함 — 기각.
- AI Gateway는 계속 쓰지 않는다 (2026-09-08 결정 유지 — 크레딧을 못 쓰고 Vercel 쪽 별도 빌링이 발생하기 때문).

## 사용자가 먼저 해야 할 일 (구현 전 필요)

1. GCP 콘솔에서 **Vertex AI API**를 프로젝트에 활성화 (`aiplatform.googleapis.com`).
2. 해당 프로젝트에 결제 계정(월 ~$10 크레딧이 쌓이는 계정)이 연결되어 있는지 확인.
3. **IAM & 관리자 → 서비스 계정**에서 새 서비스 계정 생성 (예: `expense-tracker-ocr`), `Vertex AI User`(`roles/aiplatform.user`) 역할 부여.
4. 그 서비스 계정의 키를 JSON으로 발급 (Actions → 키 관리 → 키 추가 → JSON).
5. 발급받은 JSON 키를 Claude Code 세션에 전달하거나, 직접 `.env.local`과 Vercel 프로젝트 환경변수에 등록 (JSON 원문을 그대로 넣거나 base64로 인코딩 — 구현 시 확정).

**주의**: 서비스 계정 JSON 키는 `.gitignore`에 이미 걸려있는 `.env.local`에만 두고 절대 커밋하지 않는다.

## 구현 시 변경 사항 (다음 세션에서 진행)

1. **의존성 추가**: `@ai-sdk/google-vertex` 패키지를 설치한다 (AI SDK 버전이 `ai@7.0.87`이므로 호환 버전 확인).
2. **`lib/ocr.ts:16-32`** — `extractReceiptData`의 `generateText` 호출에서 `model: 'google/gemini-3.5-flash-lite'`(AI Gateway용 `provider/model` 문자열)를 `@ai-sdk/google-vertex`의 직접 provider 호출로 교체한다: `import { vertex } from '@ai-sdk/google-vertex'` 후 `model: vertex('<model-id>')` 형태. **정확한 모델 ID는 구현 시점에 Vertex AI 공식 문서로 재검증할 것** — Gemini 모델 라인업이 계속 바뀌므로 과거 값을 그대로 믿지 않는다.
3. **환경변수**: `.env.local.example`의 `AI_GATEWAY_API_KEY=` 줄을 Vertex AI 인증에 필요한 변수로 교체한다 (`GOOGLE_APPLICATION_CREDENTIALS_JSON` 또는 유사 이름 — 구현 시 `@ai-sdk/google-vertex` 문서로 정확한 이름과 형식 재확인). `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`도 필요.
4. **서비스 계정 인증 로드** — Vercel 서버리스 환경에서는 파일 시스템에 키 파일을 둘 수 없으므로, 서비스 계정 JSON을 환경변수 문자열로 주입하고 런타임에 파싱해서 `googleAuthOptions.credentials`로 넘기는 방식이 필요. 구현 시 `@ai-sdk/google-vertex` 공식 문서로 정확한 옵션 이름 재확인.
5. **에러 처리 보완 (기존에 이미 알려진 갭, 2026-09-08 계획에서도 지적됨)** — `app/api/ocr/route.ts:16`이 `extractReceiptData` 호출을 try/catch 없이 그대로 두고 있어 provider 쪽 오류(인증 실패, 할당량 초과, 이미지 처리 실패 등)가 구조화되지 않은 500으로 그대로 나간다. 이번 전환 작업에서 같이 고친다 — try/catch로 감싸고 `{ error: string }` 형태의 구조화된 응답을 반환하도록.
6. Task 7(OCR-to-Form 연동, `2026-09-01-expense-tracker-mvp.md` 참고)은 Task 6이 다시 동작하는 걸 확인한 뒤 이어서 진행한다.

## 이 메모에서 다루지 않는 것

- 실제 코드 구현 — 이건 다음 세션에서 위 내용을 바탕으로 codex-auto에 위임해 진행한다. (Codex 샌드박스는 네트워크가 없으므로, 실제 Vertex AI 호출 검증은 Claude Code가 사용자 서비스 계정 키를 받은 뒤 직접 수행해야 한다.)
- Task 7(OCR-to-Form 통합)의 세부 설계 — 이미 `2026-09-01-expense-tracker-mvp.md`에 있으므로 재작성하지 않는다.

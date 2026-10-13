# FORGE API 契约基线

本文档记录当前客户端已经实现并严格校验的服务端契约，以及 `server/index.mjs` 已落地的第一批真实 API。它不是本地 Mock；生产验收仍必须使用 HTTPS、真实鉴权、真实数据库和已配置的内容/邮件供应商。

## 通用约束

- Base URL 由 `EXPO_PUBLIC_FORGE_API_URL` 提供，客户端不保存模型供应商密钥或服务端鉴权密钥。
- 需要登录的请求使用 `Authorization: Bearer <accessToken>`。
- JSON 接口使用 `Accept: application/json`；有请求体时同时使用 `Content-Type: application/json`。
- 失败响应建议统一返回 `{ "message": "用户可理解的错误说明", "code": "稳定错误码" }`。客户端不会把失败当作成功，也不会在服务未配置时补示例数据。
- 服务端必须限制请求频率、脱敏日志、校验账户归属，并支持撤销会话。

## 账户与隐私

### `POST /v1/auth/register`、`POST /v1/auth/login`

请求：

```json
{ "email": "user@example.com", "password": "...", "confirmPassword": "..." }
```

响应至少包含：

```json
{ "accessToken": "...", "refreshToken": "...", "profile": { "id": "...", "name": "...", "initials": "...", "goal": { "type": "maintenance", "label": "维持" } } }
```

`profile` 也可使用兼容字段名 `user`。客户端要求 `accessToken` 和 `profile.id` 存在。

### `GET /v1/auth/session`

使用 Bearer token 校验会话并返回 `profile`/`user`；无效会话返回非 2xx。客户端收到失败会清理本地会话，不继续展示已登录状态。

### `POST /v1/auth/refresh`

请求 `{ "refreshToken": "..." }`。服务端必须一次性撤销旧 refresh token 并返回新的 access/refresh token 与 profile；客户端只在 access token 校验失败时尝试一次轮换，轮换失败会回到未登录状态。

### `POST /v1/auth/logout`

服务端撤销当前 refresh token 或会话。客户端即使网络失败也会清理本机账户数据，因此服务端需要支持过期 token 的幂等处理。

### `POST /v1/auth/forgot-password`

请求 `{ "email": "user@example.com" }`。生产环境应采用不泄露账户是否存在的响应文案，并由服务端发送一次性、限时、可撤销的重置链接。

### `POST /v1/auth/reset-password`

请求 `{ "token": "...", "password": "...", "confirmPassword": "..." }`。服务端必须校验 token 未使用且未过期，更新密码后撤销该用户所有旧会话，并使 token 一次性失效。

### `DELETE /v1/account`

删除请求必须完成账户数据删除/匿名化、健康数据关联清理、Coach 数据与同意记录的处理，并返回可验证的完成状态。客户端只有在请求成功后才清理本机账户数据。

### `POST /v1/account/export`

服务端生成不含密码哈希、会话 token 的 JSON 导出文件，并创建 24 小时有效的一次性下载 token。返回 `202 Accepted` 和任务号：

```json
{ "jobId": "export_...", "status": "ready", "downloadUrl": "https://api.example.com/v1/account/export/export_.../download?token=...", "expiresAt": "2026-09-10T12:00:00Z" }
```

没有配置 HTTPS `FORGE_PUBLIC_BASE_URL` 时，即使文件已生成，`downloadUrl` 也可能为 `null`；客户端必须明确提示发布配置缺失，不得自行拼接 URL。`GET /v1/account/export/:jobId/download?token=...` 仅接受服务端签发的一次性 token，下载后 token 失效。删除账户必须删除关联导出文件和任务记录。

## 真实内容服务

### `GET /v1/nutrition/foods/search`

查询参数：`query`、`limit`（1–50）、`sort`（`relevance` 或 `calories_asc`）、可选 `cursor`。

响应：

```json
{
  "foods": [{
    "id": "food_...",
    "name": "Food name",
    "caloriesPer100g": 100,
    "protein": 10,
    "carbs": 20,
    "fat": 3,
    "defaultServing": "100 g",
    "unit": "g",
    "sourceName": "Authoritative source",
    "sourceUrl": "https://example.com/source",
    "license": "License text"
  }],
  "nextCursor": null
}
```

服务端第一批可以从该用户已同步的真实食物池返回结果，来源标记为“用户录入数据”；没有同步数据时返回空数组，不返回示例。生产全球营养数据 provider 仍必须提供可追溯来源、许可和营养数据版本；分页与排序不能只在客户端伪造。

### `GET /v1/training/exercises/search?query=...`

响应：`{ "exercises": [{ "id": "exercise_...", "name": "...", "muscleGroup": "...", "equipment": "..." }] }`。服务端第一批从用户已同步的真实训练计划动作中检索，没有数据时返回空数组；动作详情、肌群分类、替代动作和渐进规则仍需服务端扩展。

## Coach

### `POST /v1/coach/messages`

请求包含 `question`、最近最多 8 条 `history`、已授权的 `context` 和服务端需要的审计元数据。当前客户端接受 JSON `text`，或兼容 OpenAI 风格的 `choices[0].message.content`；`actionHint` 必须属于客户端白名单，不能直接修改用户数据。

生产版本还需：流式响应、会话历史回读/删除、consent audit、撤销授权即时生效、敏感数据脱敏、成本/限流保护和真实语音转写。未授权时服务端必须拒绝接收个人上下文。

当前服务端第一批已提供 `PUT /v1/account/coach-consent`，记录授权/撤销审计并让撤销即时生效；若 `FORGE_AI_BASE_URL`、`FORGE_AI_API_KEY`、`FORGE_AI_MODEL` 均已配置，则使用 OpenAI-compatible `POST /chat/completions` 生成真实回答。缺任一配置、provider 失败或返回空内容时均返回明确 503，不生成本地回答。

## 同步与冲突

### `PUT /v1/sync/snapshot`

请求是当前本地快照，并额外携带 `baseRevision`；不包含 `authSession` 或客户端密钥。服务端必须按用户隔离数据、校验快照版本、保存服务端 revision，并在成功时返回至少 `{ "revision": 1, "updatedAt": "..." }`。客户端只接受非负整数 revision 和字符串时间。

如果客户端基于过期 revision 写入，服务端必须返回 `409 Conflict`，不得静默覆盖另一设备的数据。当前客户端会进入冲突保护状态；后续需要服务端提供版本读取、差异合并和用户选择本地/云端/逐字段合并的契约后，才能实现完整冲突解决。

## 健康数据

HealthKit/Health Connect 数据先由原生端按用户授权读取，客户端不会在 Web 或未授权状态补默认值。后台增量同步、健康数据服务端合并、隐私政策、删除/导出边界和真机权限验收必须在正式 API 与原生签名环境中完成。
USDA FoodData Central provider: set FORGE_USDA_API_KEY only on the API server. The API maps official nutrient values and returns sourceName/sourceUrl/license; without the key, the endpoint remains user-data-only and never seeds examples. Official guide: https://fdc.nal.usda.gov/api-guide/

### Email verification

- POST /v1/auth/verify-email consumes a one-time verification token and returns 204; expired or reused tokens fail.
- Authenticated POST /v1/account/email-verification/resend returns 202 only after the configured email verification webhook accepts delivery. Without FORGE_EMAIL_VERIFICATION_WEBHOOK_URL, it returns 503 and the client must show an unconfigured state.
- The webhook receives purpose, email, token, and expiresAt; it must deliver the actual email/link and must not be treated as a mail provider itself.


### Email verification deep link

The native route forge://verify-email?token=<one-time-token> consumes the one-time token from the real delivery provider. The app only renders success after POST /v1/auth/verify-email returns successfully; missing, expired, reused, unconfigured, or failed delivery states remain visible as failures. The configured delivery provider must generate this exact deep link after accepting the webhook payload.


### Email delivery webhook security

Email verification delivery requires both FORGE_EMAIL_VERIFICATION_WEBHOOK_URL and FORGE_EMAIL_VERIFICATION_WEBHOOK_SECRET. FORGE sends X-FORGE-Timestamp, X-FORGE-Signature, Idempotency-Key, and X-FORGE-Attempt headers. The signature is HMAC-SHA256 over timestamp + "." + raw JSON body. Transient failures and timeouts retry up to three times with the same idempotency key; non-retryable 4xx responses fail immediately. Missing URL or secret never reports delivery success.

### MFA / account security

GET /v1/account/mfa returns enabled and enabledAt.
POST /v1/account/mfa/setup returns a real, expiring secret and otpauthUri; the client may render a QR code from that URI but must never invent one.
POST /v1/account/mfa/enable verifies TOTP and returns the one-time recovery codes.
DELETE /v1/account/mfa verifies current TOTP and disables MFA.
GET /v1/account/mfa/recovery-codes returns only total and remaining.
POST /v1/account/mfa/recovery-codes verifies current TOTP, revokes old recovery codes, and returns eight new one-time codes.
DELETE /v1/account/mfa/recovery-codes verifies current TOTP and revokes all unused recovery codes.
Recovery-code management is independently rate-limited; all changes are recorded in user-scoped security audit events.
GET /v1/account/security-audit?cursor=&limit= returns only the authenticated user's eventType and createdAt records with a nextCursor; it never returns credentials.
Security audit records are included in account exports and are deleted with the account. The server retains them for FORGE_SECURITY_AUDIT_RETENTION_DAYS (default 180, clamped to 30-730 days).



### Email change verification

- Authenticated POST /v1/account/email-change/request requires newEmail and currentPassword; the server checks the current password, prevents duplicate addresses, and returns 202 only after the configured real email webhook accepts delivery.
- The webhook payload uses purpose email_change_verification, a one-time token, the new email, and a 24-hour expiry. The existing forge://verify-email?token=... route consumes the token.
- Successful email-change verification updates the account email, marks it verified, revokes all existing sessions, and records a security audit event. Expired, reused, or unavailable tokens never change the account.

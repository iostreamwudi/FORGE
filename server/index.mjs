import { createServer } from 'node:http';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const port = Number.parseInt(process.env.FORGE_API_PORT ?? '8787', 10);
const apiHost = process.env.FORGE_API_HOST ?? '127.0.0.1';
const databasePath = resolve(process.env.FORGE_DB_PATH ?? './.data/forge.sqlite');
const sessionDays = 30;
const maxBodyBytes = 5 * 1024 * 1024;
const authRateWindowMs = 15 * 60 * 1000;
const authRateMaxAttempts = 10;
const mfaRateMaxAttempts = 5;
const resetWebhook = String(process.env.FORGE_PASSWORD_RESET_WEBHOOK_URL ?? '').trim();
const emailVerificationWebhook = String(process.env.FORGE_EMAIL_VERIFICATION_WEBHOOK_URL ?? '').trim();
const emailVerificationWebhookSecret = String(process.env.FORGE_EMAIL_VERIFICATION_WEBHOOK_SECRET ?? '').trim();
const securityAuditRetentionDaysValue = Number.parseInt(process.env.FORGE_SECURITY_AUDIT_RETENTION_DAYS ?? '180', 10);
const securityAuditRetentionDays = Number.isInteger(securityAuditRetentionDaysValue) ? Math.min(Math.max(securityAuditRetentionDaysValue, 30), 730) : 180;
const privacyPolicyVersion = String(process.env.FORGE_PRIVACY_POLICY_VERSION ?? '2026-09-10').trim();
const privacyPolicyEffectiveAt = String(process.env.FORGE_PRIVACY_POLICY_EFFECTIVE_AT ?? '2026-09-10').trim();
const exportDirectory = resolve(process.env.FORGE_EXPORT_DIR ?? './.data/exports');
const publicBaseUrl = String(process.env.FORGE_PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
const usdaApiKey = String(process.env.FORGE_USDA_API_KEY ?? '').trim();
const trainingCatalogUrl = String(process.env.FORGE_TRAINING_CATALOG_URL ?? '').trim().replace(/\/$/, '');
const trainingCatalogApiKey = String(process.env.FORGE_TRAINING_CATALOG_API_KEY ?? '').trim();
const aiBaseUrl = String(process.env.FORGE_AI_BASE_URL ?? '').trim().replace(/\/$/, '');
const aiApiKey = String(process.env.FORGE_AI_API_KEY ?? '').trim();
const aiModel = String(process.env.FORGE_AI_MODEL ?? '').trim();
const voiceTranscriptionUrl = String(process.env.FORGE_VOICE_TRANSCRIPTION_URL ?? '').trim();
const voiceApiKey = String(process.env.FORGE_VOICE_API_KEY ?? '').trim();
const voiceModel = String(process.env.FORGE_VOICE_MODEL ?? '').trim();
const opsMetricsToken = String(process.env.FORGE_OPS_METRICS_TOKEN ?? '').trim();
const progressionAdminToken = String(process.env.FORGE_PROGRESSION_ADMIN_TOKEN ?? '').trim();
const progressionDefaultVersion = String(process.env.FORGE_PROGRESSION_RULE_VERSION ?? 'progression-v1').trim() || 'progression-v1';
const progressionDefaultWindowDaysValue = Number.parseInt(process.env.FORGE_PROGRESSION_RULE_WINDOW_DAYS ?? '90', 10);
const progressionDefaultWindowDays = Number.isInteger(progressionDefaultWindowDaysValue) ? Math.min(Math.max(progressionDefaultWindowDaysValue, 7), 365) : 90;

const privacyPolicySections = [
  { id: 'data-use', title: '数据使用', body: 'FORGE 使用账户信息提供登录、同步、训练记录、营养记录和 Coach 服务。Coach 只有在你明确授权后才会收到训练、状态和饮食上下文。' },
  { id: 'health-data', title: '健康数据边界', body: '健康数据由 App 在获得系统权限后从设备读取；当你登录并开启云端同步时，已确认的健康快照会作为账户快照存储在 FORGE 服务端，用于跨设备恢复与趋势展示。你可以通过删除账户移除这些云端关联数据。写入今日状态前由你主动确认。' },
  { id: 'security', title: '安全与登录', body: '登录会话会记录设备平台标签、创建时间、最近活跃时间和到期时间，用于在账户中识别并撤销其他会话。MFA、恢复码、邮箱验证和安全活动按账户关联管理。' },
  { id: 'retention', title: '保留期限', body: '安全活动记录按部署策略保留并由服务端自动清理；当前策略保留期由接口返回。导出文件有独立到期时间，下载或撤销后不可继续使用。' },
  { id: 'rights', title: '导出与删除', body: '你可以申请账户数据导出、查看导出历史并撤销尚未下载的导出文件；删除账户时会删除账户、会话、MFA、邮箱验证、Coach、反馈、安全活动和导出文件等关联数据。' },
  { id: 'contact', title: '策略变更', body: '政策版本与生效日期由服务端部署配置提供。策略变更后应重新查看版本和日期；当前 App 不会在未读取到真实策略时显示默认承诺。' },
];

function privacyPolicyPayload() {
  return {
    version: privacyPolicyVersion,
    effectiveAt: privacyPolicyEffectiveAt,
    securityAuditRetentionDays,
    exportIncludesSecurityAudit: true,
    accountDeletionIncludesSecurityAudit: true,
    healthDataStoredServerSide: true,
    sections: privacyPolicySections,
  };
}

if (!process.env.FORGE_SESSION_SECRET || String(process.env.FORGE_SESSION_SECRET).length < 32) {
  throw new Error('FORGE_SESSION_SECRET must be set to at least 32 characters before starting the API.');
}

mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(exportDirectory, { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    initials TEXT NOT NULL,
    goal_type TEXT NOT NULL,
    goal_label TEXT NOT NULL,
    coach_data_consent INTEGER NOT NULL DEFAULT 0,
    email_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_hash TEXT NOT NULL UNIQUE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    user_agent TEXT,
    last_seen_at TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_access_idx ON sessions(access_token_hash);
  CREATE TABLE IF NOT EXISTS mfa_factors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    secret_ciphertext TEXT NOT NULL,
    setup_expires_at TEXT,
    enabled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS mfa_recovery_user_idx ON mfa_recovery_codes(user_id, used_at);
  CREATE TABLE IF NOT EXISTS mfa_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS security_audit_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS security_audit_user_created_idx ON security_audit_events(user_id, created_at);

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    download_url TEXT,
    download_token_hash TEXT,
    file_path TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    downloaded_at TEXT
  );
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS email_change_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    new_email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS coach_audit_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    consent_enabled INTEGER NOT NULL,
    context_sent INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coach_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    source_question TEXT,
    feedback TEXT,
    request_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS coach_messages_user_created_idx ON coach_messages(user_id, created_at);
  CREATE TABLE IF NOT EXISTS coach_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    date_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_message_preview TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    summary_updated_at TEXT,
    archived_at TEXT,
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS coach_conversations_user_updated_idx ON coach_conversations(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS coach_conversations_user_date_idx ON coach_conversations(user_id, date_key);
  CREATE TABLE IF NOT EXISTS coach_requests (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    conversation_id TEXT,
    question TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, request_id)
  );
  CREATE INDEX IF NOT EXISTS coach_requests_user_updated_idx ON coach_requests(user_id, updated_at);
  CREATE TABLE IF NOT EXISTS coach_provider_metrics (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    first_delta_ms INTEGER,
    response_chars INTEGER NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS coach_provider_metrics_created_idx ON coach_provider_metrics(created_at);
  CREATE INDEX IF NOT EXISTS coach_provider_metrics_user_created_idx ON coach_provider_metrics(user_id, created_at);

  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    rate_key TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progression_rule_configs (
    version TEXT PRIMARY KEY,
    window_days INTEGER NOT NULL,
    status TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    activated_at TEXT,
    retired_at TEXT,
    created_by TEXT NOT NULL,
    change_note TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progression_rule_audit (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    event_type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS progression_rule_audit_created_idx ON progression_rule_audit(created_at);
`);


const initialProgressionRule = db.prepare('SELECT version FROM progression_rule_configs WHERE status = ? ORDER BY activated_at DESC LIMIT 1').get('active');
if (!initialProgressionRule) {
  const createdAt = iso();
  const config = JSON.stringify({ algorithm: 'progression-trend-v1', windowDays: progressionDefaultWindowDays });
  db.prepare('INSERT OR IGNORE INTO progression_rule_configs (version, window_days, status, config_json, created_at, activated_at, retired_at, created_by, change_note) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)').run(progressionDefaultVersion, progressionDefaultWindowDays, 'active', config, createdAt, createdAt, 'system', '初始部署规则配置');
  db.prepare('INSERT INTO progression_rule_audit (id, version, event_type, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)').run(id('progression_audit'), progressionDefaultVersion, 'initial_activation', 'active', 'system', '初始部署规则配置', createdAt);
}
try { db.exec('ALTER TABLE export_jobs ADD COLUMN download_token_hash TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE export_jobs ADD COLUMN file_path TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE export_jobs ADD COLUMN downloaded_at TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE sessions ADD COLUMN user_agent TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE sessions ADD COLUMN last_seen_at TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE coach_messages ADD COLUMN request_id TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE coach_messages ADD COLUMN conversation_id TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE coach_requests ADD COLUMN conversation_id TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE coach_conversations ADD COLUMN summary TEXT'); } catch { /* Existing database already has the column. */ }
try { db.exec('ALTER TABLE coach_conversations ADD COLUMN summary_updated_at TEXT'); } catch { /* Existing database already has the column. */ }
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS coach_messages_user_request_idx ON coach_messages(user_id, request_id) WHERE request_id IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS coach_messages_conversation_created_idx ON coach_messages(user_id, conversation_id, created_at)');
try { db.exec('DROP INDEX IF EXISTS coach_conversations_user_date_active_idx'); } catch {}
db.exec('CREATE INDEX IF NOT EXISTS coach_conversations_user_date_idx ON coach_conversations(user_id, date_key)');

function now() { return new Date(); }
function iso(date = now()) { return date.toISOString(); }
function id(prefix) { return `${prefix}_${randomBytes(16).toString('hex')}`; }
function token() { return randomBytes(32).toString('base64url'); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}
function passwordMatches(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  return safeEqual(actual, expected);
}
function corsHeaders() {
  return { 'Access-Control-Allow-Origin': process.env.FORGE_CORS_ORIGIN ?? '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept', Vary: 'Origin' };
}
function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(), ...extraHeaders });
  res.end(body);
}
function empty(res, status = 204) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...corsHeaders() });
  res.end();
}
function error(res, status, code, message) { json(res, status, { code, message }); }
function clientAddress(req) { return String(req.socket?.remoteAddress ?? 'unknown'); }
function rateLimitKeys(req, scope, identity) { return [`${scope}:ip:${clientAddress(req)}`, `${scope}:identity:${identity || 'unknown'}`]; }
function consumeRateLimit(req, scope, identity, maxAttempts = authRateMaxAttempts) {
  const nowMs = Date.now();
  const keys = rateLimitKeys(req, scope, identity);
  let blocked = false;
  keys.forEach((rateKey) => {
    const row = db.prepare('SELECT window_started_at AS windowStartedAt, attempts FROM auth_rate_limits WHERE rate_key = ?').get(rateKey);
    if (!row || nowMs - row.windowStartedAt >= authRateWindowMs) db.prepare('INSERT OR REPLACE INTO auth_rate_limits (rate_key, window_started_at, attempts) VALUES (?, ?, 1)').run(rateKey, nowMs);
    else {
      if (row.attempts >= maxAttempts) blocked = true;
      db.prepare('UPDATE auth_rate_limits SET attempts = attempts + 1 WHERE rate_key = ?').run(rateKey);
    }
  });
  return blocked;
}
function clearRateLimit(req, scope, identity) { rateLimitKeys(req, scope, identity).forEach((rateKey) => db.prepare('DELETE FROM auth_rate_limits WHERE rate_key = ?').run(rateKey)); }
function rateLimited(res, message) { return json(res, 429, { code: 'AUTH_RATE_LIMITED', message }, { 'Retry-After': String(authRateWindowMs / 1000) }); }
function parseEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function parsePassword(value) {
  const password = String(value ?? '');
  return password.length >= 6 && password.length <= 256 ? password : null;
}
function profileFromRow(row) {
  return { id: row.id, name: row.name, initials: row.initials, goal: { type: row.goal_type, label: row.goal_label }, coachDataConsent: Boolean(row.coach_data_consent), emailVerified: Boolean(row.email_verified_at) };
}
async function postEmailWebhook(payload, idempotencyKey) {
  if (!emailVerificationWebhook || !emailVerificationWebhookSecret) return false;
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', emailVerificationWebhookSecret).update(timestamp + '.' + body).digest('hex');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(emailVerificationWebhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-FORGE-Timestamp': timestamp,
          'X-FORGE-Signature': 'sha256=' + signature,
          'Idempotency-Key': idempotencyKey,
          'X-FORGE-Attempt': String(attempt),
        },
        body,
        signal: controller.signal,
      });
      if (response.ok) return true;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return false;
    } catch {
      // Retry transient network failures and timeouts with the same idempotency key.
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** (attempt - 1))));
  }
  return false;
}
async function deliverEmailVerification(user) {
  if (!emailVerificationWebhook || !emailVerificationWebhookSecret) return { status: 'unconfigured' };
  const verificationToken = token();
  const tokenHash = hash(verificationToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id);
  db.prepare('INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(id('emailv'), user.id, tokenHash, iso(expiresAt));
  const sent = await postEmailWebhook({ purpose: 'email_verification', email: user.email, token: verificationToken, expiresAt: iso(expiresAt) }, 'email-verification-' + tokenHash);
  if (!sent) {
    db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ? AND token_hash = ?').run(user.id, tokenHash);
    return { status: 'failed' };
  }
  return { status: 'sent', expiresAt: iso(expiresAt) };
}
async function deliverEmailChange(user, newEmail) {
  if (!emailVerificationWebhook || !emailVerificationWebhookSecret) return { status: 'unconfigured' };
  const verificationToken = token();
  const tokenHash = hash(verificationToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  db.prepare('DELETE FROM email_change_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id);
  db.prepare('INSERT INTO email_change_tokens (id, user_id, new_email, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)').run(id('emailchg'), user.id, newEmail, tokenHash, iso(expiresAt));
  const sent = await postEmailWebhook({ purpose: 'email_change_verification', email: newEmail, token: verificationToken, expiresAt: iso(expiresAt) }, 'email-change-' + tokenHash);
  if (!sent) {
    db.prepare('DELETE FROM email_change_tokens WHERE user_id = ? AND token_hash = ?').run(user.id, tokenHash);
    return { status: 'failed' };
  }
  return { status: 'sent', expiresAt: iso(expiresAt) };
}
const mfaEncryptionKey = createHash('sha256').update(String(process.env.FORGE_SESSION_SECRET ?? '') + ':mfa').digest();

function base32Encode(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let buffer = 0;
  let bits = 0;
  let output = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}
function base32Decode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let buffer = 0;
  let bits = 0;
  const bytes = [];
  for (const character of String(value).toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('MFA_SECRET_INVALID');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
function encryptMfaSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', mfaEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}
function decryptMfaSecret(value) {
  const [ivValue, ciphertextValue, tagValue] = String(value).split('.');
  const decipher = createDecipheriv('aes-256-gcm', mfaEncryptionKey, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
}
function totpCode(secret, timestamp = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30_000)));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}
function validTotp(secret, code) {
  const normalized = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  return [-30_000, 0, 30_000].some((offset) => safeEqual(totpCode(secret, Date.now() + offset), normalized));
}
function newMfaRecoveryCodes() {
  return Array.from({ length: 8 }, () => randomBytes(5).toString('hex').toUpperCase().match(/.{1,4}/g).join('-'));
}
function findEnabledMfa(userId) {
  return db.prepare('SELECT * FROM mfa_factors WHERE user_id = ? AND enabled_at IS NOT NULL').get(userId);
}
function recordSecurityAudit(userId, eventType) {
  db.prepare('INSERT INTO security_audit_events (id, user_id, event_type, created_at) VALUES (?, ?, ?, ?)').run(id('secaudit'), userId, eventType, iso());
}
function pruneSecurityAudit() {
  const cutoff = new Date(Date.now() - securityAuditRetentionDays * 24 * 60 * 60 * 1000);
  db.prepare('DELETE FROM security_audit_events WHERE created_at < ?').run(iso(cutoff));
}
pruneSecurityAudit();

function sessionDeviceLabel(userAgent) {
  const value = String(userAgent ?? '');
  if (/iPad|iPhone|iPod/i.test(value)) return 'Apple 移动设备';
  if (/Android/i.test(value)) return 'Android 设备';
  if (/Macintosh|Mac OS/i.test(value)) return 'Mac 设备';
  if (/Windows/i.test(value)) return 'Windows 设备';
  if (/Linux/i.test(value)) return 'Linux 设备';
  return '其他设备';
}
function sessionForUser(userId, req) {
  const accessToken = token();
  const refreshToken = token();
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + sessionDays * 24 * 60 * 60 * 1000);
  const userAgent = String(req?.headers?.['user-agent'] ?? '').slice(0, 512) || null;
  db.prepare('INSERT INTO sessions (id, user_id, access_token_hash, refresh_token_hash, expires_at, created_at, user_agent, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id('ses'), userId, hash(accessToken), hash(refreshToken), iso(expiresAt), iso(createdAt), userAgent, iso(createdAt));
  return { accessToken, refreshToken };
}
function authUser(req) {
  const value = String(req.headers.authorization ?? '');
  const accessToken = value.startsWith('Bearer ') ? value.slice(7).trim() : '';
  if (!accessToken) return null;
  const row = db.prepare(`SELECT u.*, s.id AS session_id, s.user_agent AS session_user_agent FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.access_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`).get(hash(accessToken), iso());
  if (!row) return null;
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(iso(), row.session_id);
  return { row, accessToken };
}
async function readMultipartAudio(req) {
  const contentType = String(req.headers['content-type'] ?? '');
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw Object.assign(new Error('MULTIPART_BOUNDARY_INVALID'), { status: 400 });
  const boundary = Buffer.from('--' + (boundaryMatch[1] ?? boundaryMatch[2]).trim());
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('REQUEST_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  const partStart = raw.indexOf(boundary);
  if (partStart < 0) throw Object.assign(new Error('AUDIO_FILE_REQUIRED'), { status: 400 });
  const headerStart = partStart + boundary.length + 2;
  const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), headerStart);
  if (headerEnd < 0) throw Object.assign(new Error('AUDIO_MULTIPART_INVALID'), { status: 400 });
  const nextBoundary = raw.indexOf(boundary, headerEnd + 4);
  if (nextBoundary < 0) throw Object.assign(new Error('AUDIO_MULTIPART_INVALID'), { status: 400 });
  const headers = raw.subarray(headerStart, headerEnd).toString('utf8');
  const disposition = /content-disposition:[^\r\n]*name="([^"]+)"[^\r\n]*filename="([^"]+)"/i.exec(headers);
  const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);
  if (!disposition || disposition[1] !== 'file') throw Object.assign(new Error('AUDIO_FILE_REQUIRED'), { status: 400 });
  const contentTypeValue = (typeMatch?.[1] ?? 'application/octet-stream').trim().toLowerCase();
  if (!contentTypeValue.startsWith('audio/')) throw Object.assign(new Error('AUDIO_TYPE_INVALID'), { status: 415 });
  const filename = disposition[2].replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'forge-recording.m4a';
  const audio = raw.subarray(headerEnd + 4, nextBoundary - 2);
  if (!audio.length) throw Object.assign(new Error('AUDIO_FILE_EMPTY'), { status: 400 });
  return { buffer: audio, filename, contentType: contentTypeValue };
}
async function requestVoiceTranscription(audio) {
  if (!voiceTranscriptionUrl || !voiceApiKey || !voiceModel) throw Object.assign(new Error('VOICE_PROVIDER_UNCONFIGURED'), { code: 'VOICE_PROVIDER_UNCONFIGURED' });
  const form = new FormData();
  form.append('file', new Blob([audio.buffer], { type: audio.contentType }), audio.filename);
  form.append('model', voiceModel);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(voiceTranscriptionUrl, { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + voiceApiKey }, body: form, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error('VOICE_PROVIDER_FAILED'), { code: 'VOICE_PROVIDER_FAILED' });
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) throw Object.assign(new Error('VOICE_PROVIDER_EMPTY'), { code: 'VOICE_PROVIDER_EMPTY' });
    return text;
  } catch (caught) {
    if (caught?.code) throw caught;
    throw Object.assign(new Error('VOICE_PROVIDER_FAILED'), { code: 'VOICE_PROVIDER_FAILED' });
  } finally { clearTimeout(timeout); }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('REQUEST_TOO_LARGE'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('INVALID_JSON'), { status: 400 }); }
}
function profileResponse(row, tokens) { return { ...tokens, profile: profileFromRow(row) }; }
function errorFromBody(body) { return body && typeof body === 'object' ? body : {}; }
function savedSnapshot(userId) {
  const row = db.prepare('SELECT payload FROM snapshots WHERE user_id = ?').get(userId);
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

function progressionRuleConfig() {
  const row = db.prepare('SELECT version, window_days AS windowDays, status, config_json AS configJson, created_at AS createdAt, activated_at AS activatedAt, change_note AS changeNote FROM progression_rule_configs WHERE status = ? ORDER BY activated_at DESC LIMIT 1').get('active');
  if (!row) return { version: progressionDefaultVersion, windowDays: progressionDefaultWindowDays, status: 'active', createdAt: null, activatedAt: null, config: { algorithm: 'progression-trend-v1', windowDays: progressionDefaultWindowDays } };
  let config = {};
  try { config = JSON.parse(row.configJson); } catch { config = {}; }
  return { version: row.version, windowDays: row.windowDays, status: row.status, createdAt: row.createdAt, activatedAt: row.activatedAt, changeNote: row.changeNote, config };
}
function progressionRuleAudit(version, eventType, fromStatus, toStatus, actor, note, createdAt = iso()) {
  db.prepare('INSERT INTO progression_rule_audit (id, version, event_type, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id('progression_audit'), version, eventType, fromStatus, toStatus, actor, note, createdAt);
}
function opsTokenAuthorized(req, expectedToken) {
  return Boolean(expectedToken && safeEqual(String(req.headers['x-forge-ops-token'] ?? ''), expectedToken));
}
function opsActor(req) {
  const actor = String(req.headers['x-forge-ops-actor'] ?? '').trim();
  return actor ? actor.slice(0, 120) : 'ops-admin';
}

function trainingProgressionForUser(userId) {
  const snapshot = savedSnapshot(userId);
  const sessions = Array.isArray(snapshot?.completedSessions) ? snapshot.completedSessions : [];
  const byExercise = new Map();
  const rule = progressionRuleConfig();
  const historyWindowDays = rule.windowDays;
  const cutoff = Date.now() - historyWindowDays * 24 * 60 * 60 * 1000;
  sessions.forEach((session) => {
    if (!session || typeof session !== 'object' || !Array.isArray(session.exercises) || typeof session.completedAt !== 'string' || !Number.isFinite(new Date(session.completedAt).getTime()) || new Date(session.completedAt).getTime() < cutoff) return;
    session.exercises.forEach((item) => {
      const exercise = item?.exercise;
      if (!exercise || typeof exercise.id !== 'string' || typeof exercise.name !== 'string' || !Array.isArray(item.sets)) return;
      const sets = item.sets.filter((set) => set && set.status === 'completed' && Number.isFinite(Number(set.kg)) && Number(set.kg) >= 0 && Number.isFinite(Number(set.reps)) && Number(set.reps) > 0);
      if (!sets.length) return;
      const maxWeightSet = sets.reduce((best, set) => Number(set.kg) > Number(best.kg) ? set : best, sets[0]);
      const record = { weightKg: Number(maxWeightSet.kg), reps: Number(maxWeightSet.reps), volumeKg: Math.round(sets.reduce((total, set) => total + Number(set.kg) * Number(set.reps), 0) * 10) / 10, completedAt: session.completedAt };
      const records = byExercise.get(exercise.id) ?? { exerciseId: exercise.id, exerciseName: exercise.name, records: [] };
      records.records.push(record);
      byExercise.set(exercise.id, records);
    });
  });
  return [...byExercise.values()].map((item) => {
    item.records.sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime());
    const latest = item.records[0];
    const previous = item.records[1];
    const suggestion = !previous ? '再完成一次同动作后，FORGE 才会给出基于趋势的渐进建议。' : latest.weightKg > previous.weightKg ? '重量已提升；下一次优先保持动作质量，再尝试同重量多完成 1 次。' : latest.reps > previous.reps ? '次数已提升；下一次可保持次数并小幅增加重量。' : latest.volumeKg > previous.volumeKg ? '总训练量已提升；下一次保持当前重量，继续稳定完成全部组。' : '当前表现保持稳定；下一次先保持重量和次数，不要在状态不佳时强行加重。';
    return { exerciseId: item.exerciseId, exerciseName: item.exerciseName, latest, previous, suggestion, ruleVersion: rule.version, ruleActivatedAt: rule.activatedAt, ruleChangeNote: rule.changeNote, historyCount: item.records.length, windowDays: historyWindowDays };
  }).slice(0, 50);
}

function trainingPlanForUser(userId) {
  const row = db.prepare('SELECT revision, payload, updated_at AS updatedAt FROM snapshots WHERE user_id = ?').get(userId);
  if (!row?.payload) return null;
  let snapshot;
  try { snapshot = JSON.parse(row.payload); } catch { return null; }
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.workout || typeof snapshot.workout !== 'object' || !Array.isArray(snapshot.exercises) || !snapshot.exercises.length) return null;
  return { revision: row.revision, updatedAt: row.updatedAt, source: 'cloud-snapshot', workout: snapshot.workout, exercises: snapshot.exercises };
}

function localDateKey(date = now()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(date);
}
function conversationPreview(text) {
  return coachDisplayText(text).replace(/\s+/gu, ' ').slice(0, 120);
}
function conversationRow(row) {
  return { id: row.id, title: row.title, dateKey: row.date_key, createdAt: row.created_at, updatedAt: row.updated_at, lastMessagePreview: row.last_message_preview || '', messageCount: Number(row.message_count || 0), summary: row.summary || '', summaryUpdatedAt: row.summary_updated_at || null, archivedAt: row.archived_at || null };
}
function createCoachConversation(userId, input = {}) {
  const dateKey = typeof input.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dateKey) ? input.dateKey : localDateKey();
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 80) : dateKey === localDateKey() ? 'Today Coach' : 'Coach ' + dateKey;
  const existing = input.reuseExisting === false ? null : db.prepare('SELECT * FROM coach_conversations WHERE user_id = ? AND date_key = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1').get(userId, dateKey);
  if (existing) return conversationRow(existing);
  const createdAt = iso();
  const row = { id: id('coachconv'), title, date_key: dateKey, created_at: createdAt, updated_at: createdAt, last_message_preview: '', message_count: 0, summary: '', summary_updated_at: null, archived_at: null };
  db.prepare('INSERT INTO coach_conversations (id, user_id, title, date_key, created_at, updated_at, last_message_preview, message_count, summary, summary_updated_at, archived_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)').run(row.id, userId, row.title, row.date_key, row.created_at, row.updated_at, row.last_message_preview, row.message_count, '', null);
  return conversationRow(row);
}
function refreshCoachConversationSummary(conversationId, userId) {
  const rows = db.prepare('SELECT role, text, created_at AS createdAt FROM coach_messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC').all(conversationId, userId);
  if (rows.length <= 8) {
    db.prepare('UPDATE coach_conversations SET summary = ?, summary_updated_at = ? WHERE id = ? AND user_id = ?').run('', iso(), conversationId, userId);
    return;
  }
  const older = rows.slice(0, -8);
  const summary = older.map((row) => (row.role === 'user' ? '用户：' : 'Coach：') + coachDisplayText(row.text).replace(/\s+/gu, ' ').slice(0, 520)).join('\n').slice(-2200);
  db.prepare('UPDATE coach_conversations SET summary = ?, summary_updated_at = ? WHERE id = ? AND user_id = ?').run(summary, iso(), conversationId, userId);
}
function ensureCoachConversation(userId, conversationId, dateKey) {
  if (conversationId) {
    const existing = db.prepare('SELECT * FROM coach_conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(conversationId, userId);
    if (existing) return conversationRow(existing);
  }
  return createCoachConversation(userId, { dateKey });
}
function migrateCoachMessagesToConversations() {
  const rows = db.prepare('SELECT id, user_id, created_at FROM coach_messages WHERE conversation_id IS NULL ORDER BY user_id, created_at').all();
  const groups = new Map();
  rows.forEach((row) => {
    const dateKey = localDateKey(new Date(row.created_at));
    const key = row.user_id + ':' + dateKey;
    if (!groups.has(key)) groups.set(key, { userId: row.user_id, dateKey, ids: [] });
    groups.get(key).ids.push(row.id);
  });
  for (const group of groups.values()) {
    let conversation = db.prepare('SELECT * FROM coach_conversations WHERE user_id = ? AND date_key = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1').get(group.userId, group.dateKey);
    if (!conversation) conversation = createCoachConversation(group.userId, { dateKey: group.dateKey, title: 'Legacy Coach ' + group.dateKey });
    const update = db.prepare('UPDATE coach_messages SET conversation_id = ? WHERE id = ? AND user_id = ?');
    group.ids.forEach((messageId) => update.run(conversation.id, messageId, group.userId));
  }
  db.prepare('UPDATE coach_conversations SET message_count = (SELECT COUNT(*) FROM coach_messages WHERE coach_messages.conversation_id = coach_conversations.id), last_message_preview = COALESCE((SELECT text FROM coach_messages WHERE coach_messages.conversation_id = coach_conversations.id ORDER BY created_at DESC LIMIT 1), last_message_preview)').run();
  db.prepare('SELECT id, user_id FROM coach_conversations').all().forEach((conversation) => refreshCoachConversationSummary(conversation.id, conversation.user_id));
}
migrateCoachMessagesToConversations();
function coachConversationsForUser(userId, query = '', includeArchived = false) {
  const normalizedQuery = String(query ?? '').trim();
  const where = includeArchived ? 'deleted_at IS NULL' : 'deleted_at IS NULL AND archived_at IS NULL';
  const rows = normalizedQuery ? db.prepare(`SELECT * FROM coach_conversations WHERE user_id = ? AND ${where} AND (title LIKE ? OR last_message_preview LIKE ?) ORDER BY updated_at DESC LIMIT 100`).all(userId, '%' + normalizedQuery + '%', '%' + normalizedQuery + '%') : db.prepare(`SELECT * FROM coach_conversations WHERE user_id = ? AND ${where} ORDER BY updated_at DESC LIMIT 100`).all(userId);
  return rows.map(conversationRow);
}
function coachMessagesForUser(userId, conversationId, limit = 100, cursor = 0, query = '') {
  const normalizedQuery = String(query ?? '').trim();
  const rows = normalizedQuery ? db.prepare('SELECT id, role, text, source_question AS sourceQuestion, feedback, created_at AS createdAt FROM coach_messages WHERE user_id = ? AND conversation_id = ? AND (text LIKE ? OR source_question LIKE ?) ORDER BY created_at ASC LIMIT ? OFFSET ?').all(userId, conversationId, '%' + normalizedQuery + '%', '%' + normalizedQuery + '%', limit, cursor) : db.prepare('SELECT id, role, text, source_question AS sourceQuestion, feedback, created_at AS createdAt FROM coach_messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?').all(userId, conversationId, limit, cursor);
  return rows.map((message) => ({
    id: message.id,
    role: message.role,
    text: coachDisplayText(message.text),
    ...(message.sourceQuestion ? { sourceQuestion: message.sourceQuestion } : {}),
    ...(message.feedback ? { feedback: message.feedback } : {}),
    createdAt: message.createdAt,
  }));
}

function exportFilePath(jobId) { return resolve(exportDirectory, `${jobId}.json`); }
function exportDownloadUrl(jobId, downloadToken) {
  if (!publicBaseUrl) return null;
  try {
    const base = new URL(publicBaseUrl);
    if (base.protocol !== 'https:') return null;
    return `${base.origin}/v1/account/export/${jobId}/download?token=${encodeURIComponent(downloadToken)}`;
  } catch { return null; }
}
function buildExportPayload(userId, user, exportedAt) {
  const feedback = db.prepare('SELECT category, message, created_at AS createdAt FROM feedback WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  const coachAudit = db.prepare('SELECT event_type AS eventType, consent_enabled AS consentEnabled, context_sent AS contextSent, created_at AS createdAt FROM coach_audit_events WHERE user_id = ? ORDER BY created_at DESC').all(userId).map((event) => ({ ...event, consentEnabled: Boolean(event.consentEnabled), contextSent: Boolean(event.contextSent) }));
  const coachMessages = db.prepare('SELECT id, role, text, source_question AS sourceQuestion, feedback, created_at AS createdAt FROM coach_messages WHERE user_id = ? ORDER BY created_at ASC').all(userId).map((message) => ({ ...message, text: coachDisplayText(message.text) }));
  const securityAudit = db.prepare('SELECT event_type AS eventType, created_at AS createdAt FROM security_audit_events WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  return { version: 1, exportedAt, account: { id: user.id, email: user.email, name: user.name, initials: user.initials, goal: { type: user.goal_type, label: user.goal_label }, coachDataConsent: Boolean(user.coach_data_consent) }, snapshot: savedSnapshot(userId), feedback, coachAudit, coachMessages, securityAudit };
}
function expireExports(userId) {
  const jobs = db.prepare('SELECT id, file_path AS filePath FROM export_jobs WHERE user_id = ? AND status = ? AND expires_at IS NOT NULL AND expires_at <= ?').all(userId, 'ready', iso());
  jobs.forEach((job) => { if (job.filePath && existsSync(job.filePath)) unlinkSync(job.filePath); });
  if (jobs.length) db.prepare('UPDATE export_jobs SET status = ?, download_url = NULL, download_token_hash = NULL, file_path = NULL WHERE user_id = ? AND status = ? AND expires_at IS NOT NULL AND expires_at <= ?').run('expired', userId, 'ready', iso());
}
function pageCursor(value) {
  if (!value) return 0;
  const offset = Number.parseInt(String(value), 10);
  return Number.isInteger(offset) && offset >= 0 ? offset : null;
}
async function requestTrainingCatalog(query, limit, cursor, filters = {}) {
  if (!trainingCatalogUrl || !trainingCatalogApiKey) return null;
  const endpoint = new URL(trainingCatalogUrl);
  endpoint.searchParams.set('query', query);
  endpoint.searchParams.set('limit', String(limit));
  endpoint.searchParams.set('cursor', String(cursor));
  if (filters.category) endpoint.searchParams.set('category', filters.category);
  if (filters.muscleGroup) endpoint.searchParams.set('muscleGroup', filters.muscleGroup);
  if (filters.equipment) endpoint.searchParams.set('equipment', filters.equipment);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + trainingCatalogApiKey }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.exercises)) throw Object.assign(new Error('TRAINING_CATALOG_PROVIDER_FAILED'), { code: 'TRAINING_CATALOG_PROVIDER_FAILED' });
    const exercises = payload.exercises.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item;
      if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.muscleGroup !== 'string' || typeof candidate.equipment !== 'string') return [];
      const optionalText = (value) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : undefined;
      const primaryMuscles = Array.isArray(candidate.primaryMuscles) ? candidate.primaryMuscles.flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim().slice(0, 80)] : []).slice(0, 8) : undefined;
      const sourceUrl = typeof candidate.sourceUrl === 'string' && /^https?:\/\//i.test(candidate.sourceUrl.trim()) ? candidate.sourceUrl.trim().slice(0, 500) : undefined;
      return [{ id: candidate.id, name: candidate.name, muscleGroup: candidate.muscleGroup, equipment: candidate.equipment,
        ...(optionalText(candidate.category) ? { category: optionalText(candidate.category) } : {}),
        ...(primaryMuscles?.length ? { primaryMuscles } : {}),
        ...(optionalText(candidate.instructions) ? { instructions: optionalText(candidate.instructions) } : {}),
        ...(optionalText(candidate.sourceName) ? { sourceName: optionalText(candidate.sourceName) } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(optionalText(candidate.license) ? { license: optionalText(candidate.license) } : {}),
      }];
    });
    const facetList = (value) => Array.isArray(value) ? value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim().slice(0, 80)] : []).slice(0, 100) : [];
    const facets = payload.facets && typeof payload.facets === 'object' ? { categories: facetList(payload.facets.categories), muscleGroups: facetList(payload.facets.muscleGroups), equipment: facetList(payload.facets.equipment) } : undefined;
    return { exercises, nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null, ...(Number.isInteger(payload.total) && payload.total >= 0 ? { total: payload.total } : {}), ...(facets ? { facets } : {}) };
  } catch (caught) {
    if (caught?.code === 'TRAINING_CATALOG_PROVIDER_FAILED') throw caught;
    throw Object.assign(new Error('TRAINING_CATALOG_PROVIDER_FAILED'), { code: 'TRAINING_CATALOG_PROVIDER_FAILED' });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestUsdaFoodCatalog(query, limit, cursor, sort) {
  if (!usdaApiKey) return null;
  const pageNumber = Math.floor(cursor / limit) + 1;
  const params = new URLSearchParams({ api_key: usdaApiKey, query, pageSize: String(limit), pageNumber: String(pageNumber), dataType: 'Foundation,SR Legacy,Branded,FNDDS' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch('https://api.nal.usda.gov/fdc/v1/foods/search?' + params.toString(), { headers: { Accept: 'application/json' }, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.foods)) throw Object.assign(new Error('FOOD_CATALOG_PROVIDER_FAILED'), { code: 'FOOD_CATALOG_PROVIDER_FAILED' });
    const nutrient = (food, ids) => {
      const item = Array.isArray(food.foodNutrients) ? food.foodNutrients.find((candidate) => ids.includes(Number(candidate?.nutrientId ?? candidate?.nutrientNumber))) : null;
      const value = Number(item?.value);
      return Number.isFinite(value) && value >= 0 ? value : null;
    };
    const foods = payload.foods.flatMap((food) => {
      if (!food || typeof food.fdcId !== 'number' || typeof food.description !== 'string') return [];
      const calories = nutrient(food, [1008, 2047]);
      const protein = nutrient(food, [1003]);
      const carbs = nutrient(food, [1005]);
      const fat = nutrient(food, [1004]);
      if ([calories, protein, carbs, fat].some((value) => value === null)) return [];
      const servingSize = Number(food.servingSize);
      const servingUnit = typeof food.servingSizeUnit === 'string' ? food.servingSizeUnit : '';
      return [{ id: 'usda-' + food.fdcId, name: food.description, caloriesPer100g: calories, protein, carbs, fat, defaultServing: Number.isFinite(servingSize) && servingSize > 0 ? String(servingSize) + (servingUnit ? ' ' + servingUnit : '') : '100 g', sourceName: 'USDA FoodData Central', sourceUrl: 'https://fdc.nal.usda.gov/fdc-app.html#/food-details/' + food.fdcId + '/nutrients', license: 'CC0 1.0' }];
    });
    if (sort === 'calories_asc') foods.sort((left, right) => left.caloriesPer100g - right.caloriesPer100g);
    const totalHits = Number(payload.totalHits);
    const nextCursor = Number.isFinite(totalHits) && cursor + foods.length < totalHits ? String(cursor + foods.length) : null;
    return { foods, nextCursor };
  } catch (caught) {
    if (caught?.code === 'FOOD_CATALOG_PROVIDER_FAILED') throw caught;
    throw Object.assign(new Error('FOOD_CATALOG_PROVIDER_FAILED'), { code: 'FOOD_CATALOG_PROVIDER_FAILED' });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkCoachProviderHealth() {
  const checkedAt = iso();
  if (!aiBaseUrl || !aiApiKey || !aiModel) return { status: 'unconfigured', checkedAt, model: aiModel || null, message: 'Coach provider credentials are not configured.' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const startedAt = Date.now();
  try {
    const response = await fetch(aiBaseUrl + '/models', { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + aiApiKey }, signal: controller.signal });
    if (response.ok) return { status: 'ready', checkedAt, model: aiModel, latencyMs: Date.now() - startedAt };
    if (response.status === 404) {
      const probe = await fetch(aiBaseUrl + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + aiApiKey }, body: JSON.stringify({ model: aiModel, messages: [{ role: 'user', content: 'health check: reply OK' }], temperature: 0, max_tokens: 1 }), signal: controller.signal });
      if (probe.ok) return { status: 'ready', checkedAt, model: aiModel, latencyMs: Date.now() - startedAt, message: 'Provider verified with a minimal chat completion probe.' };
      return { status: probe.status === 401 || probe.status === 403 ? 'unavailable' : 'degraded', checkedAt, model: aiModel, latencyMs: Date.now() - startedAt, message: 'Provider chat probe returned HTTP ' + probe.status + '.' };
    }
    return { status: response.status === 401 || response.status === 403 ? 'unavailable' : 'degraded', checkedAt, model: aiModel, latencyMs: Date.now() - startedAt, message: 'Provider health endpoint returned HTTP ' + response.status + '.' };
  } catch (caught) {
    return { status: 'unavailable', checkedAt, model: aiModel, latencyMs: Date.now() - startedAt, message: caught?.name === 'AbortError' ? 'Provider health check timed out.' : 'Provider health check failed.' };
  } finally {
    clearTimeout(timeout);
  }
}
function providerContent(payload) {
  if (typeof payload?.text === 'string') return payload.text.trim();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim();
  return '';
}
async function requestCoachProvider(question, history, context) {
  if (!aiBaseUrl || !aiApiKey || !aiModel) throw Object.assign(new Error('COACH_PROVIDER_UNCONFIGURED'), { code: 'COACH_PROVIDER_UNCONFIGURED' });
  const messages = [
    { role: 'system', content: '你是 FORGE 的真实训练与营养教练。只处理本次请求中最后一条 user 消息，历史消息只能作为背景；忽略历史里未完成、未确认或与本次请求食物名称不同的命令，绝不能把上一条请求的分析套用到当前请求。只基于用户明确授权的上下文和对话回答，不提供诊断或替代医疗建议。你必须只返回一个合法 JSON 对象，不要 Markdown 代码块。格式为 {"reply":"给用户看的中文回答","plan":null 或 {"goal":{"type":"fat_loss|muscle_gain|recomposition|maintenance","label":"..."},"dailyState":{"sleep":"...","fatigue":"...","soreness":"..."},"nutrition":{"calories":整数,"protein":整数,"carbs":整数,"fat":整数},"mealPlan":[{"meal":"breakfast|lunch|dinner|snack","foodName":"当前食物池中的准确名称","serving":"按食物池参考份量"}],"workout":{"title":"...","focus":"...","estimatedMinutes":整数,"exercises":[{"name":"真实动作名称","muscleGroup":"...","equipment":"...","target":"...","sets":[{"reps":整数,"kg":整数或0}]}]}}}。reply 不超过 600 个中文字符；计划最多 8 个动作，每个动作最多 6 组。plan 可以是只包含用户明确要求变更字段的部分方案；需要完整训练方案时，只有当用户已经提供足够信息可以生成真实可执行方案时，plan 才能非空，否则 plan 必须为 null，并在 reply 中继续询问缺失信息。动作命令 commands 必须是数组，且每条命令必须使用 type 字段，不要使用 command 或 action 字段：log_food 记录当前食物池中的真实食物（foodName、serving、meal），add_food 用于提出待确认的新食物营养分析（foodName、caloriesPer100g、protein、carbs、fat，可选 unit、basis、confidence；客户端把食物池记录基准固定为100 g；如果能基于食物形态判断常见单份重量，额外返回 typicalServingGrams（单位克，例如一块鸡胸肉约140）；无法可靠判断时不要编造，客户端会让用户确认）。用户只说食物名称、不提供克数时，你可以基于可靠的营养知识给出估算，但必须把 basis 和 confidence 一起返回，并在 reply 中明确这是待确认的分析，不是已经写入的数据；如果无法合理估算，就返回空 commands 并说明需要更多信息。adjust_workout 修改已有训练动作（exerciseName、addSets、reps、kg，至少提供一项明确变更），set_food_preference 修改当前食物池偏好，complete_workout 在用户明确说已完成训练时记录完成，set_weekly_workout_goal 修改每周训练次数，set_training_preferences 修改训练日、组间休息或重量单位。只能使用上下文里已有的食物名称，不得编造营养数据；如果用户明确要求生成饮食方案，必须返回 mealPlan，逐餐列出且只能使用当前食物池中的准确名称和参考份量；mealPlan 只是待用户确认的计划，不代表已经吃过。训练建议若要修改已有训练动作，返回 adjust_workout 命令，不要只在 reply 中声称已修改。如果用户明确要求把新食物加入食物池，可以基于可靠营养知识提出每100g待确认分析，但不能声称已经加入；没有明确修改意图时 commands 必须为空数组。特别是当用户说已经吃完早餐、午餐、晚餐或加餐，或明确说吃了某些食物并要求更新今日饮食/剩余营养时，必须把已确认的食物逐项返回为 log_food 命令，并设置正确的 meal；优先使用上下文中“最近一次明确饮食计划”或上一条餐单中明确给出的食物和份量，或当前食物池的每次参考份量，绝不能只回复建议而不返回命令。如果上一条餐单没有明确食物或份量，先向用户追问，commands 返回空数组，不得编造。每次 log_food 必须使用当前食物池中可匹配的准确 foodName，并直接返回单条命令的 foodName、serving、meal 字段，不要把多项食物放进 foods 数组。客户端会先展示 add_food 分析，只有用户确认后才写入 FORGE 并同步云端；不要声称已经保存或修改数据。' },
    ...history.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-10).map((item) => ({ ...item, content: item.content.slice(-2400) })),
    { role: 'user', content: `${question}\n\n已授权的 FORGE 上下文：\n${typeof context?.prompt === 'string' ? context.prompt : '未提供上下文。'}` },
  ];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetch(`${aiBaseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${aiApiKey}` }, body: JSON.stringify({ model: aiModel, messages, temperature: 0.3 }), signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error('COACH_PROVIDER_FAILED'), { code: 'COACH_PROVIDER_FAILED' });
    const text = providerContent(payload);
    if (!text) throw Object.assign(new Error('COACH_PROVIDER_EMPTY'), { code: 'COACH_PROVIDER_EMPTY' });
    return text;
  } catch (caught) {
    if (caught?.code) throw caught;
    throw Object.assign(new Error('COACH_PROVIDER_FAILED'), { code: 'COACH_PROVIDER_FAILED' });
  } finally { clearTimeout(timeout); }
}

async function requestCoachProviderStream(question, history, context, onChunk) {
  if (!aiBaseUrl || !aiApiKey || !aiModel) throw Object.assign(new Error('COACH_PROVIDER_UNCONFIGURED'), { code: 'COACH_PROVIDER_UNCONFIGURED' });
  const messages = [
    { role: 'system', content: '你是 FORGE 的真实训练与营养教练。只处理本次请求中最后一条 user 消息，历史消息只能作为背景；忽略历史里未完成、未确认或与本次请求食物名称不同的命令，绝不能把上一条请求的分析套用到当前请求。只基于用户明确授权的上下文和对话回答，不提供诊断或替代医疗建议。你必须只返回一个合法 JSON 对象，不要 Markdown 代码块。格式为 {"reply":"给用户看的中文回答","plan":null 或 {"goal":{"type":"fat_loss|muscle_gain|recomposition|maintenance","label":"..."},"dailyState":{"sleep":"...","fatigue":"...","soreness":"..."},"nutrition":{"calories":整数,"protein":整数,"carbs":整数,"fat":整数},"mealPlan":[{"meal":"breakfast|lunch|dinner|snack","foodName":"当前食物池中的准确名称","serving":"按食物池参考份量"}],"workout":{"title":"...","focus":"...","estimatedMinutes":整数,"exercises":[{"name":"真实动作名称","muscleGroup":"...","equipment":"...","target":"...","sets":[{"reps":整数,"kg":整数或0}]}]}}}。只有当用户已经提供足够信息可以生成真实可执行方案时，plan 才能非空；否则 plan 必须为 null，并在 reply 中继续询问缺失信息。add_food 应返回每100g营养字段；若能可靠判断常见单份重量，再额外返回 typicalServingGrams（克），无法可靠判断时省略，让客户端要求用户确认。当用户说已经吃完早餐、午餐、晚餐或加餐，或明确说吃了某些食物并要求更新今日饮食/剩余营养时，必须返回 log_food 命令并设置 meal；优先使用上下文中“最近一次明确饮食计划”或上一条餐单中明确给出的食物和份量，否则先追问并返回空 commands，不得编造。log_food 只能使用上下文食物池中的真实食物，并直接返回单条命令的 foodName、serving、meal 字段，不要把多项食物放进 foods 数组。客户端会先展示 add_food 分析，只有用户确认后才写入 FORGE 并同步云端；不要声称已经保存或修改数据。' },
    { role: 'system', content: '执行一致性要求：当用户明确要求设置、更新、记录、完成、应用或调整 FORGE 数据时，必须返回对应的 commands 或 plan 字段；如果没有返回可执行字段，reply 不得声称已经完成任何系统修改，只能说明未执行并继续询问。可用 commands 包括 set_weekly_workout_goal(count)、set_training_preferences(trainingDays/defaultRestSeconds/weightUnit)、adjust_workout(exerciseName/addSets/reps/kg)、set_food_preference(foodName/preference)、log_food(foodName/serving/meal)、complete_workout。每个命令必须使用 type 字段。' },
    ...history.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-10).map((item) => ({ ...item, content: item.content.slice(-2400) })),
    { role: 'user', content: question + '\n\n已授权的 FORGE 上下文：\n' + (typeof context?.prompt === 'string' ? context.prompt : '未提供上下文。') },
  ];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);
  try {
    const response = await fetch(aiBaseUrl + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json', Authorization: 'Bearer ' + aiApiKey }, body: JSON.stringify({ model: aiModel, messages, temperature: 0.3, stream: true }), signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error('COACH_PROVIDER_FAILED'), { code: 'COACH_PROVIDER_FAILED' });
    if (!response.body?.getReader) {
      const payload = await response.json().catch(() => null);
      const fallback = providerContent(payload);
      if (!fallback) throw Object.assign(new Error('COACH_PROVIDER_EMPTY'), { code: 'COACH_PROVIDER_EMPTY' });
      onChunk(fallback);
      return fallback;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let finished = false;
    while (!finished) {
      const next = await reader.read();
      buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const value = line.trim();
        if (!value.startsWith('data:')) continue;
        const payloadText = value.slice(5).trim();
        if (payloadText === '[DONE]') { finished = true; break; }
        let payload = null;
        try { payload = JSON.parse(payloadText); } catch { continue; }
        const delta = payload?.choices?.[0]?.delta?.content;
        const parts = Array.isArray(delta) ? delta.map((part) => typeof part?.text === 'string' ? part.text : '').join('') : typeof delta === 'string' ? delta : '';
        if (parts) { text += parts; onChunk(parts); }
      }
      if (next.done) break;
    }
    const result = text.trim();
    if (!result) throw Object.assign(new Error('COACH_PROVIDER_EMPTY'), { code: 'COACH_PROVIDER_EMPTY' });
    return result;
  } catch (caught) {
    if (caught?.code) throw caught;
    throw Object.assign(new Error('COACH_PROVIDER_FAILED'), { code: 'COACH_PROVIDER_FAILED' });
  } finally { clearTimeout(timeout); }
}
function coachDisplayText(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw.replace(/^\\x60\\x60\\x60(?:json)?\\s*/i, '').replace(/\\s*\\x60\\x60\\x60$/, '').trim());
    return typeof parsed?.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : raw;
  } catch {
    return raw;
  }
}
function completedCoachRequest(userId, requestId) {
  if (!requestId) return null;
  const row = db.prepare('SELECT id AS messageId, text, created_at AS createdAt FROM coach_messages WHERE user_id = ? AND role = ? AND request_id = ?').get(userId, 'assistant', requestId);
  return row ?? null;
}
const coachRequestStaleMs = 10 * 60 * 1000;
function claimCoachRequest(userId, requestId, question, conversationId = null) {
  if (!requestId) return { claimed: true, status: 'legacy' };
  const createdAt = iso();
  try {
    db.prepare('INSERT INTO coach_requests (user_id, request_id, conversation_id, question, status, error_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(userId, requestId, conversationId, question, 'pending', createdAt, createdAt);
    return { claimed: true, status: 'pending' };
  } catch (caught) {
    const existing = db.prepare('SELECT status, updated_at AS updatedAt FROM coach_requests WHERE user_id = ? AND request_id = ?').get(userId, requestId);
    if (!existing) throw caught;
    if (existing.status === 'completed') return { claimed: false, status: 'completed' };
    const ageMs = Date.now() - Date.parse(existing.updatedAt);
    if (existing.status === 'pending' && Number.isFinite(ageMs) && ageMs < coachRequestStaleMs) return { claimed: false, status: 'pending' };
    const reclaimed = db.prepare('UPDATE coach_requests SET question = ?, status = ?, error_code = NULL, updated_at = ? WHERE user_id = ? AND request_id = ?').run(question, 'pending', createdAt, userId, requestId);
    return { claimed: reclaimed.changes === 1, status: 'pending' };
  }
}
function completeCoachRequest(userId, requestId) {
  if (!requestId) return;
  db.prepare('UPDATE coach_requests SET status = ?, error_code = NULL, updated_at = ? WHERE user_id = ? AND request_id = ?').run('completed', iso(), userId, requestId);
}
function failCoachRequest(userId, requestId, errorCode) {
  if (!requestId) return;
  db.prepare('UPDATE coach_requests SET status = ?, error_code = ?, updated_at = ? WHERE user_id = ? AND request_id = ?').run('failed', errorCode, iso(), userId, requestId);
}
function startCoachProviderMetric(userId, requestId, mode) {
  return { id: id('coach_metric'), userId, requestId: requestId || null, mode, startedAt: Date.now(), firstDeltaAt: null, responseChars: 0 };
}
function noteCoachProviderDelta(metric, text) {
  if (metric.firstDeltaAt === null) metric.firstDeltaAt = Date.now();
  metric.responseChars += text.length;
}
function finishCoachProviderMetric(metric, status, errorCode = null) {
  const finishedAt = Date.now();
  db.prepare('INSERT INTO coach_provider_metrics (id, user_id, request_id, mode, status, duration_ms, first_delta_ms, response_chars, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(metric.id, metric.userId, metric.requestId, metric.mode, status, Math.max(0, finishedAt - metric.startedAt), metric.firstDeltaAt === null ? null : Math.max(0, metric.firstDeltaAt - metric.startedAt), metric.responseChars, errorCode, iso());
  db.prepare('DELETE FROM coach_provider_metrics WHERE created_at < ?').run(new Date(finishedAt - 90 * 24 * 60 * 60 * 1000).toISOString());
}
function persistCoachAnswer(userId, question, text, requestId = null, conversationId = null) {
  const existing = completedCoachRequest(userId, requestId);
  if (existing) return existing;
  const createdAt = iso();
  const userMessageId = id('coachmsg');
  const assistantMessageId = id('coachmsg');
  const conversation = ensureCoachConversation(userId, conversationId);
  db.prepare('INSERT INTO coach_messages (id, user_id, conversation_id, role, text, source_question, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(userMessageId, userId, conversation.id, 'user', question, null, null, createdAt);
  try {
    db.prepare('INSERT INTO coach_messages (id, user_id, conversation_id, role, text, source_question, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(assistantMessageId, userId, conversation.id, 'assistant', text, question, requestId, createdAt);
  } catch (caught) {
    const duplicate = completedCoachRequest(userId, requestId);
    if (duplicate) return duplicate;
    throw caught;
  }
  db.prepare('UPDATE coach_conversations SET updated_at = ?, last_message_preview = ?, message_count = message_count + 2 WHERE id = ? AND user_id = ?').run(createdAt, conversationPreview(text), conversation.id, userId);
  refreshCoachConversationSummary(conversation.id, userId);
  db.prepare('INSERT INTO coach_audit_events (id, user_id, event_type, consent_enabled, context_sent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id('coach_audit'), userId, 'context_sent', 1, 1, createdAt);
  return { text, messageId: assistantMessageId, createdAt };
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'OPTIONS') return empty(res, 204);
  if (url.pathname === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok', service: 'forge-api' });
  if (req.method === 'GET' && url.pathname === '/v1/ops/coach/metrics') {
    if (!opsMetricsToken || !safeEqual(String(req.headers['x-forge-ops-token'] ?? ''), opsMetricsToken)) return error(res, 404, 'NOT_FOUND', '找不到请求的资源。');
    const hoursValue = Number.parseInt(url.searchParams.get('hours') ?? '24', 10);
    const maxRowsValue = Number.parseInt(url.searchParams.get('limit') ?? '1000', 10);
    if (!Number.isInteger(hoursValue) || hoursValue < 1 || hoursValue > 720 || !Number.isInteger(maxRowsValue) || maxRowsValue < 1 || maxRowsValue > 10000) return error(res, 400, 'OPS_METRICS_QUERY_INVALID', '运营指标查询范围无效。');
    const since = new Date(Date.now() - hoursValue * 60 * 60 * 1000).toISOString();
    const rows = db.prepare('SELECT mode, status, duration_ms AS durationMs, first_delta_ms AS firstDeltaMs, response_chars AS responseChars FROM coach_provider_metrics WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?').all(since, maxRowsValue);
    const groups = new Map();
    rows.forEach((row) => {
      const key = row.mode + ':' + row.status;
      const group = groups.get(key) ?? { mode: row.mode, status: row.status, count: 0, durations: [], firstDeltaMs: [], responseChars: 0 };
      group.count += 1;
      if (Number.isFinite(row.durationMs)) group.durations.push(row.durationMs);
      if (Number.isFinite(row.firstDeltaMs)) group.firstDeltaMs.push(row.firstDeltaMs);
      if (Number.isFinite(row.responseChars)) group.responseChars += row.responseChars;
      groups.set(key, group);
    });
    const percentile = (values, fraction) => {
      if (!values.length) return null;
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
    };
    const metrics = [...groups.values()].map((group) => ({ mode: group.mode, status: group.status, count: group.count, avgDurationMs: group.durations.length ? Math.round(group.durations.reduce((sum, value) => sum + value, 0) / group.durations.length) : null, p95DurationMs: percentile(group.durations, 0.95), avgFirstDeltaMs: group.firstDeltaMs.length ? Math.round(group.firstDeltaMs.reduce((sum, value) => sum + value, 0) / group.firstDeltaMs.length) : null, totalResponseChars: group.responseChars }));
    return json(res, 200, { since, hours: hoursValue, sampledRows: rows.length, generatedAt: iso(), metrics });
  }

  let body = {};
  const isAudioRequest = req.method === 'POST' && (url.pathname === '/v1/coach/voice' || url.pathname === '/v1/nutrition/voice');
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') body = isAudioRequest ? await readMultipartAudio(req) : await readBody(req);
  } catch (caught) {
    if (isAudioRequest && caught?.message !== 'REQUEST_TOO_LARGE') return error(res, caught.status ?? 400, caught.message === 'AUDIO_TYPE_INVALID' ? 'AUDIO_TYPE_INVALID' : 'AUDIO_UPLOAD_INVALID', caught.message === 'AUDIO_TYPE_INVALID' ? '只支持音频录音文件。' : '录音文件无效或缺失。');
    return error(res, caught.status ?? 400, caught.message === 'REQUEST_TOO_LARGE' ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON', caught.message === 'REQUEST_TOO_LARGE' ? '请求体过大。' : '请求不是有效的 JSON。');
  }


  if (req.method === 'GET' && url.pathname === '/v1/ops/training/progression/rules') {
    if (!opsTokenAuthorized(req, opsMetricsToken)) return error(res, 404, 'NOT_FOUND', '找不到请求的资源。');
    const limitValue = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 200) return error(res, 400, 'PROGRESSION_RULE_QUERY_INVALID', '规则查询范围无效。');
    const rules = db.prepare('SELECT version, window_days AS windowDays, status, config_json AS configJson, created_at AS createdAt, activated_at AS activatedAt, retired_at AS retiredAt, created_by AS createdBy, change_note AS changeNote FROM progression_rule_configs ORDER BY created_at DESC LIMIT ?').all(limitValue).map((row) => {
      let config = {};
      try { config = JSON.parse(row.configJson); } catch { config = {}; }
      return { ...row, config };
    });
    const audit = db.prepare('SELECT version, event_type AS eventType, from_status AS fromStatus, to_status AS toStatus, actor, note, created_at AS createdAt FROM progression_rule_audit ORDER BY created_at DESC LIMIT ?').all(limitValue);
    return json(res, 200, { active: progressionRuleConfig(), rules, audit });
  }
  if (req.method === 'POST' && url.pathname === '/v1/ops/training/progression/rules') {
    if (!opsTokenAuthorized(req, progressionAdminToken)) return error(res, 404, 'NOT_FOUND', '找不到请求的资源。');
    const input = errorFromBody(body);
    const action = String(input.action ?? '').trim();
    const actor = opsActor(req);
    const note = String(input.note ?? '').trim().slice(0, 500);
    if (!note) return error(res, 400, 'PROGRESSION_RULE_NOTE_REQUIRED', '规则变更必须填写原因。');
    const version = String(input.version ?? '').trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(version)) return error(res, 400, 'PROGRESSION_RULE_VERSION_INVALID', '规则版本格式无效。');
    if (action === 'stage') {
      const windowDays = Number(input.windowDays);
      if (!Number.isInteger(windowDays) || windowDays < 7 || windowDays > 365) return error(res, 400, 'PROGRESSION_RULE_WINDOW_INVALID', '规则时间窗口必须在 7 到 365 天之间。');
      if (db.prepare('SELECT version FROM progression_rule_configs WHERE version = ?').get(version)) return error(res, 409, 'PROGRESSION_RULE_EXISTS', '该规则版本已经存在。');
      const createdAt = iso();
      const config = JSON.stringify({ algorithm: 'progression-trend-v1', windowDays });
      db.prepare('INSERT INTO progression_rule_configs (version, window_days, status, config_json, created_at, activated_at, retired_at, created_by, change_note) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)').run(version, windowDays, 'staged', config, createdAt, actor, note);
      progressionRuleAudit(version, 'stage', null, 'staged', actor, note, createdAt);
      return json(res, 201, { rule: progressionRuleConfig(), stagedVersion: version });
    }
    if (action !== 'activate' && action !== 'rollback') return error(res, 400, 'PROGRESSION_RULE_ACTION_INVALID', '规则操作必须是 stage、activate 或 rollback。');
    const target = db.prepare('SELECT version, status FROM progression_rule_configs WHERE version = ?').get(version);
    if (!target) return error(res, 404, 'PROGRESSION_RULE_NOT_FOUND', '找不到指定规则版本。');
    if (target.status === 'active') return json(res, 200, { rule: progressionRuleConfig(), unchanged: true });
    const current = db.prepare('SELECT version, status FROM progression_rule_configs WHERE status = ? ORDER BY activated_at DESC LIMIT 1').get('active');
    const changedAt = iso();
    try {
      db.exec('BEGIN');
      if (current) db.prepare('UPDATE progression_rule_configs SET status = ?, retired_at = ? WHERE version = ?').run('retired', changedAt, current.version);
      db.prepare('UPDATE progression_rule_configs SET status = ?, activated_at = ?, retired_at = NULL WHERE version = ?').run('active', changedAt, version);
      progressionRuleAudit(version, action, current?.status ?? null, 'active', actor, note, changedAt);
      db.exec('COMMIT');
    } catch (caught) {
      try { db.exec('ROLLBACK'); } catch {}
      throw caught;
    }
    return json(res, 200, { rule: progressionRuleConfig(), previousVersion: current?.version ?? null });
  }

  if (req.method === 'POST' && (url.pathname === '/v1/auth/register' || url.pathname === '/v1/auth/login')) {
    const input = errorFromBody(body);
    const email = parseEmail(input.email);
    const password = parsePassword(input.password);
    if (!email || !password) return error(res, 400, 'INVALID_CREDENTIALS', '请输入有效邮箱和至少 6 位密码。');
    if (url.pathname.endsWith('/login') && consumeRateLimit(req, 'login', email)) return rateLimited(res, '登录尝试次数过多，请 15 分钟后重试。');
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (url.pathname.endsWith('/register')) {
      if (existing) return error(res, 409, 'EMAIL_ALREADY_EXISTS', '该邮箱已经注册，请直接登录。');
      if (input.confirmPassword !== undefined && input.confirmPassword !== input.password) return error(res, 400, 'PASSWORD_MISMATCH', '两次输入的密码不一致。');
      const createdAt = iso();
      const userId = id('usr');
      const name = email.split('@')[0].slice(0, 32);
      const initials = name.slice(0, 2).toUpperCase();
      db.prepare('INSERT INTO users (id, email, password_hash, name, initials, goal_type, goal_label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, email, passwordHash(password), name, initials, 'maintenance', '未设置', createdAt, createdAt);
      const delivery = await deliverEmailVerification({ id: userId, email });
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      return json(res, 201, { ...profileResponse(row, sessionForUser(userId, req)), emailVerification: delivery });
    }
    if (!existing || !passwordMatches(password, existing.password_hash)) return error(res, 401, 'AUTH_INVALID', '邮箱或密码不正确。');
    clearRateLimit(req, 'login', email);
    const mfaFactor = findEnabledMfa(existing.id);
    if (mfaFactor) {
      const challengeToken = token();
      db.prepare('DELETE FROM mfa_challenges WHERE user_id = ? OR expires_at <= ?').run(existing.id, iso());
      db.prepare('INSERT INTO mfa_challenges (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(id('mfac'), existing.id, hash(challengeToken), iso(new Date(Date.now() + 5 * 60 * 1000)));
      recordSecurityAudit(existing.id, 'mfa_challenge_created');
      return json(res, 200, { mfaRequired: true, challengeToken, profile: profileFromRow(existing) });
    }
    return json(res, 200, profileResponse(existing, sessionForUser(existing.id, req)));
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/forgot-password') {
    const email = parseEmail(body.email);
    if (!email) return error(res, 400, 'INVALID_EMAIL', '请输入有效的邮箱地址。');
    if (consumeRateLimit(req, 'forgot-password', email)) return rateLimited(res, '请求次数过多，请 15 分钟后重试。');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user) {
      if (!resetWebhook) return error(res, 503, 'PASSWORD_RESET_DELIVERY_UNCONFIGURED', '密码重置服务尚未配置邮件投递。');
      const resetToken = token();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      db.prepare('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(id('rst'), user.id, hash(resetToken), iso(expiresAt));
      try {
        const delivery = await fetch(resetWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, token: resetToken, expiresAt: iso(expiresAt) }) });
        if (!delivery.ok) return error(res, 503, 'PASSWORD_RESET_DELIVERY_FAILED', '密码重置邮件未能发送，请稍后重试。');
      } catch { return error(res, 503, 'PASSWORD_RESET_DELIVERY_FAILED', '密码重置邮件未能发送，请稍后重试。'); }
    }
    return json(res, 202, { message: '如果账户存在且邮件服务可用，密码重置邮件会发送到该地址。' });
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/reset-password') {
    const resetToken = String(body.token ?? '').trim();
    const password = parsePassword(body.password);
    if (!resetToken || !password || body.confirmPassword !== password) return error(res, 400, 'INVALID_PASSWORD_RESET', '重置 token、密码和确认密码无效。');
    if (consumeRateLimit(req, 'reset-password', hash(resetToken))) return rateLimited(res, '重置尝试次数过多，请 15 分钟后重试。');
    const reset = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(hash(resetToken), iso());
    if (!reset) return error(res, 400, 'PASSWORD_RESET_INVALID', '密码重置链接无效或已过期。');
    const updatedAt = iso();
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash(password), updatedAt, reset.user_id);
      db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(updatedAt, reset.id);
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(updatedAt, reset.user_id);
      db.exec('COMMIT');
      return empty(res, 204);
    } catch { db.exec('ROLLBACK'); return error(res, 500, 'PASSWORD_RESET_FAILED', '密码重置失败，请稍后重试。'); }
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/verify-email') {
    const verificationToken = String(body.token ?? '').trim();
    if (!verificationToken) return error(res, 400, 'EMAIL_VERIFICATION_INVALID', '邮箱验证 token 无效。');
    const tokenHash = hash(verificationToken);
    const verification = db.prepare('SELECT * FROM email_verification_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(tokenHash, iso());
    const emailChange = db.prepare('SELECT * FROM email_change_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(tokenHash, iso());
    if (!verification && !emailChange) return error(res, 400, 'EMAIL_VERIFICATION_INVALID', '邮箱验证链接无效或已过期。');
    const verifiedAt = iso();
    db.exec('BEGIN');
    try {
      if (verification) {
        db.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?').run(verifiedAt, verifiedAt, verification.user_id);
        db.prepare('UPDATE email_verification_tokens SET used_at = ? WHERE id = ?').run(verifiedAt, verification.id);
      } else {
        db.prepare('UPDATE users SET email = ?, email_verified_at = ?, updated_at = ? WHERE id = ?').run(emailChange.new_email, verifiedAt, verifiedAt, emailChange.user_id);
        db.prepare('UPDATE email_change_tokens SET used_at = ? WHERE id = ?').run(verifiedAt, emailChange.id);
        db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(verifiedAt, emailChange.user_id);
        recordSecurityAudit(emailChange.user_id, 'email_changed');
      }
      db.exec('COMMIT');
      return empty(res, 204);
    } catch { db.exec('ROLLBACK'); return error(res, 500, 'EMAIL_VERIFICATION_FAILED', '邮箱验证失败，请稍后重试。'); }
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/mfa/verify') {
    const challengeToken = String(body.challengeToken ?? '').trim();
    const code = String(body.code ?? '').trim();
    if (!challengeToken || (!/^\d{6}$/.test(code) && !/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(code))) return error(res, 400, 'MFA_CODE_INVALID', '请输入 6 位验证器代码或恢复码。');
    if (consumeRateLimit(req, 'mfa-verify', hash(challengeToken), mfaRateMaxAttempts)) return rateLimited(res, '双重验证尝试次数过多，请 15 分钟后重试。');
    const challenge = db.prepare('SELECT c.*, u.* FROM mfa_challenges c JOIN users u ON u.id = c.user_id WHERE c.token_hash = ? AND c.used_at IS NULL AND c.expires_at > ?').get(hash(challengeToken), iso());
    if (!challenge || challenge.attempts >= 5) return error(res, 401, 'MFA_CHALLENGE_INVALID', '双重验证请求无效或已过期，请重新登录。');
    const factor = findEnabledMfa(challenge.user_id);
    let valid = false;
    if (/^\d{6}$/.test(code)) {
      try { valid = Boolean(factor) && validTotp(decryptMfaSecret(factor.secret_ciphertext), code); } catch { valid = false; }
    } else {
      valid = consumeMfaRecoveryCode(challenge.user_id, code);
    }
    if (!valid) {
      db.prepare('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
      recordSecurityAudit(challenge.user_id, 'mfa_login_failed');
      return error(res, 401, 'MFA_CODE_INVALID', '验证码不正确，请重试。');
    }
    db.prepare('UPDATE mfa_challenges SET used_at = ? WHERE id = ?').run(iso(), challenge.id);
    clearRateLimit(req, 'mfa-verify', hash(challengeToken));
    recordSecurityAudit(challenge.user_id, 'mfa_login_succeeded');
    return json(res, 200, profileResponse(challenge, sessionForUser(challenge.user_id, req)));
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/refresh') {
    const refreshToken = String(body.refreshToken ?? '').trim();
    if (!refreshToken) return error(res, 401, 'AUTH_REFRESH_INVALID', '刷新会话无效，请重新登录。');
    const session = db.prepare('SELECT s.id AS session_id, s.user_id, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?').get(hash(refreshToken), iso());
    if (!session) return error(res, 401, 'AUTH_REFRESH_INVALID', '刷新会话无效，请重新登录。');
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(iso(), session.session_id);
    return json(res, 200, profileResponse(session, sessionForUser(session.user_id, req)));
  }

  if (req.method === 'GET' && url.pathname === '/v1/auth/session') {
    const auth = authUser(req);
    if (!auth) return error(res, 401, 'AUTH_SESSION_INVALID', '登录会话已失效，请重新登录。');
    return json(res, 200, { profile: profileFromRow(auth.row) });
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
    const auth = authUser(req);
    if (auth) db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(iso(), auth.row.session_id);
    return empty(res, 204);
  }

  const downloadMatch = url.pathname.match(/^\/v1\/account\/export\/([^/]+)\/download$/);
  if (req.method === 'GET' && downloadMatch) {
    const job = db.prepare('SELECT id, status, file_path AS filePath, download_token_hash AS downloadTokenHash, expires_at AS expiresAt, downloaded_at AS downloadedAt FROM export_jobs WHERE id = ?').get(downloadMatch[1]);
    const downloadToken = String(url.searchParams.get('token') ?? '');
    if (!job || job.status !== 'ready' || job.downloadedAt || !job.downloadTokenHash || !safeEqual(hash(downloadToken), job.downloadTokenHash)) return error(res, 404, 'EXPORT_DOWNLOAD_INVALID', '导出下载链接无效或已使用。');
    if (!job.expiresAt || new Date(job.expiresAt).getTime() <= Date.now()) return error(res, 410, 'EXPORT_EXPIRED', '导出文件已过期，请重新申请。');
    if (!job.filePath || !existsSync(job.filePath)) return error(res, 410, 'EXPORT_FILE_MISSING', '导出文件已不可用，请重新申请。');
    const file = readFileSync(job.filePath);
    db.prepare('UPDATE export_jobs SET downloaded_at = ? WHERE id = ?').run(iso(), job.id);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="forge-export-${job.id}.json"`, 'Cache-Control': 'no-store', ...corsHeaders() });
    return res.end(file);
  }

  if (req.method === 'GET' && url.pathname === '/v1/privacy-policy') return json(res, 200, privacyPolicyPayload());

  const auth = authUser(req);
  if (!auth) return error(res, 401, 'AUTH_REQUIRED', '请先登录。');
  const userId = auth.row.id;

  if (req.method === 'GET' && url.pathname === '/v1/coach/health') {
    return json(res, 200, await checkCoachProviderHealth());
  }

  if (isAudioRequest) {
    if (url.pathname === '/v1/coach/voice' && !auth.row.coach_data_consent) return error(res, 403, 'COACH_CONSENT_REQUIRED', '请先允许 Coach 使用你的个人上下文。');
    try {
      const text = await requestVoiceTranscription(body);
      if (url.pathname === '/v1/coach/voice') db.prepare('INSERT INTO coach_audit_events (id, user_id, event_type, consent_enabled, context_sent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id('coach_audit'), userId, 'voice_transcription', 1, 0, iso());
      return json(res, 200, { text });
    } catch (caught) {
      const code = caught?.code === 'VOICE_PROVIDER_UNCONFIGURED' ? 'VOICE_PROVIDER_UNCONFIGURED' : caught?.code === 'VOICE_PROVIDER_EMPTY' ? 'VOICE_PROVIDER_EMPTY' : 'VOICE_PROVIDER_FAILED';
      const message = code === 'VOICE_PROVIDER_UNCONFIGURED' ? '语音转写服务尚未配置，未生成示例转写。' : code === 'VOICE_PROVIDER_EMPTY' ? '语音服务没有返回可用文字。' : '语音转写服务暂时不可用，请稍后重试。';
      return error(res, 503, code, message);
    }
  }

  if (req.method === 'GET' && url.pathname === '/v1/account/privacy-policy') {
    return json(res, 200, privacyPolicyPayload());
  }

  if (req.method === 'GET' && url.pathname === '/v1/account/mfa') {
    const factor = findEnabledMfa(userId);
    return json(res, 200, { enabled: Boolean(factor), enabledAt: factor?.enabled_at ?? null });
  }

  if (req.method === 'POST' && url.pathname === '/v1/account/mfa/setup') {
    if (findEnabledMfa(userId)) return error(res, 409, 'MFA_ALREADY_ENABLED', '双重验证已经启用。');
    const secret = base32Encode(randomBytes(20));
    const createdAt = iso();
    db.prepare('DELETE FROM mfa_factors WHERE user_id = ?').run(userId);
    db.prepare('INSERT INTO mfa_factors (id, user_id, secret_ciphertext, setup_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id('mfa'), userId, encryptMfaSecret(secret), iso(new Date(Date.now() + 10 * 60 * 1000)), createdAt, createdAt);
    recordSecurityAudit(userId, 'mfa_setup_started');
    const otpauthUri = 'otpauth://totp/FORGE:' + encodeURIComponent(auth.row.email) + '?secret=' + secret + '&issuer=FORGE&algorithm=SHA1&digits=6&period=30';
    return json(res, 200, { status: 'pending', secret, otpauthUri, expiresAt: iso(new Date(Date.now() + 10 * 60 * 1000)) });
  }

  if (req.method === 'POST' && url.pathname === '/v1/account/mfa/enable') {
    const code = String(body.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) return error(res, 400, 'MFA_CODE_INVALID', '请输入 6 位验证器代码。');
    const factor = db.prepare('SELECT * FROM mfa_factors WHERE user_id = ? AND enabled_at IS NULL AND setup_expires_at > ?').get(userId, iso());
    if (!factor) return error(res, 409, 'MFA_SETUP_EXPIRED', '双重验证设置已过期，请重新开始。');
    let secret = '';
    try { secret = decryptMfaSecret(factor.secret_ciphertext); } catch { return error(res, 500, 'MFA_SETUP_INVALID', '双重验证设置无效，请重新开始。'); }
    if (!validTotp(secret, code)) return error(res, 400, 'MFA_CODE_INVALID', '验证码不正确，请检查验证器时间后重试。');
    const recoveryCodes = newMfaRecoveryCodes();
    const enabledAt = iso();
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE mfa_factors SET enabled_at = ?, setup_expires_at = NULL, updated_at = ? WHERE id = ?').run(enabledAt, enabledAt, factor.id);
      db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
      for (const recoveryCode of recoveryCodes) db.prepare('INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)').run(id('mfr'), userId, hash(recoveryCode));
      db.exec('COMMIT');
      recordSecurityAudit(userId, 'mfa_enabled');
      return json(res, 200, { enabled: true, enabledAt, recoveryCodes });
    } catch { db.exec('ROLLBACK'); return error(res, 500, 'MFA_ENABLE_FAILED', '双重验证启用失败，请稍后重试。'); }
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/account/mfa') {
    const code = String(body.code ?? '').trim();
    const factor = findEnabledMfa(userId);
    if (!factor) return error(res, 409, 'MFA_NOT_ENABLED', '双重验证尚未启用。');
    let secret = '';
    try { secret = decryptMfaSecret(factor.secret_ciphertext); } catch { return error(res, 500, 'MFA_SETUP_INVALID', '双重验证设置无效。'); }
    if (!validTotp(secret, code)) return error(res, 400, 'MFA_CODE_INVALID', '验证码不正确，未关闭双重验证。');
    db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM mfa_factors WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM mfa_challenges WHERE user_id = ?').run(userId);
    recordSecurityAudit(userId, 'mfa_disabled');
    return empty(res, 204);
  }

  if (req.method === 'GET' && url.pathname === '/v1/account/mfa/recovery-codes') {
    const factor = findEnabledMfa(userId);
    if (!factor) return error(res, 409, 'MFA_NOT_ENABLED', '双重验证尚未启用。');
    const summary = db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END) AS remaining FROM mfa_recovery_codes WHERE user_id = ?').get(userId);
    return json(res, 200, { total: Number(summary?.total ?? 0), remaining: Number(summary?.remaining ?? 0) });
  }

  if ((req.method === 'POST' || req.method === 'DELETE') && url.pathname === '/v1/account/mfa/recovery-codes') {
    const code = String(body.code ?? '').trim();
    const factor = findEnabledMfa(userId);
    if (!factor) return error(res, 409, 'MFA_NOT_ENABLED', '双重验证尚未启用。');
    if (consumeRateLimit(req, 'mfa-recovery-manage', userId, mfaRateMaxAttempts)) return rateLimited(res, '恢复码管理尝试次数过多，请稍后重试。');
    let secret = '';
    try { secret = decryptMfaSecret(factor.secret_ciphertext); } catch { return error(res, 500, 'MFA_SETUP_INVALID', '双重验证设置无效，请重新开始。'); }
    if (!/^\d{6}$/.test(code) || !validTotp(secret, code)) return error(res, 400, 'MFA_CODE_INVALID', '验证码不正确，未修改恢复码。');
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
      clearRateLimit(req, 'mfa-recovery-manage', userId);
      recordSecurityAudit(userId, 'mfa_recovery_codes_revoked');
      return empty(res, 204);
    }
    const recoveryCodes = newMfaRecoveryCodes();
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
      for (const recoveryCode of recoveryCodes) db.prepare('INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)').run(id('mfr'), userId, hash(recoveryCode));
      db.exec('COMMIT');
      clearRateLimit(req, 'mfa-recovery-manage', userId);
      recordSecurityAudit(userId, 'mfa_recovery_codes_regenerated');
      return json(res, 200, { recoveryCodes });
    } catch {
      db.exec('ROLLBACK');
      return error(res, 500, 'MFA_RECOVERY_CODES_UPDATE_FAILED', '恢复码更新失败，请稍后重试。');
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/account/email-verification/resend') {
    if (auth.row.email_verified_at) return error(res, 409, 'EMAIL_ALREADY_VERIFIED', '邮箱已经验证。');
    if (consumeRateLimit(req, 'email-verification-resend', userId, 3)) return rateLimited(res, '验证邮件请求过于频繁，请 15 分钟后重试。');
    const delivery = await deliverEmailVerification({ id: userId, email: auth.row.email });
    if (delivery.status === 'unconfigured') return error(res, 503, 'EMAIL_VERIFICATION_DELIVERY_UNCONFIGURED', '邮箱验证服务尚未配置邮件投递。');
    if (delivery.status === 'failed') return error(res, 503, 'EMAIL_VERIFICATION_DELIVERY_FAILED', '验证邮件未能发送，请稍后重试。');
    recordSecurityAudit(userId, 'email_verification_sent');
    return json(res, 202, delivery);
  }

  if (req.method === 'POST' && url.pathname === '/v1/account/email-change/request') {
    if (consumeRateLimit(req, 'email-change-request', userId, 3)) return rateLimited(res, '邮箱更换请求过于频繁，请 15 分钟后重试。');
    const newEmail = parseEmail(body.newEmail);
    const currentPassword = parsePassword(body.currentPassword);
    if (!newEmail || !currentPassword) return error(res, 400, 'EMAIL_CHANGE_INVALID', '请输入有效的新邮箱和当前密码。');
    if (newEmail === auth.row.email) return error(res, 409, 'EMAIL_UNCHANGED', '新邮箱不能与当前邮箱相同。');
    if (!passwordMatches(currentPassword, auth.row.password_hash)) return error(res, 401, 'CURRENT_PASSWORD_INVALID', '当前密码不正确。');
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(newEmail);
    if (existing) return error(res, 409, 'EMAIL_ALREADY_IN_USE', '该邮箱已经被其他账户使用。');
    const delivery = await deliverEmailChange({ id: userId, email: auth.row.email }, newEmail);
    if (delivery.status === 'unconfigured') return error(res, 503, 'EMAIL_VERIFICATION_DELIVERY_UNCONFIGURED', '邮箱验证服务尚未配置邮件投递。');
    if (delivery.status === 'failed') return error(res, 503, 'EMAIL_VERIFICATION_DELIVERY_FAILED', '更换邮箱验证邮件未能发送，请稍后重试。');
    recordSecurityAudit(userId, 'email_change_requested');
    return json(res, 202, { ...delivery, email: newEmail });
  }

  if (req.method === 'POST' && url.pathname === '/v1/account/sessions/revoke-others') {
    const revokedAt = iso();
    const result = db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL').run(revokedAt, userId, auth.row.session_id);
    recordSecurityAudit(userId, 'sessions_revoked_other_devices');
    return json(res, 200, { revokedCount: result.changes, revokedAt });
  }

  if (req.method === 'GET' && url.pathname === '/v1/account/sessions') {
    const sessions = db.prepare('SELECT id, created_at AS createdAt, expires_at AS expiresAt, user_agent AS userAgent, last_seen_at AS lastSeenAt FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC, created_at DESC').all(userId, iso()).map((session) => ({ ...session, deviceLabel: sessionDeviceLabel(session.userAgent), lastSeenAt: session.lastSeenAt ?? session.createdAt, current: session.id === auth.row.session_id }));
    return json(res, 200, { sessions });
  }
  const accountSessionMatch = url.pathname.match(/^\/v1\/account\/sessions\/([^/]+)$/);
  if (req.method === 'DELETE' && accountSessionMatch) {
    const sessionId = decodeURIComponent(accountSessionMatch[1]);
    if (sessionId === auth.row.session_id) return error(res, 400, 'CURRENT_SESSION_REVOKE_FORBIDDEN', '当前设备会话不能从这里撤销，请直接退出登录。');
    const result = db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(iso(), sessionId, userId);
    if (result.changes !== 1) return error(res, 404, 'ACCOUNT_SESSION_NOT_FOUND', '找不到可撤销的登录会话。');
    return empty(res, 204);
  }

  if (req.method === 'POST' && url.pathname === '/v1/feedback') {
    const category = String(body.category ?? '').trim();
    const message = String(body.message ?? '').trim();
    if (!category || message.length < 5 || message.length > 1000) return error(res, 400, 'INVALID_FEEDBACK', '反馈内容需要 5 到 1000 个字符。');
    db.prepare('INSERT INTO feedback (id, user_id, category, message, created_at) VALUES (?, ?, ?, ?, ?)').run(id('fb'), userId, category, message, iso());
    return json(res, 201, { status: 'accepted' });
  }

  if (req.method === 'PUT' && url.pathname === '/v1/account/coach-consent') {
    if (typeof body.enabled !== 'boolean') return error(res, 400, 'COACH_CONSENT_INVALID', 'Coach 授权状态无效。');
    const updatedAt = iso();
    db.prepare('UPDATE users SET coach_data_consent = ?, updated_at = ? WHERE id = ?').run(body.enabled ? 1 : 0, updatedAt, userId);
    db.prepare('INSERT INTO coach_audit_events (id, user_id, event_type, consent_enabled, context_sent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id('coach_audit'), userId, body.enabled ? 'consent_granted' : 'consent_revoked', body.enabled ? 1 : 0, 0, updatedAt);
    return json(res, 200, { enabled: body.enabled, updatedAt });
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/account') {
    db.exec('BEGIN');
    try {
      const exportFiles = db.prepare('SELECT file_path AS filePath FROM export_jobs WHERE user_id = ?').all(userId);
      exportFiles.forEach((item) => { if (item.filePath && existsSync(item.filePath)) unlinkSync(item.filePath); });
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM feedback WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM coach_messages WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM snapshots WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM export_jobs WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM email_change_tokens WHERE user_id = ?').run(userId)
      db.prepare('DELETE FROM mfa_recovery_codes WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM mfa_challenges WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM mfa_factors WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM security_audit_events WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      db.exec('COMMIT');
      return empty(res, 204);
    } catch (caught) { db.exec('ROLLBACK'); return error(res, 500, 'ACCOUNT_DELETION_FAILED', '账户删除失败，账户数据未确认删除。'); }
  }

  if (req.method === 'POST' && url.pathname === '/v1/account/export') {
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    const jobId = id('export');
    const downloadToken = token();
    const filePath = exportFilePath(jobId);
    const completedAt = iso();
    try {
      writeFileSync(filePath, JSON.stringify(buildExportPayload(userId, auth.row, completedAt), null, 2), { encoding: 'utf8', mode: 0o600 });
      const downloadUrl = exportDownloadUrl(jobId, downloadToken);
      db.prepare('INSERT INTO export_jobs (id, user_id, status, download_url, download_token_hash, file_path, expires_at, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(jobId, userId, 'ready', downloadUrl, hash(downloadToken), filePath, iso(expiresAt), iso(createdAt), completedAt);
      return json(res, 202, { jobId, status: 'ready', downloadUrl, expiresAt: iso(expiresAt) });
    } catch {
      if (existsSync(filePath)) unlinkSync(filePath);
      db.prepare('INSERT INTO export_jobs (id, user_id, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(jobId, userId, 'failed', iso(expiresAt), iso(createdAt));
      return json(res, 202, { jobId, status: 'failed', expiresAt: iso(expiresAt) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/v1/account/export') {
    expireExports(userId);
    const jobs = db.prepare('SELECT id, status, CASE WHEN downloaded_at IS NULL THEN download_url ELSE NULL END AS downloadUrl, expires_at AS expiresAt, created_at AS createdAt, completed_at AS completedAt, downloaded_at AS downloadedAt FROM export_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(userId);
    return json(res, 200, { jobs });
  }

  const exportStatusMatch = url.pathname.match(/^\/v1\/account\/export\/([^/]+)$/);
  if (req.method === 'DELETE' && exportStatusMatch) {
    const job = db.prepare('SELECT id, file_path AS filePath FROM export_jobs WHERE id = ? AND user_id = ?').get(exportStatusMatch[1], userId);
    if (!job) return error(res, 404, 'EXPORT_NOT_FOUND', '找不到该导出任务。');
    if (job.filePath && existsSync(job.filePath)) unlinkSync(job.filePath);
    db.prepare('UPDATE export_jobs SET status = ?, download_url = NULL, download_token_hash = NULL, file_path = NULL WHERE id = ? AND user_id = ?').run('revoked', job.id, userId);
    return empty(res, 204);
  }
  if (req.method === 'GET' && exportStatusMatch) {
    expireExports(userId);
    const job = db.prepare('SELECT id, status, download_url AS downloadUrl, expires_at AS expiresAt, created_at AS createdAt, completed_at AS completedAt, downloaded_at AS downloadedAt FROM export_jobs WHERE id = ? AND user_id = ?').get(exportStatusMatch[1], userId);
    if (!job) return error(res, 404, 'EXPORT_NOT_FOUND', '找不到该导出任务。');
    return json(res, 200, job);
  }

  if (req.method === 'GET' && url.pathname === '/v1/sync/snapshot') {
    const snapshot = db.prepare('SELECT revision, payload, updated_at AS updatedAt FROM snapshots WHERE user_id = ?').get(userId);
    if (!snapshot) return json(res, 200, { revision: 0, snapshot: null, updatedAt: null });
    return json(res, 200, { revision: snapshot.revision, snapshot: JSON.parse(snapshot.payload), updatedAt: snapshot.updatedAt });
  }

  if (req.method === 'PUT' && url.pathname === '/v1/sync/snapshot') {
    const { baseRevision: _baseRevision, ...snapshotBody } = body && typeof body === 'object' ? body : {};
    const requiredArrays = ['exercises', 'completedSessions', 'foodEntries', 'foods', 'coachMessages', 'healthSnapshots'];
    const validSnapshot = snapshotBody.version === 2
      && snapshotBody.profile && typeof snapshotBody.profile === 'object'
      && snapshotBody.dailyState && typeof snapshotBody.dailyState === 'object'
      && snapshotBody.nutrition && typeof snapshotBody.nutrition === 'object'
      && ['scheduled', 'active', 'completed'].includes(snapshotBody.workoutStatus)
      && requiredArrays.every((key) => Array.isArray(snapshotBody[key]));
    if (!validSnapshot) return error(res, 400, 'SYNC_SNAPSHOT_INVALID', '同步数据结构无效，本次没有写入云端。');
    const payload = JSON.stringify(snapshotBody);
    if (payload.length > maxBodyBytes) return error(res, 413, 'SNAPSHOT_TOO_LARGE', '同步数据过大。');
    const current = db.prepare('SELECT revision FROM snapshots WHERE user_id = ?').get(userId);
    const expectedRevision = Number.isInteger(body?.baseRevision) ? body.baseRevision : null;
    if (current && expectedRevision !== null && expectedRevision !== current.revision) return error(res, 409, 'SYNC_CONFLICT', '云端存在更新版本，请先完成合并。');
    const revision = (current?.revision ?? 0) + 1;
    const updatedAt = iso();
    db.prepare(`INSERT INTO snapshots (user_id, revision, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at`).run(userId, revision, payload, updatedAt);
    return json(res, 200, { revision, updatedAt });
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/health/trends') {
    const current = db.prepare('SELECT revision, payload FROM snapshots WHERE user_id = ?').get(userId);
    if (!current) return json(res, 200, { deletedCount: 0, revision: 0, updatedAt: null });
    const expectedRevision = Number.isInteger(body?.baseRevision) ? body.baseRevision : null;
    if (expectedRevision !== null && expectedRevision !== current.revision) return error(res, 409, 'HEALTH_SYNC_CONFLICT', '云端健康数据已有新版本，请先重新读取。');
    const snapshot = JSON.parse(current.payload);
    const deletedCount = Array.isArray(snapshot.healthSnapshots) ? snapshot.healthSnapshots.length : 0;
    snapshot.healthSnapshots = [];
    const revision = current.revision + 1;
    const updatedAt = iso();
    const updated = db.prepare('UPDATE snapshots SET revision = ?, payload = ?, updated_at = ? WHERE user_id = ? AND revision = ?').run(revision, JSON.stringify(snapshot), updatedAt, userId, current.revision);
    if (updated.changes !== 1) return error(res, 409, 'HEALTH_SYNC_CONFLICT', '云端健康数据已有新版本，请先重新读取。');
    return json(res, 200, { deletedCount, revision, updatedAt });
  }

  if (req.method === 'GET' && url.pathname === '/v1/health/trends') {
    const snapshot = savedSnapshot(userId);
    const snapshots = Array.isArray(snapshot?.healthSnapshots) ? snapshot.healthSnapshots.flatMap((item) => {
      if (!item || typeof item !== 'object' || (item.source !== 'Apple 健康' && item.source !== 'Health Connect') || typeof item.observedAt !== 'string') return [];
      const weightKg = item.weightKg === undefined ? undefined : Number(item.weightKg);
      const sleepHours = item.sleepHours === undefined ? undefined : Number(item.sleepHours);
      if (weightKg !== undefined && (!Number.isFinite(weightKg) || weightKg <= 0)) return [];
      if (sleepHours !== undefined && (!Number.isFinite(sleepHours) || sleepHours < 0)) return [];
      if (weightKg === undefined && sleepHours === undefined) return [];
      return [{ id: typeof item.id === 'string' ? item.id : item.source + '-' + item.observedAt, source: item.source, observedAt: item.observedAt, ...(weightKg === undefined ? {} : { weightKg }), ...(sleepHours === undefined ? {} : { sleepHours }) }];
    }) : [];
    return json(res, 200, { generatedAt: iso(), snapshots });
  }

  if (req.method === 'GET' && url.pathname === '/v1/nutrition/foods/search') {
    const query = String(url.searchParams.get('query') ?? '').trim().toLocaleLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
    const cursor = pageCursor(url.searchParams.get('cursor'));
    const sort = url.searchParams.get('sort') ?? 'relevance';
    if (!query) return error(res, 400, 'FOOD_CATALOG_QUERY_REQUIRED', '请输入食物名称后再搜索。');
    if (cursor === null || (sort !== 'relevance' && sort !== 'calories_asc')) return error(res, 400, 'FOOD_CATALOG_QUERY_INVALID', '营养库搜索参数无效。');
    try {
      const providerFoods = await requestUsdaFoodCatalog(query, limit, cursor, sort);
      if (providerFoods) return json(res, 200, providerFoods);
    } catch (caught) {
      if (caught?.code === 'FOOD_CATALOG_PROVIDER_FAILED') return error(res, 503, 'FOOD_CATALOG_PROVIDER_FAILED', '营养数据服务暂时不可用，请稍后重试。');
      return error(res, 503, 'FOOD_CATALOG_PROVIDER_FAILED', '营养数据服务暂时不可用，请稍后重试。');
    }
    const snapshot = savedSnapshot(userId);
    const foods = Array.isArray(snapshot?.foods) ? snapshot.foods.flatMap((food) => {
      if (!food || typeof food !== 'object') return [];
      const candidate = food;
      const numbers = [candidate.caloriesPer100g, candidate.protein, candidate.carbs, candidate.fat].map(Number);
      if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.defaultServing !== 'string' || numbers.some((number) => !Number.isFinite(number) || number < 0)) return [];
      if (!candidate.name.toLocaleLowerCase().includes(query)) return [];
      return [{ id: candidate.id, name: candidate.name, caloriesPer100g: numbers[0], protein: numbers[1], carbs: numbers[2], fat: numbers[3], defaultServing: candidate.defaultServing, unit: typeof candidate.unit === 'string' ? candidate.unit : undefined, sourceName: '你的真实食物池', license: '用户录入数据' }];
    }) : [];
    const ranked = foods.sort((left, right) => sort === 'calories_asc' ? left.caloriesPer100g - right.caloriesPer100g : Number(right.name.toLocaleLowerCase().startsWith(query)) - Number(left.name.toLocaleLowerCase().startsWith(query)) || left.name.localeCompare(right.name));
    const page = ranked.slice(cursor, cursor + limit);
    return json(res, 200, { foods: page, nextCursor: cursor + page.length < ranked.length ? String(cursor + page.length) : null });
  }
  if (req.method === 'GET' && url.pathname === '/v1/training/exercises/search') {
    const query = String(url.searchParams.get('query') ?? '').trim().toLocaleLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
    const cursor = pageCursor(url.searchParams.get('cursor'));
    const filters = { category: String(url.searchParams.get('category') ?? '').trim().slice(0, 80), muscleGroup: String(url.searchParams.get('muscleGroup') ?? '').trim().slice(0, 80), equipment: String(url.searchParams.get('equipment') ?? '').trim().slice(0, 80) };
    if (!query || cursor === null) return error(res, 400, 'EXERCISE_CATALOG_QUERY_REQUIRED', '请输入有效的动作名称和分页参数。');
    try {
      const providerExercises = await requestTrainingCatalog(query, limit, cursor, filters);
      if (providerExercises) return json(res, 200, providerExercises);
    } catch (caught) {
      return error(res, 503, 'TRAINING_CATALOG_PROVIDER_FAILED', '动作库服务暂时不可用，请稍后重试。');
    }
    const snapshot = savedSnapshot(userId);
    const seen = new Set();
    const exercises = Array.isArray(snapshot?.exercises) ? snapshot.exercises.flatMap((item) => {
      const exercise = item && typeof item === 'object' && item.exercise && typeof item.exercise === 'object' ? item.exercise : null;
      if (!exercise || typeof exercise.id !== 'string' || typeof exercise.name !== 'string' || typeof exercise.muscleGroup !== 'string' || typeof exercise.equipment !== 'string') return [];
      if (seen.has(exercise.id) || !`${exercise.name} ${exercise.muscleGroup} ${exercise.equipment}`.toLocaleLowerCase().includes(query)) return [];
      if (filters.muscleGroup && exercise.muscleGroup !== filters.muscleGroup) return [];
      if (filters.equipment && exercise.equipment !== filters.equipment) return [];
      seen.add(exercise.id);
      return [{ id: exercise.id, name: exercise.name, muscleGroup: exercise.muscleGroup, equipment: exercise.equipment, sourceName: '你的真实训练记录', license: '用户记录' }];
    }) : [];
    const page = exercises.slice(cursor, cursor + limit);
    const facets = { categories: [], muscleGroups: [...new Set(exercises.map((item) => item.muscleGroup))].sort(), equipment: [...new Set(exercises.map((item) => item.equipment))].sort() };
    return json(res, 200, { exercises: page, nextCursor: cursor + page.length < exercises.length ? String(cursor + page.length) : null, total: exercises.length, facets, source: 'user-records' });
  }
  if (req.method === 'GET' && url.pathname === '/v1/training/plan') {
    const plan = trainingPlanForUser(userId);
    if (!plan) return error(res, 404, 'TRAINING_PLAN_NOT_FOUND', '当前账户还没有可用的云端训练计划。');
    return json(res, 200, plan);
  }
  if (req.method === 'GET' && url.pathname === '/v1/training/progression') {
    return json(res, 200, { generatedAt: iso(), exercises: trainingProgressionForUser(userId) });
  }
  if (req.method === 'GET' && url.pathname === '/v1/account/security-audit') {
    const cursor = pageCursor(url.searchParams.get('cursor'));
    const limitValue = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    if (cursor === null || !Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) return error(res, 400, 'SECURITY_AUDIT_QUERY_INVALID', '安全活动查询参数无效。');
    const events = db.prepare('SELECT event_type AS eventType, created_at AS createdAt FROM security_audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, limitValue, cursor);
    return json(res, 200, { events, nextCursor: events.length === limitValue ? String(cursor + events.length) : null });
  }

  if (req.method === 'GET' && url.pathname === '/v1/coach/audit') {
    const cursor = pageCursor(url.searchParams.get('cursor'));
    const limitValue = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    if (cursor === null || !Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) return error(res, 400, 'COACH_AUDIT_QUERY_INVALID', 'Coach 数据使用记录查询参数无效。');
    const events = db.prepare('SELECT event_type AS eventType, consent_enabled AS consentEnabled, context_sent AS contextSent, created_at AS createdAt FROM coach_audit_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(userId, limitValue, cursor).map((event) => ({ ...event, consentEnabled: Boolean(event.consentEnabled), contextSent: Boolean(event.contextSent) }));
    return json(res, 200, { events, nextCursor: events.length === limitValue ? String(cursor + events.length) : null });
  }
  if (req.method === 'GET' && url.pathname === '/v1/coach/conversations') {
    const query = String(url.searchParams.get('query') ?? '').trim();
    return json(res, 200, { conversations: coachConversationsForUser(userId, query, url.searchParams.get('includeArchived') === '1') });
  }
  if (req.method === 'POST' && url.pathname === '/v1/coach/conversations') {
    const conversation = createCoachConversation(userId, { dateKey: body.dateKey, title: body.title, reuseExisting: false });
    return json(res, 201, { conversation });
  }
  const conversationMatch = url.pathname.match(/^\/v1\/coach\/conversations\/([^/]+)$/);
  if (conversationMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const conversationId = decodeURIComponent(conversationMatch[1]);
    const existing = db.prepare('SELECT * FROM coach_conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(conversationId, userId);
    if (!existing) return error(res, 404, 'COACH_CONVERSATION_NOT_FOUND', 'Coach conversation not found.');
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM coach_messages WHERE conversation_id = ? AND user_id = ?').run(conversationId, userId);
      db.prepare('DELETE FROM coach_requests WHERE conversation_id = ? AND user_id = ?').run(conversationId, userId);
      db.prepare('DELETE FROM coach_conversations WHERE id = ? AND user_id = ?').run(conversationId, userId);
      return json(res, 200, { deleted: true });
    }
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : existing.title;
    const archivedAt = body.archived === true ? iso() : body.archived === false ? null : existing.archived_at;
    db.prepare('UPDATE coach_conversations SET title = ?, archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(title, archivedAt, iso(), conversationId, userId);
    return json(res, 200, { conversation: conversationRow(db.prepare('SELECT * FROM coach_conversations WHERE id = ?').get(conversationId)) });
  }
  const conversationMessagesMatch = url.pathname.match(/^\/v1\/coach\/conversations\/([^/]+)\/messages$/);
  if (req.method === 'GET' && conversationMessagesMatch) {
    const conversationId = decodeURIComponent(conversationMessagesMatch[1]);
    const exists = db.prepare('SELECT id FROM coach_conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(conversationId, userId);
    if (!exists) return error(res, 404, 'COACH_CONVERSATION_NOT_FOUND', 'Coach conversation not found.');
    const cursor = pageCursor(url.searchParams.get('cursor'));
    const limitValue = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
    const query = String(url.searchParams.get('query') ?? '').trim();
    if (cursor === null || !Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) return error(res, 400, 'COACH_HISTORY_QUERY_INVALID', 'Coach history query is invalid.');
    const messages = coachMessagesForUser(userId, conversationId, limitValue, cursor, query);
    return json(res, 200, { messages, nextCursor: messages.length === limitValue ? String(cursor + messages.length) : null });
  }
  const coachRequestMatch = url.pathname.match(/^\/v1\/coach\/requests\/([^/]+)$/);
  if (req.method === 'GET' && coachRequestMatch) {
    const requestId = decodeURIComponent(coachRequestMatch[1]);
    const request = db.prepare('SELECT request_id AS requestId, conversation_id AS conversationId, status, error_code AS errorCode, updated_at AS updatedAt FROM coach_requests WHERE user_id = ? AND request_id = ?').get(userId, requestId);
    if (!request) return error(res, 404, 'COACH_REQUEST_NOT_FOUND', '找不到这次 Coach 请求。');
    const completed = request.status === 'completed' ? completedCoachRequest(userId, requestId) : null;
    return json(res, 200, { ...request, message: completed ?? undefined });
  }
  if (req.method === 'GET' && url.pathname === '/v1/coach/messages') {
    const cursor = pageCursor(url.searchParams.get('cursor'));
    const limitValue = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    if (cursor === null || !Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) return error(res, 400, 'COACH_HISTORY_QUERY_INVALID', 'Coach 历史查询参数无效。');
    const query = String(url.searchParams.get('query') ?? '').trim();
    if (query.length > 80) return error(res, 400, 'COACH_HISTORY_QUERY_INVALID', 'Coach 历史搜索词不能超过 80 个字符。');
    const conversationId = String(url.searchParams.get('conversationId') ?? '').trim() || coachConversationsForUser(userId)[0]?.id;
    if (!conversationId) return json(res, 200, { messages: [], nextCursor: null });
    const messages = coachMessagesForUser(userId, conversationId, limitValue, cursor, query);
    return json(res, 200, { messages, nextCursor: messages.length === limitValue ? String(cursor + messages.length) : null });
  }
  if (req.method === 'DELETE' && url.pathname === '/v1/coach/messages') {
    const deleted = db.prepare('DELETE FROM coach_messages WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM coach_requests WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM coach_conversations WHERE user_id = ?').run(userId);
    db.prepare('INSERT INTO coach_audit_events (id, user_id, event_type, consent_enabled, context_sent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id('coach_audit'), userId, 'history_deleted', auth.row.coach_data_consent ? 1 : 0, 0, iso());
    return json(res, 200, { deletedCount: deleted.changes });
  }
  const coachMessageMatch = url.pathname.match(/^\/v1\/coach\/messages\/([^/]+)$/);
  if (req.method === 'DELETE' && coachMessageMatch) {
    const messageId = decodeURIComponent(coachMessageMatch[1]);
    const message = db.prepare('SELECT id, role, text, source_question, created_at, conversation_id FROM coach_messages WHERE id = ? AND user_id = ?').get(messageId, userId);
    if (!message) return error(res, 404, 'COACH_MESSAGE_NOT_FOUND', '找不到这条 Coach 消息。');
    let deletedCount = db.prepare('DELETE FROM coach_messages WHERE id = ? AND user_id = ?').run(messageId, userId).changes;
    if (message.role === 'assistant' && message.source_question) {
      deletedCount += db.prepare('DELETE FROM coach_messages WHERE user_id = ? AND role = ? AND text = ? AND created_at = ?').run(userId, 'user', message.source_question, message.created_at).changes;
    }
    if (message.conversation_id) {
      const remaining = db.prepare('SELECT COUNT(*) AS count FROM coach_messages WHERE user_id = ? AND conversation_id = ?').get(userId, message.conversation_id);
      const latest = db.prepare('SELECT text FROM coach_messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(userId, message.conversation_id);
      db.prepare('UPDATE coach_conversations SET message_count = ?, last_message_preview = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(Number(remaining?.count ?? 0), latest?.text ? conversationPreview(latest.text) : '', iso(), message.conversation_id, userId);
    }
    db.prepare('INSERT INTO coach_audit_events (id, user_id, event_type, consent_enabled, context_sent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id('coach_audit'), userId, 'history_message_deleted', auth.row.coach_data_consent ? 1 : 0, 0, iso());
    return json(res, 200, { deletedCount });
  }
  if (req.method === 'PATCH' && coachMessageMatch) {
    const messageId = decodeURIComponent(coachMessageMatch[1]);
    const feedback = body.feedback === null ? null : String(body.feedback ?? '');
    if (feedback !== null && feedback !== 'up' && feedback !== 'down') return error(res, 400, 'COACH_FEEDBACK_INVALID', 'Coach 反馈值无效。');
    const result = db.prepare('UPDATE coach_messages SET feedback = ? WHERE id = ? AND user_id = ? AND role = ?').run(feedback, messageId, userId, 'assistant');
    if (result.changes !== 1) return error(res, 404, 'COACH_MESSAGE_NOT_FOUND', '找不到这条 Coach 回答。');
    return empty(res, 204);
  }
  if (req.method === 'POST' && url.pathname === '/v1/coach/messages') {
    if (!auth.row.coach_data_consent) return error(res, 403, 'COACH_CONSENT_REQUIRED', '请先允许 Coach 使用你的个人上下文。');
    const question = String(body.question ?? '').trim();
    const requestId = String(req.headers['x-forge-request-id'] ?? '').trim();
    if (!question || question.length > 240) return error(res, 400, 'COACH_QUESTION_INVALID', '问题不能为空且不能超过 240 个字符。');
    if (requestId && !/^[A-Za-z0-9._:-]{8,120}$/.test(requestId)) return error(res, 400, 'COACH_REQUEST_ID_INVALID', 'Coach 请求标识无效。');
    const existing = completedCoachRequest(userId, requestId);
    if (existing) {
      if (url.searchParams.get('stream') === '1') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write('data: ' + JSON.stringify({ type: 'done', ...existing, idempotent: true }) + '\n\n');
        return res.end();
      }
      return json(res, 200, { ...existing, idempotent: true });
    }
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
    const conversation = ensureCoachConversation(userId, conversationId, typeof body.dateKey === 'string' ? body.dateKey : undefined);
    const claim = claimCoachRequest(userId, requestId, question, conversation.id);
    if (!claim.claimed) {
      if (claim.status === 'pending') return error(res, 409, 'COACH_REQUEST_IN_PROGRESS', '这次 Coach 请求仍在处理中，请稍后读取结果。');
      return error(res, 409, 'COACH_REQUEST_UNAVAILABLE', '这次 Coach 请求状态不可用，请重新发起请求。');
    }
    db.prepare('INSERT INTO coach_audit_events (id, user_id, event_type, consent_enabled, context_sent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id('coach_audit'), userId, 'request_started', 1, 0, iso());
    if (url.searchParams.get('stream') === '1') {
      const providerMetric = startCoachProviderMetric(userId, requestId, 'stream');
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': forge-heartbeat\\n\\n'); }, 15_000);
      try {
        const text = await requestCoachProviderStream(question, Array.isArray(body.history) ? body.history : [], body.context && typeof body.context === 'object' ? body.context : {}, (delta) => {
          noteCoachProviderDelta(providerMetric, delta);
          res.write('data: ' + JSON.stringify({ type: 'delta', text: delta }) + '\n\n');
        });
        const result = persistCoachAnswer(userId, question, text, requestId, conversation.id);
        completeCoachRequest(userId, requestId);
        finishCoachProviderMetric(providerMetric, 'completed');
        res.write('data: ' + JSON.stringify({ type: 'done', ...result }) + '\n\n');
        res.end();
      } catch (caught) {
        const code = caught?.code === 'COACH_PROVIDER_UNCONFIGURED' ? 'COACH_PROVIDER_UNCONFIGURED' : caught?.code === 'COACH_PROVIDER_EMPTY' ? 'COACH_PROVIDER_EMPTY' : 'COACH_PROVIDER_FAILED';
        failCoachRequest(userId, requestId, code);
        finishCoachProviderMetric(providerMetric, 'failed', code);
        const message = code === 'COACH_PROVIDER_UNCONFIGURED' ? 'Coach AI 服务尚未配置，未生成示例回答。' : code === 'COACH_PROVIDER_EMPTY' ? 'Coach AI 没有返回可用回答。' : 'Coach AI 服务暂时不可用，请稍后重试。';
        res.write('data: ' + JSON.stringify({ type: 'error', code, message }) + '\n\n');
        res.end();
      } finally {
        clearInterval(heartbeat);
      }
      return;
    }
    const providerMetric = startCoachProviderMetric(userId, requestId, 'json');
    try {
      const text = await requestCoachProvider(question, Array.isArray(body.history) ? body.history : [], body.context && typeof body.context === 'object' ? body.context : {});
      const result = persistCoachAnswer(userId, question, text, requestId, conversation.id);
      completeCoachRequest(userId, requestId);
      noteCoachProviderDelta(providerMetric, text);
      finishCoachProviderMetric(providerMetric, 'completed');
      return json(res, 200, result);
    } catch (caught) {
      const code = caught?.code === 'COACH_PROVIDER_UNCONFIGURED' ? 'COACH_PROVIDER_UNCONFIGURED' : caught?.code === 'COACH_PROVIDER_EMPTY' ? 'COACH_PROVIDER_EMPTY' : 'COACH_PROVIDER_FAILED';
      failCoachRequest(userId, requestId, code);
      finishCoachProviderMetric(providerMetric, 'failed', code);
      const message = code === 'COACH_PROVIDER_UNCONFIGURED' ? 'Coach AI 服务尚未配置，未生成示例回答。' : code === 'COACH_PROVIDER_EMPTY' ? 'Coach AI 没有返回可用回答。' : 'Coach AI 服务暂时不可用，请稍后重试。';
      return error(res, 503, code, message);
    }
  }
  return error(res, 404, 'NOT_FOUND', '找不到请求的资源。');
}

const server = createServer((req, res) => { handle(req, res).catch((caught) => { console.error('FORGE API request failed:', caught?.message ?? caught); if (!res.headersSent) error(res, 500, 'INTERNAL_SERVER_ERROR', '服务暂时不可用，请稍后重试。'); else res.destroy(); }); });
server.listen(port, apiHost, () => console.log('FORGE API listening on http://' + apiHost + ':' + port));
process.on('SIGTERM', () => { server.close(() => { db.close(); process.exit(0); }); });
process.on('SIGINT', () => { server.close(() => { db.close(); process.exit(0); }); });

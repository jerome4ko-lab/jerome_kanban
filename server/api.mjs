import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

const COOKIE_NAME = "ai_study_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
const STATUSES = ["todo", "in_progress", "done", "okr", "hidden"];
const STATUS_SET = new Set(STATUSES);

let pool;
let poolConnectionString = "";
let schemaPromise;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getEnv(staticEnv = {}) {
  return {
    ...process.env,
    ...staticEnv,
  };
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = 1024 * 64) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new HttpError(413, "요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const rawBody = await readBody(req);
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "JSON 형식이 올바르지 않습니다.");
  }
}

function getPool(env) {
  if (!env.DATABASE_URL) {
    throw new HttpError(500, "DATABASE_URL 환경 변수가 설정되어 있지 않습니다.");
  }

  if (!pool || poolConnectionString !== env.DATABASE_URL) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: getSslConfig(env.DATABASE_URL, env),
    });
    poolConnectionString = env.DATABASE_URL;
    schemaPromise = undefined;
  }

  return pool;
}

function getSslConfig(connectionString, env) {
  if (env.PGSSLMODE === "disable") {
    return false;
  }

  if (
    env.PGSSLMODE === "require" ||
    /[?&]sslmode=(require|verify-ca|verify-full)\b/i.test(connectionString)
  ) {
    return { rejectUnauthorized: false };
  }

  return false;
}

async function ensureSchema(env) {
  const db = getPool(env);

  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS kanban_tabs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS kanban_items (
          id UUID PRIMARY KEY,
          tab_id TEXT NOT NULL REFERENCES kanban_tabs(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('todo','in_progress','done','okr','hidden')),
          text TEXT NOT NULL,
          group_name TEXT NOT NULL DEFAULT '',
          comment TEXT NOT NULL DEFAULT '',
          memos JSONB NOT NULL DEFAULT '[]'::jsonb,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE kanban_items
          ADD COLUMN IF NOT EXISTS memos JSONB NOT NULL DEFAULT '[]'::jsonb;

        ALTER TABLE kanban_items
          ADD COLUMN IF NOT EXISTS group_name TEXT NOT NULL DEFAULT '';

        UPDATE kanban_items
        SET memos = jsonb_build_array(
          jsonb_build_object(
            'id', id::text || '-m0',
            'text', comment,
            'createdAt', updated_at::text
          )
        )
        WHERE comment IS NOT NULL
          AND comment <> ''
          AND (memos IS NULL OR memos = '[]'::jsonb);

        CREATE INDEX IF NOT EXISTS kanban_items_tab_status_idx
          ON kanban_items (tab_id, status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS subscriptions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          expiry_date DATE NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS calendar_notes (
          id UUID PRIMARY KEY,
          note_date DATE NOT NULL,
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS calendar_notes_date_idx
          ON calendar_notes (note_date);
      `);

      await db.query(`
        DO $migrate$
        BEGIN
          IF EXISTS (
              SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'dashboard_items'
            )
            AND NOT EXISTS (SELECT 1 FROM kanban_tabs LIMIT 1)
          THEN
            INSERT INTO kanban_tabs (id, name, position) VALUES
              ('ai-news', 'AI', 0),
              ('vibe-coding', 'Vibe', 1),
              ('ax', 'AX', 2);

            INSERT INTO kanban_items (id, tab_id, status, text, comment, created_at, updated_at)
            SELECT id, tab_id,
              CASE item_type WHEN 'todo' THEN 'todo' WHEN 'done' THEN 'done' END,
              text, COALESCE(comment, ''), created_at, COALESCE(updated_at, NOW())
            FROM dashboard_items
            WHERE item_type IN ('todo', 'done')
            ON CONFLICT (id) DO NOTHING;
          END IF;
        END
        $migrate$;
      `);
    })();
  }

  await schemaPromise;
}

function assertSessionConfig(env) {
  if (!env.APP_PASSWORD) {
    throw new HttpError(500, "APP_PASSWORD 환경 변수가 설정되어 있지 않습니다.");
  }

  if (!env.SESSION_SECRET) {
    throw new HttpError(500, "SESSION_SECRET 환경 변수가 설정되어 있지 않습니다.");
  }
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, pair) => {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      return cookies;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
    return cookies;
  }, {});
}

function signValue(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionValue(env) {
  const payload = Buffer.from(`v1:${Date.now()}`).toString("base64url");
  return `${payload}.${signValue(payload, env.SESSION_SECRET)}`;
}

function verifySession(req, env) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sessionValue = cookies[COOKIE_NAME];
  if (!sessionValue) {
    return false;
  }

  const [payload, signature] = sessionValue.split(".");
  if (!payload || !signature) {
    return false;
  }

  if (!safeEqual(signValue(payload, env.SESSION_SECRET), signature)) {
    return false;
  }

  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const [version, issuedAt] = decoded.split(":");
  const issuedAtMs = Number(issuedAt);

  return (
    version === "v1" &&
    Number.isFinite(issuedAtMs) &&
    Date.now() - issuedAtMs <= SESSION_MAX_AGE_MS
  );
}

function isSecureCookie(env) {
  return Boolean(
    env.RAILWAY_ENVIRONMENT ||
      env.RAILWAY_PROJECT_ID ||
      env.NODE_ENV === "production",
  );
}

function sessionCookie(value, env) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];

  if (isSecureCookie(env)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function expiredSessionCookie(env) {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (isSecureCookie(env)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function requireAuth(req, env) {
  assertSessionConfig(env);

  if (!verifySession(req, env)) {
    throw new HttpError(401, "로그인이 필요합니다.");
  }
}

function validateText(value, label, maxLength = 4000) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue) {
    throw new HttpError(400, `${label}을(를) 입력해주세요.`);
  }
  if (cleanValue.length > maxLength) {
    throw new HttpError(400, `${label}이(가) 너무 깁니다.`);
  }
  return cleanValue;
}

function validateStatus(value) {
  const cleanValue = String(value || "").trim();
  if (!STATUS_SET.has(cleanValue)) {
    throw new HttpError(400, "올바르지 않은 상태입니다.");
  }
  return cleanValue;
}

function validateGroupName(value) {
  const cleanValue = String(value || "").trim();
  if (cleanValue.length > 60) {
    throw new HttpError(400, "묶음 이름이 너무 깁니다.");
  }
  return cleanValue;
}

function validateMemos(value) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "메모 목록 형식이 올바르지 않습니다.");
  }
  if (value.length > 200) {
    throw new HttpError(400, "메모는 최대 200개까지 추가할 수 있습니다.");
  }
  return value.map((memo) => {
    if (!memo || typeof memo !== "object") {
      throw new HttpError(400, "메모 형식이 올바르지 않습니다.");
    }
    const id = String(memo.id || "").trim();
    if (!id || id.length > 100) {
      throw new HttpError(400, "메모 id가 올바르지 않습니다.");
    }
    const text = String(memo.text == null ? "" : memo.text);
    if (text.length > 4000) {
      throw new HttpError(400, "메모가 너무 깁니다.");
    }
    const createdAt = memo.createdAt
      ? String(memo.createdAt).slice(0, 64)
      : new Date().toISOString();
    return { id, text, createdAt };
  });
}

function toIso(value) {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function rowToTab(row) {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    createdAt: toIso(row.created_at),
  };
}

function rowToSubscription(row) {
  let expiry = row.expiry_date;
  if (expiry instanceof Date) {
    const y = expiry.getFullYear();
    const m = String(expiry.getMonth() + 1).padStart(2, "0");
    const d = String(expiry.getDate()).padStart(2, "0");
    expiry = `${y}-${m}-${d}`;
  } else if (typeof expiry === "string") {
    expiry = expiry.slice(0, 10);
  } else {
    expiry = "";
  }
  return {
    id: row.id,
    name: row.name,
    expiryDate: expiry,
  };
}

function validateExpiryDate(value) {
  const cleanValue = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
    throw new HttpError(400, "만료일 형식이 올바르지 않습니다 (YYYY-MM-DD).");
  }
  return cleanValue;
}

function rowToCalendarNote(row) {
  let date = row.note_date;
  if (date instanceof Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    date = `${y}-${m}-${d}`;
  } else if (typeof date === "string") {
    date = date.slice(0, 10);
  } else {
    date = "";
  }
  return {
    id: row.id,
    date,
    text: row.text || "",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function validateNoteDate(value) {
  const cleanValue = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue)) {
    throw new HttpError(400, "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).");
  }
  return cleanValue;
}

function validateSubscriptionId(value) {
  const cleanValue = String(value || "").trim();
  if (!cleanValue || cleanValue.length > 100) {
    throw new HttpError(400, "구독 ID가 올바르지 않습니다.");
  }
  return cleanValue;
}

async function listSubscriptions(env) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `SELECT id, name, expiry_date FROM subscriptions ORDER BY expiry_date ASC, created_at ASC`,
  );
  return result.rows.map(rowToSubscription);
}

async function upsertSubscription(env, payload) {
  await ensureSchema(env);
  const id = validateSubscriptionId(payload.id);
  const name = validateText(payload.name, "구독 이름", 60);
  const expiryDate = validateExpiryDate(payload.expiryDate);

  const result = await getPool(env).query(
    `
      INSERT INTO subscriptions (id, name, expiry_date)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            expiry_date = EXCLUDED.expiry_date,
            updated_at = NOW()
      RETURNING id, name, expiry_date
    `,
    [id, name, expiryDate],
  );
  return rowToSubscription(result.rows[0]);
}

async function deleteSubscription(env, id) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `DELETE FROM subscriptions WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new HttpError(404, "구독을 찾을 수 없습니다.");
  }
}

async function listCalendarNotes(env) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `SELECT id, note_date, text, created_at, updated_at
       FROM calendar_notes
       ORDER BY note_date ASC, created_at ASC`,
  );
  return result.rows.map(rowToCalendarNote);
}

async function createCalendarNote(env, payload) {
  await ensureSchema(env);
  const date = validateNoteDate(payload.date);
  const text = validateText(payload.text, "캘린더 메모", 200);
  const id = randomUUID();

  const result = await getPool(env).query(
    `
      INSERT INTO calendar_notes (id, note_date, text)
      VALUES ($1, $2, $3)
      RETURNING id, note_date, text, created_at, updated_at
    `,
    [id, date, text],
  );
  return rowToCalendarNote(result.rows[0]);
}

async function updateCalendarNote(env, id, payload) {
  await ensureSchema(env);
  const cleanId = String(id || "").trim();
  if (!cleanId) {
    throw new HttpError(400, "메모 ID가 올바르지 않습니다.");
  }

  const fields = [];
  const params = [];

  if (payload.date !== undefined) {
    fields.push(`note_date = $${params.length + 1}`);
    params.push(validateNoteDate(payload.date));
  }
  if (payload.text !== undefined) {
    fields.push(`text = $${params.length + 1}`);
    params.push(validateText(payload.text, "캘린더 메모", 200));
  }

  if (fields.length === 0) {
    throw new HttpError(400, "수정할 내용이 없습니다.");
  }

  fields.push(`updated_at = NOW()`);
  params.push(cleanId);

  const result = await getPool(env).query(
    `
      UPDATE calendar_notes
      SET ${fields.join(", ")}
      WHERE id = $${params.length}
      RETURNING id, note_date, text, created_at, updated_at
    `,
    params,
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, "메모를 찾을 수 없습니다.");
  }
  return rowToCalendarNote(result.rows[0]);
}

async function deleteCalendarNote(env, id) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `DELETE FROM calendar_notes WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new HttpError(404, "메모를 찾을 수 없습니다.");
  }
}

function rowToItem(row) {
  return {
    id: row.id,
    tabId: row.tab_id,
    status: row.status,
    text: row.text,
    groupName: row.group_name || "",
    memos: Array.isArray(row.memos) ? row.memos : [],
    position: row.position,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function getDashboard(env) {
  await ensureSchema(env);
  const db = getPool(env);

  const [tabsResult, itemsResult] = await Promise.all([
    db.query(`
      SELECT id, name, position, created_at FROM kanban_tabs
      ORDER BY position ASC, created_at ASC
    `),
    db.query(`
      SELECT id, tab_id, status, text, group_name, memos, position, created_at, updated_at
      FROM kanban_items
      ORDER BY updated_at DESC
    `),
  ]);

  return {
    tabs: tabsResult.rows.map(rowToTab),
    items: itemsResult.rows.map(rowToItem),
  };
}

async function createTab(env, payload) {
  await ensureSchema(env);
  const name = validateText(payload.name, "주제 이름", 60);
  const id = randomUUID();
  const db = getPool(env);
  const positionResult = await db.query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM kanban_tabs`,
  );
  const position = Number(positionResult.rows[0]?.next) || 0;
  const result = await db.query(
    `
      INSERT INTO kanban_tabs (id, name, position)
      VALUES ($1, $2, $3)
      RETURNING id, name, position, created_at
    `,
    [id, name, position],
  );
  return rowToTab(result.rows[0]);
}

async function updateTab(env, tabId, payload) {
  await ensureSchema(env);
  const sets = [];
  const params = [tabId];

  if (payload.name !== undefined) {
    sets.push(`name = $${params.length + 1}`);
    params.push(validateText(payload.name, "주제 이름", 60));
  }
  if (payload.position !== undefined) {
    const pos = Number(payload.position);
    if (!Number.isInteger(pos) || pos < 0) {
      throw new HttpError(400, "올바르지 않은 위치입니다.");
    }
    sets.push(`position = $${params.length + 1}`);
    params.push(pos);
  }
  if (sets.length === 0) {
    throw new HttpError(400, "변경할 내용이 없습니다.");
  }

  const result = await getPool(env).query(
    `UPDATE kanban_tabs SET ${sets.join(", ")} WHERE id = $1
     RETURNING id, name, position, created_at`,
    params,
  );
  if (result.rowCount === 0) {
    throw new HttpError(404, "주제를 찾을 수 없습니다.");
  }
  return rowToTab(result.rows[0]);
}

async function deleteTab(env, tabId) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `DELETE FROM kanban_tabs WHERE id = $1`,
    [tabId],
  );
  if (result.rowCount === 0) {
    throw new HttpError(404, "주제를 찾을 수 없습니다.");
  }
}

async function createItem(env, payload) {
  await ensureSchema(env);
  const tabId = String(payload.tabId || "").trim();
  if (!tabId) {
    throw new HttpError(400, "주제를 선택해주세요.");
  }
  const text = validateText(payload.text, "항목");
  const groupName = validateGroupName(payload.groupName);
  const status = payload.status ? validateStatus(payload.status) : "todo";
  const id = randomUUID();
  const db = getPool(env);

  const tab = await db.query(`SELECT id FROM kanban_tabs WHERE id = $1`, [tabId]);
  if (tab.rowCount === 0) {
    throw new HttpError(400, "올바르지 않은 주제입니다.");
  }

  const result = await db.query(
    `
      INSERT INTO kanban_items (id, tab_id, status, text, group_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, tab_id, status, text, group_name, memos, position, created_at, updated_at
    `,
    [id, tabId, status, text, groupName],
  );
  return rowToItem(result.rows[0]);
}

async function updateItem(env, itemId, payload) {
  await ensureSchema(env);
  const sets = [];
  const params = [itemId];

  if (payload.status !== undefined) {
    sets.push(`status = $${params.length + 1}`);
    params.push(validateStatus(payload.status));
  }
  if (payload.text !== undefined) {
    sets.push(`text = $${params.length + 1}`);
    params.push(validateText(payload.text, "항목"));
  }
  if (payload.groupName !== undefined) {
    sets.push(`group_name = $${params.length + 1}`);
    params.push(validateGroupName(payload.groupName));
  }
  if (payload.memos !== undefined) {
    sets.push(`memos = $${params.length + 1}::jsonb`);
    params.push(JSON.stringify(validateMemos(payload.memos)));
  }

  if (sets.length === 0) {
    throw new HttpError(400, "수정할 내용이 없습니다.");
  }

  sets.push(`updated_at = NOW()`);
  const result = await getPool(env).query(
    `
      UPDATE kanban_items SET ${sets.join(", ")}
      WHERE id = $1
      RETURNING id, tab_id, status, text, group_name, memos, position, created_at, updated_at
    `,
    params,
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, "항목을 찾을 수 없습니다.");
  }
  return rowToItem(result.rows[0]);
}

async function deleteItem(env, itemId) {
  await ensureSchema(env);
  const result = await getPool(env).query(
    `DELETE FROM kanban_items WHERE id = $1`,
    [itemId],
  );
  if (result.rowCount === 0) {
    throw new HttpError(404, "항목을 찾을 수 없습니다.");
  }
}

async function handleSession(req, res, env) {
  assertSessionConfig(env);

  if (req.method === "GET") {
    sendJson(res, 200, { authenticated: verifySession(req, env) });
    return;
  }

  if (req.method === "POST") {
    const { password } = await readJson(req);
    const cleanPassword = String(password || "");

    if (!safeEqual(cleanPassword, env.APP_PASSWORD)) {
      throw new HttpError(401, "비밀번호가 올바르지 않습니다.");
    }

    sendJson(
      res,
      200,
      { authenticated: true },
      { "set-cookie": sessionCookie(createSessionValue(env), env) },
    );
    return;
  }

  throw new HttpError(405, "지원하지 않는 요청입니다.");
}

export function createApiHandler(options = {}) {
  const staticEnv = options.env || {};

  return async function handleApiRequest(req, res) {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = requestUrl.pathname;

    if (!pathname.startsWith("/api/")) {
      return false;
    }

    const env = getEnv(staticEnv);

    try {
      if (pathname === "/api/session") {
        await handleSession(req, res, env);
        return true;
      }

      if (pathname === "/api/logout") {
        if (req.method !== "POST") {
          throw new HttpError(405, "POST 요청만 지원합니다.");
        }

        sendJson(
          res,
          200,
          { authenticated: false },
          { "set-cookie": expiredSessionCookie(env) },
        );
        return true;
      }

      requireAuth(req, env);

      if (pathname === "/api/dashboard") {
        if (req.method !== "GET") {
          throw new HttpError(405, "GET 요청만 지원합니다.");
        }
        sendJson(res, 200, await getDashboard(env));
        return true;
      }

      if (pathname === "/api/tabs") {
        if (req.method !== "POST") {
          throw new HttpError(405, "POST 요청만 지원합니다.");
        }
        sendJson(res, 201, { tab: await createTab(env, await readJson(req)) });
        return true;
      }

      const tabMatch = pathname.match(/^\/api\/tabs\/([^/]+)$/);
      if (tabMatch) {
        const tabId = decodeURIComponent(tabMatch[1]);
        if (req.method === "PATCH") {
          sendJson(res, 200, {
            tab: await updateTab(env, tabId, await readJson(req)),
          });
          return true;
        }
        if (req.method === "DELETE") {
          await deleteTab(env, tabId);
          sendJson(res, 200, { ok: true });
          return true;
        }
        throw new HttpError(405, "지원하지 않는 요청입니다.");
      }

      if (pathname === "/api/items") {
        if (req.method !== "POST") {
          throw new HttpError(405, "POST 요청만 지원합니다.");
        }
        sendJson(res, 201, {
          item: await createItem(env, await readJson(req)),
        });
        return true;
      }

      const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
      if (itemMatch) {
        const itemId = decodeURIComponent(itemMatch[1]);
        if (req.method === "PATCH") {
          sendJson(res, 200, {
            item: await updateItem(env, itemId, await readJson(req)),
          });
          return true;
        }
        if (req.method === "DELETE") {
          await deleteItem(env, itemId);
          sendJson(res, 200, { ok: true });
          return true;
        }
        throw new HttpError(405, "지원하지 않는 요청입니다.");
      }

      if (pathname === "/api/subscriptions") {
        if (req.method === "GET") {
          sendJson(res, 200, { subscriptions: await listSubscriptions(env) });
          return true;
        }
        if (req.method === "POST") {
          sendJson(res, 200, {
            subscription: await upsertSubscription(env, await readJson(req)),
          });
          return true;
        }
        throw new HttpError(405, "지원하지 않는 요청입니다.");
      }

      const subscriptionMatch = pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
      if (subscriptionMatch) {
        const subId = decodeURIComponent(subscriptionMatch[1]);
        if (req.method === "DELETE") {
          await deleteSubscription(env, subId);
          sendJson(res, 200, { ok: true });
          return true;
        }
        throw new HttpError(405, "지원하지 않는 요청입니다.");
      }

      if (pathname === "/api/calendar-notes") {
        if (req.method === "GET") {
          sendJson(res, 200, { notes: await listCalendarNotes(env) });
          return true;
        }
        if (req.method === "POST") {
          sendJson(res, 201, {
            note: await createCalendarNote(env, await readJson(req)),
          });
          return true;
        }
        throw new HttpError(405, "지원하지 않는 요청입니다.");
      }

      const calendarNoteMatch = pathname.match(
        /^\/api\/calendar-notes\/([^/]+)$/,
      );
      if (calendarNoteMatch) {
        const noteId = decodeURIComponent(calendarNoteMatch[1]);
        if (req.method === "PATCH") {
          sendJson(res, 200, {
            note: await updateCalendarNote(env, noteId, await readJson(req)),
          });
          return true;
        }
        if (req.method === "DELETE") {
          await deleteCalendarNote(env, noteId);
          sendJson(res, 200, { ok: true });
          return true;
        }
        throw new HttpError(405, "지원하지 않는 요청입니다.");
      }

      throw new HttpError(404, "API 경로를 찾을 수 없습니다.");
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      sendJson(res, statusCode, {
        error:
          error instanceof Error
            ? error.message
            : "알 수 없는 오류가 발생했습니다.",
      });
      return true;
    }
  };
}

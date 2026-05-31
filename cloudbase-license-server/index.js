const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
});

const db = app.database();
const licenses = db.collection("licenses");
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function response(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(payload),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  if (typeof event.body === "object") return event.body;

  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function makeLicenseCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `POE2-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

function getPath(event) {
  return event.path || event.requestContext?.path || event.requestContext?.http?.path || "/";
}

function getMethod(event) {
  return String(event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();
}

function getHeader(event, name) {
  const headers = event.headers || {};
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
  return key ? headers[key] : "";
}

async function findLicense(code) {
  const result = await licenses.where({ code }).limit(1).get();
  return result.data?.[0] || null;
}

async function verifyLicense(body) {
  const code = normalizeCode(body.activationCode);
  const deviceId = String(body.deviceId || "").trim();

  if (!code || !deviceId) {
    return response(400, { ok: false, message: "缺少激活码或设备信息。" });
  }

  const license = await findLicense(code);
  if (!license) {
    return response(404, { ok: false, message: "激活码不存在。" });
  }

  if (license.status === "disabled") {
    return response(403, { ok: false, message: "激活码已被停用。" });
  }

  const now = Date.now();
  const expiresAtMs = license.expiresAt ? new Date(license.expiresAt).getTime() : null;

  if (license.deviceId && license.deviceId !== deviceId) {
    return response(403, { ok: false, message: "激活码已绑定其他设备。" });
  }

  if (expiresAtMs && expiresAtMs <= now) {
    await licenses.doc(license._id).update({ lastSeenAt: nowIso() });
    return response(403, { ok: false, message: "激活码已过期。" });
  }

  const update = {
    lastSeenAt: nowIso(),
  };

  if (!license.deviceId) {
    update.deviceId = deviceId;
    update.status = "active";
    update.plan = license.plan || "monthly";
    update.activatedAt = nowIso();
    update.expiresAt = new Date(now + MONTH_MS).toISOString();
  }

  await licenses.doc(license._id).update(update);

  return response(200, {
    ok: true,
    plan: update.plan || license.plan || "monthly",
    expiresAt: update.expiresAt || license.expiresAt,
    message: "月卡已激活",
  });
}

async function createLicenses(event, body) {
  const token = String(getHeader(event, "authorization")).replace(/^Bearer\s+/i, "");
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return response(401, { ok: false, message: "无权限。" });
  }

  const count = Math.min(Math.max(Number(body.count) || 1, 1), 100);
  const codes = [];

  for (let index = 0; index < count; index += 1) {
    let code = makeLicenseCode();
    while (await findLicense(code)) code = makeLicenseCode();

    await licenses.add({
      code,
      status: "unused",
      plan: "monthly",
      createdAt: nowIso(),
    });
    codes.push(code);
  }

  return response(201, { ok: true, codes });
}

exports.main = async (event) => {
  const method = getMethod(event);
  const path = getPath(event);

  if (method === "OPTIONS") {
    return response(204, {});
  }

  if (method === "GET") {
    return response(200, { ok: true, service: "poe2-cloudbase-license-server" });
  }

  const body = parseBody(event);

  if (method === "POST" && path.endsWith("/api/license/verify")) {
    return verifyLicense(body);
  }

  if (method === "POST" && path.endsWith("/api/admin/licenses")) {
    return createLicenses(event, body);
  }

  return response(404, { ok: false, message: "接口不存在。" });
};

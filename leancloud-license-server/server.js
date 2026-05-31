const crypto = require("crypto");
const express = require("express");
const AV = require("leanengine");

const app = express();
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const License = AV.Object.extend("License");

AV.init({
  appId: process.env.LEANCLOUD_APP_ID,
  appKey: process.env.LEANCLOUD_APP_KEY,
  masterKey: process.env.LEANCLOUD_APP_MASTER_KEY,
});
AV.Cloud.useMasterKey();

app.use(express.json({ limit: "32kb" }));

function json(res, status, payload) {
  res.status(status).json(payload);
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function makeLicenseCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `POE2-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

async function findLicense(code) {
  const query = new AV.Query("License");
  query.equalTo("code", code);
  return query.first({ useMasterKey: true });
}

function publicLicensePayload(license, message = "月卡已激活") {
  return {
    ok: true,
    plan: license.get("plan") || "monthly",
    expiresAt: license.get("expiresAt").toISOString(),
    message,
  };
}

app.get("/", (_req, res) => {
  json(res, 200, { ok: true, service: "poe2-license-server" });
});

app.post("/api/license/verify", async (req, res) => {
  const code = normalizeCode(req.body.activationCode);
  const deviceId = String(req.body.deviceId || "").trim();

  if (!code || !deviceId) {
    json(res, 400, { ok: false, message: "缺少激活码或设备信息。" });
    return;
  }

  try {
    const license = await findLicense(code);
    if (!license) {
      json(res, 404, { ok: false, message: "激活码不存在。" });
      return;
    }

    if (license.get("status") === "disabled") {
      json(res, 403, { ok: false, message: "激活码已被停用。" });
      return;
    }

    const now = new Date();
    const boundDeviceId = license.get("deviceId");
    const expiresAt = license.get("expiresAt");

    if (boundDeviceId && boundDeviceId !== deviceId) {
      json(res, 403, { ok: false, message: "激活码已绑定其他设备。" });
      return;
    }

    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      license.set("lastSeenAt", now);
      await license.save(null, { useMasterKey: true });
      json(res, 403, { ok: false, message: "激活码已过期。" });
      return;
    }

    if (!boundDeviceId) {
      license.set("deviceId", deviceId);
      license.set("status", "active");
      license.set("plan", license.get("plan") || "monthly");
      license.set("activatedAt", now);
      license.set("expiresAt", new Date(now.getTime() + MONTH_MS));
    }

    license.set("lastSeenAt", now);
    await license.save(null, { useMasterKey: true });
    json(res, 200, publicLicensePayload(license));
  } catch (error) {
    json(res, 500, { ok: false, message: error.message || String(error) });
  }
});

app.post("/api/admin/licenses", async (req, res) => {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    json(res, 401, { ok: false, message: "无权限。" });
    return;
  }

  const count = Math.min(Math.max(Number(req.body.count) || 1, 1), 100);
  const licenses = [];

  try {
    for (let index = 0; index < count; index += 1) {
      let code = makeLicenseCode();
      while (await findLicense(code)) code = makeLicenseCode();

      const license = new License();
      license.set("code", code);
      license.set("status", "unused");
      license.set("plan", "monthly");
      licenses.push(license);
    }

    await AV.Object.saveAll(licenses, { useMasterKey: true });
    json(res, 201, {
      ok: true,
      codes: licenses.map((license) => license.get("code")),
    });
  } catch (error) {
    json(res, 500, { ok: false, message: error.message || String(error) });
  }
});

app.use(AV.express());

const port = Number(process.env.LEANCLOUD_APP_PORT || process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`POE2 license server listening on ${port}`);
});

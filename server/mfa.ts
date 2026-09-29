import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import QRCode from "qrcode";

type Row = Record<string, any>;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const now = () => new Date().toISOString();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function base32Encode(input: Buffer) {
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, "0");
    output += alphabet[parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(value: string) {
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, at = Date.now()) {
  const counter = Math.floor(at / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function verifyTotp(secret: string, rawCode: string) {
  const code = rawCode.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((window) => {
    const expected = totpCode(secret, Date.now() + window * 30_000);
    const left = Buffer.from(code);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

function normalizeRecovery(value: string) {
  return value.trim().toUpperCase().replace(/[^A-F0-9]/g, "");
}

function recoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const raw = randomBytes(6).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export function initMfa(db: DatabaseSync, linkSecret: string) {
  const key = createHash("sha256").update(`${linkSecret}|admin-mfa`).digest();
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_mfa(
      user_id TEXT PRIMARY KEY,
      secret_value TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      recovery_hashes TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mfa_challenges(
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('setup','verify')),
      expires INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mfa_challenges_expiry ON mfa_challenges(expires);
  `);
  db.exec("DELETE FROM mfa_challenges");

  function seal(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
  }

  function open(value: string) {
    const [version, ivText, tagText, dataText] = value.split(":");
    if (version !== "v1" || !ivText || !tagText || !dataText)
      throw new Error("Invalid MFA secret format.");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  function row(userId: string) {
    return db.prepare("SELECT * FROM admin_mfa WHERE user_id=?").get(userId) as Row | undefined;
  }

  function ensure(userId: string) {
    let record = row(userId);
    if (!record) {
      const secret = base32Encode(randomBytes(20));
      const stamp = now();
      db.prepare(`
        INSERT INTO admin_mfa(user_id,secret_value,enabled,recovery_hashes,created_at,updated_at)
        VALUES(?,?,0,'[]',?,?)
      `).run(userId, seal(secret), stamp, stamp);
      record = row(userId)!;
    }
    return record;
  }

  async function begin(userId: string, label: string) {
    db.prepare("DELETE FROM mfa_challenges WHERE expires<=? OR user_id=?").run(Date.now(), userId);
    const record = ensure(userId);
    const setupRequired = !Boolean(record.enabled);
    const rawToken = randomBytes(32).toString("hex");
    db.prepare(`
      INSERT INTO mfa_challenges(token_hash,user_id,kind,expires,attempts,created_at)
      VALUES(?,?,?,?,0,?)
    `).run(
      digest(rawToken),
      userId,
      setupRequired ? "setup" : "verify",
      Date.now() + 5 * 60_000,
      now(),
    );
    if (!setupRequired)
      return { challengeToken: rawToken, setupRequired: false as const };

    const secret = open(record.secret_value);
    const issuer = "CombatZone SLU";
    const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrCode = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
    });
    return {
      challengeToken: rawToken,
      setupRequired: true as const,
      secret,
      qrCode,
    };
  }

  function challenge(rawToken: string) {
    if (!/^[a-f0-9]{64}$/i.test(rawToken)) return undefined;
    return db.prepare("SELECT * FROM mfa_challenges WHERE token_hash=?")
      .get(digest(rawToken)) as Row | undefined;
  }

  function verify(rawToken: string, rawCode: string) {
    const item = challenge(rawToken);
    if (!item || item.expires <= Date.now() || item.attempts >= 6)
      return { ok: false as const };

    db.prepare("UPDATE mfa_challenges SET attempts=attempts+1 WHERE token_hash=?")
      .run(digest(rawToken));
    const record = row(item.user_id);
    if (!record) return { ok: false as const };
    const secret = open(record.secret_value);

    if (item.kind === "setup") {
      if (!verifyTotp(secret, rawCode)) return { ok: false as const };
      const codes = recoveryCodes();
      const hashes = codes.map((code) =>
        digest(`${item.user_id}|${normalizeRecovery(code)}`)
      );
      db.prepare(`
        UPDATE admin_mfa SET enabled=1,recovery_hashes=?,updated_at=? WHERE user_id=?
      `).run(JSON.stringify(hashes), now(), item.user_id);
      db.prepare("DELETE FROM mfa_challenges WHERE user_id=?").run(item.user_id);
      return { ok: true as const, userId: item.user_id, recoveryCodes: codes };
    }

    let accepted = verifyTotp(secret, rawCode);
    let usedRecovery = false;
    if (!accepted) {
      const normalized = normalizeRecovery(rawCode);
      if (/^[A-F0-9]{12}$/.test(normalized)) {
        const hashes = JSON.parse(record.recovery_hashes || "[]") as string[];
        const candidate = digest(`${item.user_id}|${normalized}`);
        const index = hashes.findIndex((hash) => {
          const left = Buffer.from(hash);
          const right = Buffer.from(candidate);
          return left.length === right.length && timingSafeEqual(left, right);
        });
        if (index >= 0) {
          hashes.splice(index, 1);
          db.prepare("UPDATE admin_mfa SET recovery_hashes=?,updated_at=? WHERE user_id=?")
            .run(JSON.stringify(hashes), now(), item.user_id);
          accepted = true;
          usedRecovery = true;
        }
      }
    }
    if (!accepted) return { ok: false as const };
    db.prepare("DELETE FROM mfa_challenges WHERE user_id=?").run(item.user_id);
    return { ok: true as const, userId: item.user_id, usedRecovery };
  }

  function status(userId: string) {
    const record = row(userId);
    const hashes = record ? JSON.parse(record.recovery_hashes || "[]") as string[] : [];
    return {
      enabled: Boolean(record?.enabled),
      recoveryCodesRemaining: hashes.length,
    };
  }

  function reset(userId: string) {
    db.prepare("DELETE FROM mfa_challenges WHERE user_id=?").run(userId);
    db.prepare("DELETE FROM admin_mfa WHERE user_id=?").run(userId);
  }

  return { begin, verify, status, reset };
}

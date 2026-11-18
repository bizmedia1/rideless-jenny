
const crypto = require("crypto");
const { readJSON, writeJSON } = require("../lib/github-storage");

const USERS_FILE = "data/users.json";
const SESSIONS_FILE = "data/sessions.json";

const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;

function send(res, code, data) {
  return res.status(code).json(data);
}

function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split("$");

    if (parts.length !== 3 || parts[0] !== "scrypt") {
      return false;
    }

    const salt = parts[1];
    const originalHash = Buffer.from(parts[2], "hex");

    if (!salt || originalHash.length !== 64) {
      return false;
    }

    const suppliedHash = crypto.scryptSync(
      password,
      salt,
      64
    );

    return crypto.timingSafeEqual(
      suppliedHash,
      originalHash
    );
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, {
      status: false,
      message: "Method not allowed."
    });
  }

  try {
    const { identifier, password } = req.body || {};

    if (
      typeof identifier !== "string" ||
      typeof password !== "string" ||
      !identifier.trim() ||
      !password
    ) {
      return send(res, 400, {
        status: false,
        message: "Enter your email or phone number and password."
      });
    }

    const normalizedIdentifier = identifier.trim().toLowerCase();

    const usersResult = await readJSON(USERS_FILE, []);
    const users = Array.isArray(usersResult.data)
      ? usersResult.data
      : [];

    const user = users.find(item =>
      item.email?.toLowerCase() === normalizedIdentifier ||
      item.phone?.replace(/\s+/g, "") === identifier.replace(/\s+/g, "")
    );

    if (
      !user ||
      user.status !== "active" ||
      !user.passwordHash ||
      !verifyPassword(password, user.passwordHash)
    ) {
      return send(res, 401, {
        status: false,
        message: "Incorrect login details or account not activated."
      });
    }

    const sessionsResult = await readJSON(SESSIONS_FILE, []);
    const sessions = Array.isArray(sessionsResult.data)
      ? sessionsResult.data
      : [];

    const now = Date.now();

    const activeSessions = sessions.filter(session =>
      session.expiresAt > now
    );

    const sessionToken = crypto.randomBytes(32).toString("hex");

    const session = {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: crypto
        .createHash("sha256")
        .update(sessionToken)
        .digest("hex"),
      createdAt: new Date(now).toISOString(),
      expiresAt: now + SESSION_DURATION
    };

    activeSessions.push(session);

    await writeJSON(
      SESSIONS_FILE,
      activeSessions,
      sessionsResult.sha
    );

    return send(res, 200, {
      status: true,
      message: "Login successful.",
      token: sessionToken,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone
      }
    });

  } catch (error) {
    console.error("[RIDELESSCHAT LOGIN]", error);

    return send(res, 500, {
      status: false,
      message: "Unable to log in right now. Please try again."
    });
  }
};

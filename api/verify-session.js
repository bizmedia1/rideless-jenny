
const crypto = require("crypto");
const { readJSON } = require("../lib/github-storage");

const SESSIONS_FILE = "data/sessions.json";
const USERS_FILE = "data/users.json";

function send(res, code, data) {
  return res.status(code).json(data);
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function safeCompare(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    !/^[a-f0-9]{64}$/i.test(a) ||
    !/^[a-f0-9]{64}$/i.test(b)
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(a, "hex"),
    Buffer.from(b, "hex")
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
    const authorization = req.headers.authorization || "";
    const bearerToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    const token =
      bearerToken ||
      (typeof req.body?.token === "string" ? req.body.token.trim() : "");

    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
      return send(res, 401, {
        status: false,
        message: "A valid session is required."
      });
    }

    const [sessionsResult, usersResult] = await Promise.all([
      readJSON(SESSIONS_FILE, []),
      readJSON(USERS_FILE, [])
    ]);

    const sessions = Array.isArray(sessionsResult.data)
      ? sessionsResult.data
      : [];

    const users = Array.isArray(usersResult.data)
      ? usersResult.data
      : [];

    const tokenHash = hashToken(token);
    const now = Date.now();

    const session = sessions.find(item =>
      safeCompare(item.tokenHash, tokenHash) &&
      Number(item.expiresAt) > now
    );

    if (!session) {
      return send(res, 401, {
        status: false,
        message: "Your session has expired. Please sign in again."
      });
    }

    const user = users.find(item =>
      item.id === session.userId &&
      item.status === "active"
    );

    if (!user) {
      return send(res, 401, {
        status: false,
        message: "This account is not active."
      });
    }

    return send(res, 200, {
      status: true,
      authenticated: true,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone
      }
    });

  } catch (error) {
    console.error("[RIDELESSCHAT SESSION VERIFY]", error);

    return send(res, 500, {
      status: false,
      message: "Unable to verify your session."
    });
  }
};

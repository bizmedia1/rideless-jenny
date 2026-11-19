
const crypto = require("crypto");
const {
  readJSON,
  writeJSON
} = require("../lib/github-storage");

const PAYMENTS_FILE = "data/payments.json";
const USERS_FILE = "data/users.json";
const SESSIONS_FILE = "data/sessions.json";

const ACTIVATION_PRICES_KOBO = [
  370000,
  520000
];

const SESSION_DURATION_DAYS = 30;

function send(res, statusCode, payload) {
  return res.status(statusCode).json(payload);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();

  const expiresAt = new Date(
    now + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  return {
    token,
    session: {
      id: crypto.randomUUID(),
      tokenHash: hashToken(token),
      userId: user.id,
      paymentId: user.paymentId,
      createdAt: new Date(now).toISOString(),
      expiresAt
    }
  };
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
    const { paymentId, statusToken } = req.body || {};

    if (
      typeof paymentId !== "string" ||
      typeof statusToken !== "string" ||
      !paymentId.trim() ||
      !statusToken.trim()
    ) {
      return send(res, 400, {
        status: false,
        message: "Invalid payment details."
      });
    }

    const [
      paymentsResult,
      usersResult,
      sessionsResult
    ] = await Promise.all([
      readJSON(PAYMENTS_FILE, []),
      readJSON(USERS_FILE, []),
      readJSON(SESSIONS_FILE, [])
    ]);

    const payments = Array.isArray(paymentsResult.data)
      ? paymentsResult.data
      : [];

    const users = Array.isArray(usersResult.data)
      ? usersResult.data
      : [];

    let sessions = Array.isArray(sessionsResult.data)
      ? sessionsResult.data
      : [];

    const payment = payments.find(item =>
      item.id === paymentId &&
      item.provider === "movantra" &&
      item.method === "paga" &&
      item.activation === true &&
      ACTIVATION_PRICES_KOBO.includes(Number(item.amountKobo))
    );

    if (
      !payment ||
      !safeCompare(
        payment.statusTokenHash,
        hashToken(statusToken)
      )
    ) {
      return send(res, 404, {
        status: false,
        message: "Payment record not found."
      });
    }

    /* SUPERSEDED PAYMENT */

    if (payment.status === "superseded") {
      return send(res, 200, {
        status: true,
        paymentStatus: "superseded",
        activated: false,
        message: "This payment has been replaced by a newly selected amount."
      });
    }

    /* APPROVED PAYMENT */

    if (payment.status === "approved") {
      const activeUser = users.find(user =>
        user.paymentId === payment.id &&
        user.status === "active"
      );

      if (!activeUser || !activeUser.id) {
        return send(res, 200, {
          status: true,
          paymentStatus: "pending",
          activated: false
        });
      }

      const now = Date.now();

      sessions = sessions.filter(session => {
        const expiry = new Date(session.expiresAt).getTime();

        return (
          Number.isFinite(expiry) &&
          expiry > now
        );
      });

      const newSession = createSession(activeUser);

      sessions.push(newSession.session);

      await writeJSON(
        SESSIONS_FILE,
        sessions,
        sessionsResult.sha
      );

      const safeUser = {
        id: activeUser.id,
        name: activeUser.name || activeUser.fullName || "",
        email: activeUser.email || "",
        phone: activeUser.phone || ""
      };

      return send(res, 200, {
        status: true,
        paymentStatus: "approved",
        activated: true,
        token: newSession.token,
        expiresAt: newSession.session.expiresAt,
        user: safeUser
      });
    }

    /* EXPIRED PAYMENT */

    const expiry = payment.activationExpiresAt
      ? new Date(payment.activationExpiresAt).getTime()
      : 0;

    if (
      payment.status === "expired" ||
      (
        Number.isFinite(expiry) &&
        expiry > 0 &&
        Date.now() > expiry &&
        payment.status !== "approved"
      )
    ) {
      if (payment.status !== "expired") {
        payment.status = "expired";

        await writeJSON(
          PAYMENTS_FILE,
          payments,
          paymentsResult.sha
        );
      }

      return send(res, 200, {
        status: true,
        paymentStatus: "expired",
        activated: false
      });
    }

    /* PENDING PAYMENT */

    return send(res, 200, {
      status: true,
      paymentStatus: "pending",
      activated: false
    });

  } catch (error) {
    console.error(
      "[RIDELESSCHAT PAYMENT STATUS]",
      error.message
    );

    return send(res, 500, {
      status: false,
      message: "Unable to check payment status."
    });
  }
};
        

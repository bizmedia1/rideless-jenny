
const crypto = require("crypto");
const { readJSON } = require("../lib/github-storage");

const PAYMENTS_FILE = "data/payments.json";
const USERS_FILE = "data/users.json";

function send(res, statusCode, payload) {
  res.status(statusCode).json(payload);
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
  ) return false;

  return crypto.timingSafeEqual(
    Buffer.from(a, "hex"),
    Buffer.from(b, "hex")
  );
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

    const [paymentsResult, usersResult] = await Promise.all([
      readJSON(PAYMENTS_FILE, []),
      readJSON(USERS_FILE, [])
    ]);

    const payments = Array.isArray(paymentsResult.data)
      ? paymentsResult.data
      : [];

    const users = Array.isArray(usersResult.data)
      ? usersResult.data
      : [];

    const payment = payments.find(item =>
      item.paymentId === paymentId &&
      item.provider === "movantra" &&
      item.method === "paga" &&
      item.activation === true
    );

    if (!payment || !safeCompare(
      payment.statusTokenHash,
      hashToken(statusToken)
    )) {
      return send(res, 404, {
        status: false,
        message: "Payment record not found."
      });
    }

    // Approval is only valid when the webhook has approved
    // the payment AND the corresponding active account exists.
    if (payment.status === "approved") {
      const activeUser = users.find(user =>
        user.paymentId === payment.paymentId &&
        user.status === "active"
      );

      if (activeUser) {
        return send(res, 200, {
          status: true,
          paymentStatus: "approved",
          activated: true
        });
      }
    }

    const expiry = payment.activationExpiresAt
      ? new Date(payment.activationExpiresAt).getTime()
      : 0;

    if (
      expiry &&
      Number.isFinite(expiry) &&
      Date.now() > expiry &&
      payment.status !== "approved"
    ) {
      return send(res, 200, {
        status: true,
        paymentStatus: "expired",
        activated: false
      });
    }

    return send(res, 200, {
      status: true,
      paymentStatus: "pending",
      activated: false
    });

  } catch (error) {
    console.error("[RIDELESSCHAT PAYMENT STATUS]", error);

    return send(res, 500, {
      status: false,
      message: "Unable to check payment status."
    });
  }
};

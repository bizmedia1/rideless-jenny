
const crypto = require("crypto");
const { readJSON, writeJSON } = require("../../lib/github-storage");

const PAYMENTS_FILE = "data/payments.json";
const USERS_FILE = "data/users.json";

const ACTIVATION_PRICES_KOBO = [
  370000,
  520000
];

function send(res, statusCode, data) {
  return res.status(statusCode).json(data);
}

function safeCompare(a, b) {
  const first = Buffer.from(String(a || ""));
  const second = Buffer.from(String(b || ""));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;

  const expected = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex");

  return safeCompare(expected, signature);
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;

  if (typeof req.body === "string") {
    return Buffer.from(req.body);
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return send(res, 405, {
      status: false,
      message: "Method not allowed."
    });
  }

  try {
    const secret = process.env.MOVANTRA_SECRET_KEY;

    if (!secret) {
      throw new Error("Payment provider configuration is missing.");
    }

    const rawBody = await readRawBody(req);
    const signature = req.headers["x-movantra-signature"];

    if (!verifySignature(rawBody, signature, secret)) {
      console.warn("[RIDELESSCHAT] Webhook signature verification failed.");

      return send(res, 401, {
        status: false,
        message: "Invalid webhook signature."
      });
    }

    let payload;

    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return send(res, 400, {
        status: false,
        message: "Invalid webhook payload."
      });
    }

    const event =
      req.headers["x-movantra-event"] ||
      payload.event ||
      "";

    if (
      event !== "charge.success" &&
      event !== "virtual_account.credit"
    ) {
      return send(res, 200, {
        status: true,
        message: "Event ignored."
      });
    }

    const data = payload.data || {};
    const reference = String(data.reference || "").trim();
    const currency = String(data.currency || "").toUpperCase();
    const amount = Number(data.amount);
    const paymentStatus = String(data.status || "").toLowerCase();

    if (!reference) {
      return send(res, 400, {
        status: false,
        message: "Payment reference is missing."
      });
    }

    if (currency !== "NGN") {
      return send(res, 400, {
        status: false,
        message: "Unsupported payment currency."
      });
    }

    if (
      !Number.isSafeInteger(amount) ||
      !ACTIVATION_PRICES_KOBO.includes(amount)
    ) {
      return send(res, 400, {
        status: false,
        message: "Payment amount does not match an approved activation price."
      });
    }

    if (paymentStatus && paymentStatus !== "success") {
      return send(res, 400, {
        status: false,
        message: "Payment has not been confirmed as successful."
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
      String(item.reference || "").trim() === reference &&
      item.provider === "movantra" &&
      item.method === "paga" &&
      item.activation === true
    );

    if (!payment) {
      console.error(
        "[RIDELESSCHAT] Payment reference not found:",
        reference
      );

      return send(res, 404, {
        status: false,
        message: "Matching Ridelesschat activation payment was not found."
      });
    }

    const storedAmount = Number(payment.amountKobo);

    if (
      !ACTIVATION_PRICES_KOBO.includes(storedAmount) ||
      amount !== storedAmount
    ) {
      return send(res, 400, {
        status: false,
        message: "Payment amount does not match the selected activation amount."
      });
    }

    /* ALREADY APPROVED */

    if (payment.status === "approved") {
      return send(res, 200, {
        status: true,
        approved: true,
        message: "Payment was already processed."
      });
    }

    /* REJECT REPLACED PAYMENT ATTEMPTS */

    if (payment.status === "superseded") {
      return send(res, 409, {
        status: false,
        approved: false,
        message: "This payment has been replaced by a newer selection."
      });
    }

    if (payment.status !== "pending") {
      return send(res, 409, {
        status: false,
        message: "This payment is not awaiting confirmation."
      });
    }

    /*
     * EXTRA PROTECTION:
     * A newer payment for the same registration
     * takes priority over this payment.
     */

    const paymentEmail = normalizeEmail(payment.email);
    const paymentPhone = normalizePhone(payment.phone);

    const newerPaymentExists = payments.some(item => {
      if (
        item.id === payment.id ||
        item.activation !== true ||
        item.provider !== "movantra" ||
        item.method !== "paga"
      ) {
        return false;
      }

      const sameEmail =
        normalizeEmail(item.email) === paymentEmail;

      const samePhone =
        normalizePhone(item.phone) === paymentPhone;

      const isNewer =
        new Date(item.createdAt || 0).getTime() >
        new Date(payment.createdAt || 0).getTime();

      return (
        (sameEmail || samePhone) &&
        isNewer &&
        (
          item.status === "pending" ||
          item.status === "approved"
        )
      );
    });

    if (newerPaymentExists) {
      payment.status = "superseded";
      payment.supersededAt = new Date().toISOString();
      payment.supersededReason = "A newer payment attempt exists";

      await writeJSON(
        PAYMENTS_FILE,
        payments,
        paymentsResult.sha
      );

      return send(res, 409, {
        status: false,
        approved: false,
        message: "This payment has been replaced by a newer selection."
      });
    }

    /* EXPIRY */

    if (
      !payment.activationExpiresAt ||
      new Date(payment.activationExpiresAt).getTime() < Date.now()
    ) {
      payment.status = "expired";

      await writeJSON(
        PAYMENTS_FILE,
        payments,
        paymentsResult.sha
      );

      return send(res, 400, {
        status: false,
        message: "This activation payment has expired."
      });
    }

    if (!payment.passwordHash) {
      throw new Error("Pending payment has no stored password hash.");
    }

    let user = users.find(item => item.paymentId === payment.id);

    if (!user) {
      const existingAccount = users.find(item =>
        normalizeEmail(item.email) === paymentEmail ||
        normalizePhone(item.phone) === paymentPhone
      );

      if (existingAccount) {
        return send(res, 409, {
          status: false,
          message: "An account already exists with these details."
        });
      }

      user = {
        id: "RC-USER-" +
          crypto.randomBytes(8).toString("hex").toUpperCase(),
        fullName: payment.customerName,
        email: paymentEmail,
        phone: payment.phone,
        passwordHash: payment.passwordHash,
        status: "active",
        paymentId: payment.id,
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString()
      };

      users.push(user);

      await writeJSON(
        USERS_FILE,
        users,
        usersResult.sha
      );
    }

    payment.status = "approved";
    payment.processedAt = new Date().toISOString();
    payment.approvalSource = "movantra_webhook";
    payment.passwordHash = null;

    await writeJSON(
      PAYMENTS_FILE,
      payments,
      paymentsResult.sha
    );

    console.log(
      "[RIDELESSCHAT] Activation payment approved:",
      payment.id
    );

    return send(res, 200, {
      status: true,
      approved: true,
      message: "Ridelesschat account activated successfully."
    });

  } catch (error) {
    console.error(
      "[RIDELESSCHAT] Webhook processing error:",
      error.message
    );

    return send(res, 500, {
      status: false,
      message: "Webhook processing failed."
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
          

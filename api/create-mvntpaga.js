
const crypto = require("crypto");
const { readJSON, writeJSON } = require("../lib/github-storage");

const PAYMENTS_FILE = "data/payments.json";
const USERS_FILE = "data/users.json";

const ACTIVATION_PRICES = {
  3700: 370000,
  5200: 520000
};

const ACTIVATION_EXPIRY_MINUTES = 50;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function makeReference() {
  return "rc_" + Date.now() + "_" + crypto.randomBytes(5).toString("hex");
}

function makePaymentId() {
  return "PAY-RIDELESSCHAT-" +
    crypto.randomBytes(8).toString("hex").toUpperCase();
}

function makeStatusToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function send(res, statusCode, data) {
  return res.status(statusCode).json(data);
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
    if (!process.env.MOVANTRA_SECRET_KEY) {
      throw new Error("Payment provider configuration is missing.");
    }

    const body = req.body || {};

    const customerName = String(body.customer_name || "").trim();
    const customerEmail = normalizeEmail(body.customer_email);
    const customerPhone = String(body.customer_phone || "").trim();
    const normalizedPhone = normalizePhone(customerPhone);
    const password = String(body.password || "");

    const selectedAmount = Number(body.amount);
    const selectedAmountKobo = ACTIVATION_PRICES[selectedAmount];

    if (!selectedAmountKobo) {
      return send(res, 400, {
        status: false,
        message: "Please select a valid activation amount."
      });
    }

    if (!customerName || customerName.length < 2) {
      return send(res, 400, {
        status: false,
        message: "Enter your full name."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return send(res, 400, {
        status: false,
        message: "Enter a valid email address."
      });
    }

    if (normalizedPhone.length < 7) {
      return send(res, 400, {
        status: false,
        message: "Enter a valid phone number."
      });
    }

    if (password.length < 6) {
      return send(res, 400, {
        status: false,
        message: "Password must contain at least 6 characters."
      });
    }

    const [usersResult, paymentsResult] = await Promise.all([
      readJSON(USERS_FILE, []),
      readJSON(PAYMENTS_FILE, [])
    ]);

    const users = Array.isArray(usersResult.data)
      ? usersResult.data
      : [];

    const payments = Array.isArray(paymentsResult.data)
      ? paymentsResult.data
      : [];

    const existingUser = users.find(user =>
      normalizeEmail(user.email) === customerEmail ||
      normalizePhone(user.phone) === normalizedPhone
    );

    if (existingUser) {
      return send(res, 409, {
        status: false,
        message: "An account with this email address or phone number already exists. Please log in."
      });
    }

    const reference = makeReference();
    const paymentId = makePaymentId();
    const statusToken = makeStatusToken();
    const passwordHash = hashPassword(password);

    const providerPayload = {
      amount_kobo: selectedAmountKobo,
      customer_name: customerName,
      customer_email: customerEmail,
      reference,
      expiry_minutes: ACTIVATION_EXPIRY_MINUTES
    };

    if (customerPhone) {
      providerPayload.customer_phone = customerPhone;
    }

    if (process.env.PAGA_CALLBACK_URL) {
      providerPayload.callback_url = process.env.PAGA_CALLBACK_URL;
    }

    const providerResponse = await fetch(
      "https://api.movantrapay.com/v1/paga/dynamic-accounts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.MOVANTRA_SECRET_KEY}`
        },
        body: JSON.stringify(providerPayload)
      }
    );

    const providerResult = await providerResponse.json();

    if (
      !providerResponse.ok ||
      providerResult.status !== true ||
      !providerResult.account_number ||
      !providerResult.account_name ||
      !providerResult.bank_name
    ) {
      console.error(
        "[RIDELESSCHAT] Payment account creation failed:",
        providerResult.message || providerResponse.status
      );

      return send(res, 502, {
        status: false,
        message: providerResult.message ||
          "Unable to generate payment account. Please try again."
      });
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + ACTIVATION_EXPIRY_MINUTES * 60 * 1000
    );

    const paymentRecord = {
      id: paymentId,
      customerName,
      email: customerEmail,
      phone: customerPhone,
      passwordHash,
      amount: selectedAmount,
      amountKobo: selectedAmountKobo,
      method: "paga",
      provider: "movantra",
      reference,
      status: "pending",
      statusTokenHash: hashToken(statusToken),
      activation: true,
      createdAt: now.toISOString(),
      processedAt: null,
      activationExpiresAt: expiresAt.toISOString()
    };

    payments.push(paymentRecord);

    await writeJSON(
      PAYMENTS_FILE,
      payments,
      paymentsResult.sha
    );

    return send(res, 200, {
      status: true,
      paymentId,
      statusToken,
      reference,
      account_number: String(providerResult.account_number),
      account_name: providerResult.account_name,
      bank_name: providerResult.bank_name,
      amount: selectedAmount,
      amount_kobo: selectedAmountKobo,
      fee_kobo: providerResult.fee_kobo || 0,
      net_kobo: providerResult.net_kobo || selectedAmountKobo,
      status_text: providerResult.status_text || "Pending payment",
      expires_at: expiresAt.toISOString(),
      mode: "paga"
    });

  } catch (error) {
    console.error(
      "[RIDELESSCHAT] Payment creation error:",
      error.message
    );

    return send(res, 500, {
      status: false,
      message: "Unable to start account activation. Please try again."
    });
  }
};
      

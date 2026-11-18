
const crypto = require("crypto");

const { readJSON, writeJSON } = require("../lib/github-storage");

const SESSIONS_FILE = "data/sessions.json";
const USERS_FILE = "data/users.json";
const WALLETS_FILE = "data/wallets.json";

const WELCOME_BONUS = 95000;
const DAILY_REWARD = 500;

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

function nigeriaDateKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  parts.forEach(part => {
    values[part.type] = part.value;
  });

  return (
    values.year + "-" +
    values.month + "-" +
    values.day
  );
}

function makeTransaction(title, amount) {
  return {
    id: crypto.randomUUID(),
    title,
    amount,
    type: "credit",
    date: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
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

    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return send(res, 401, {
        status: false,
        message: "A valid session is required."
      });
    }

    const action = String(req.body?.action || "").trim();

    if (!["sync", "claim-daily"].includes(action)) {
      return send(res, 400, {
        status: false,
        message: "Invalid reward action."
      });
    }

    const [
      sessionsResult,
      usersResult,
      walletsResult
    ] = await Promise.all([
      readJSON(SESSIONS_FILE, []),
      readJSON(USERS_FILE, []),
      readJSON(WALLETS_FILE, [])
    ]);

    const sessions = Array.isArray(sessionsResult.data)
      ? sessionsResult.data
      : [];

    const users = Array.isArray(usersResult.data)
      ? usersResult.data
      : [];

    const wallets = Array.isArray(walletsResult.data)
      ? walletsResult.data
      : [];

    const tokenHash = hashToken(token);
    const now = Date.now();

    const session = sessions.find(item =>
      safeCompare(item.tokenHash, tokenHash) &&
      new Date(item.expiresAt).getTime() > now
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

    if (!user || !user.paymentId) {
      return send(res, 403, {
        status: false,
        message: "An activated Ridelesschat account is required."
      });
    }

    let wallet = wallets.find(item =>
      item.userId === user.id
    );

    if (!wallet) {
      wallet = {
        userId: user.id,
        balance: 0,
        transactions: [],
        welcomeBonusCreditedAt: null,
        dailyClaims: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      wallets.push(wallet);
    }

    if (!Number.isFinite(Number(wallet.balance))) {
      wallet.balance = 0;
    }

    if (!Array.isArray(wallet.transactions)) {
      wallet.transactions = [];
    }

    if (!Array.isArray(wallet.dailyClaims)) {
      wallet.dailyClaims = [];
    }

    let changed = false;
    let dailyClaimedNow = false;

    /*
     * FIRST ACTIVATION WELCOME BONUS
     *
     * This flag is stored permanently in the
     * server-side wallet record.
     */

    if (!wallet.welcomeBonusCreditedAt) {
      wallet.balance += WELCOME_BONUS;

      wallet.welcomeBonusCreditedAt = new Date().toISOString();

      wallet.transactions.unshift(
        makeTransaction("Welcome Bonus", WELCOME_BONUS)
      );

      changed = true;
    }

    /*
     * DAILY CLAIM
     *
     * One claim per Nigeria calendar day.
     */

    if (action === "claim-daily") {
      const today = nigeriaDateKey();

      const alreadyClaimed = wallet.dailyClaims.some(
        claim => claim.date === today
      );

      if (!alreadyClaimed) {
        wallet.balance += DAILY_REWARD;

        wallet.dailyClaims.push({
          date: today,
          claimedAt: new Date().toISOString(),
          amount: DAILY_REWARD
        });

        wallet.transactions.unshift(
          makeTransaction("Daily Check-In", DAILY_REWARD)
        );

        changed = true;
        dailyClaimedNow = true;
      }
    }

    wallet.updatedAt = new Date().toISOString();

    /*
     * Save the wallet and its transaction history
     * together in one GitHub JSON write.
     */

    if (changed) {
      await writeJSON(
        WALLETS_FILE,
        wallets,
        walletsResult.sha
      );
    }

    const today = nigeriaDateKey();

    const dailyClaimed = wallet.dailyClaims.some(
      claim => claim.date === today
    );

    return send(res, 200, {
      status: true,
      action,
      balance: Number(wallet.balance),
      welcomeBonusCredited: Boolean(wallet.welcomeBonusCreditedAt),
      dailyClaimed,
      dailyClaimedNow,
      dailyReward: DAILY_REWARD,
      welcomeBonus: WELCOME_BONUS,
      transactions: wallet.transactions.slice(0, 50)
    });

  } catch (error) {
    console.error(
      "[RIDELESSCHAT REWARDS]",
      error.message
    );

    if (error.message && error.message.includes("(409)")) {
      return send(res, 409, {
        status: false,
        conflict: true,
        message: "Another wallet update occurred. Please refresh and try again."
      });
    }

    return send(res, 500, {
      status: false,
      message: "Unable to process your reward request."
    });
  }
};
      


const crypto = require("crypto");
const { readJSON, writeJSON } = require("../lib/github-storage");

const SESSIONS_FILE = "data/sessions.json";
const USERS_FILE = "data/users.json";
const WALLETS_FILE = "data/wallets.json";

const DAILY_REWARD = 500;
const READ_REWARD = 1500;

const READ_ARTICLE_IDS = [
  "digital-skills",
  "saving-money",
  "healthy-routines",
  "online-safety"
];

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(a),
    Buffer.from(b)
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

  return `${values.year}-${values.month}-${values.day}`;
}

function makeTransaction(title, amount) {
  return {
    id: crypto.randomBytes(12).toString("hex"),
    title,
    amount,
    date: new Date().toISOString(),
    type: "credit"
  };
}

function getTodayReadClaims(wallet, today) {
  return (Array.isArray(wallet.readClaims) ? wallet.readClaims : [])
    .filter(claim => claim.date === today)
    .map(claim => claim.articleId);
}

function isWriteConflict(error) {
  return /GitHub write failed \(409\)/i.test(
    String(error && error.message || error)
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  try {
    const action = String(req.body?.action || "").trim();

    if (!["sync", "claim-daily", "claim-read"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid wallet action."
      });
    }

    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(401).json({
        success: false,
        message: "Your session is invalid. Please log in again."
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

    const session = sessions.find(item =>
      safeCompare(item.tokenHash, hashToken(token)) &&
      new Date(item.expiresAt).getTime() > Date.now()
    );

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please log in again."
      });
    }

    const user = users.find(item =>
      item.id === session.userId &&
      item.status === "active"
    );

    if (!user || !user.paymentId) {
      return res.status(403).json({
        success: false,
        message: "Your account is not active."
      });
    }

    const today = nigeriaDateKey();

    let articleId = "";

    if (action === "claim-read") {
      articleId = String(req.body?.articleId || "").trim();

      if (!READ_ARTICLE_IDS.includes(articleId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Read & Earn article."
        });
      }
    }

    // Sync does not write to GitHub.
    if (action === "sync") {
      const walletsResult = await readJSON(WALLETS_FILE, []);
      const wallets = Array.isArray(walletsResult.data)
        ? walletsResult.data
        : [];

      const wallet = wallets.find(item => item.userId === user.id) || {
        userId: user.id,
        balance: 0,
        transactions: [],
        dailyClaims: [],
        readClaims: []
      };

      const dailyClaims = Array.isArray(wallet.dailyClaims)
        ? wallet.dailyClaims
        : [];

      return res.status(200).json({
        success: true,
        balance: Number(wallet.balance) || 0,
        dailyClaimed: dailyClaims.some(claim => claim.date === today),
        dailyClaimedNow: false,
        dailyReward: DAILY_REWARD,
        readClaimsToday: getTodayReadClaims(wallet, today),
        readReward: READ_REWARD,
        transactions: Array.isArray(wallet.transactions)
          ? wallet.transactions.slice(0, 50)
          : []
      });
    }

    // Retry GitHub SHA conflicts so simultaneous wallet requests
    // do not overwrite each other's successful changes.
    for (let attempt = 0; attempt < 4; attempt++) {
      const walletsResult = await readJSON(WALLETS_FILE, []);
      const wallets = Array.isArray(walletsResult.data)
        ? walletsResult.data
        : [];

      let wallet = wallets.find(item => item.userId === user.id);

      if (!wallet) {
        wallet = {
          userId: user.id,
          balance: 0,
          transactions: [],
          dailyClaims: [],
          readClaims: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        wallets.push(wallet);
      }

      wallet.balance = Number(wallet.balance) || 0;

      if (!Array.isArray(wallet.transactions)) {
        wallet.transactions = [];
      }

      if (!Array.isArray(wallet.dailyClaims)) {
        wallet.dailyClaims = [];
      }

      if (!Array.isArray(wallet.readClaims)) {
        wallet.readClaims = [];
      }

      let rewardClaimedNow = false;
      let alreadyClaimed = false;

      if (action === "claim-daily") {
        alreadyClaimed = wallet.dailyClaims.some(
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

          rewardClaimedNow = true;
        }
      }

      if (action === "claim-read") {
        alreadyClaimed = wallet.readClaims.some(
          claim =>
            claim.date === today &&
            claim.articleId === articleId
        );

        if (!alreadyClaimed) {
          wallet.balance += READ_REWARD;

          wallet.readClaims.push({
            date: today,
            articleId,
            claimedAt: new Date().toISOString(),
            amount: READ_REWARD
          });

          wallet.transactions.unshift(
            makeTransaction("Read & Earn Reward", READ_REWARD)
          );

          rewardClaimedNow = true;
        }
      }

      if (!rewardClaimedNow) {
        return res.status(200).json({
          success: true,
          balance: wallet.balance,
          dailyClaimed: wallet.dailyClaims.some(
            claim => claim.date === today
          ),
          dailyClaimedNow: false,
          dailyReward: DAILY_REWARD,
          readClaimsToday: getTodayReadClaims(wallet, today),
          readReward: READ_REWARD,
          readClaimedNow: false,
          alreadyClaimed,
          transactions: wallet.transactions.slice(0, 50)
        });
      }

      wallet.updatedAt = new Date().toISOString();

      try {
        await writeJSON(
          WALLETS_FILE,
          wallets,
          walletsResult.sha
        );

        return res.status(200).json({
          success: true,
          balance: wallet.balance,
          dailyClaimed: wallet.dailyClaims.some(
            claim => claim.date === today
          ),
          dailyClaimedNow:
            action === "claim-daily" && rewardClaimedNow,
          dailyReward: DAILY_REWARD,
          readClaimsToday: getTodayReadClaims(wallet, today),
          readReward: READ_REWARD,
          readClaimedNow:
            action === "claim-read" && rewardClaimedNow,
          alreadyClaimed: false,
          transactions: wallet.transactions.slice(0, 50)
        });

      } catch (error) {
        if (isWriteConflict(error) && attempt < 3) {
          continue;
        }

        throw error;
      }
    }

    return res.status(409).json({
      success: false,
      message: "Your wallet was updated elsewhere. Please try again."
    });

  } catch (error) {
    console.error("[RIDELESSCHAT REWARDS]", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update your wallet right now."
    });
  }
};

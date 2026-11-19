
(function () {
"use strict";

const dashboard = document.getElementById("rideless-dashboard");
if (!dashboard || dashboard.dataset.jsInitialized === "true") return;
dashboard.dataset.jsInitialized = "true";

/* ELEMENTS */
const auth = document.getElementById("rideless-auth");
const toast = document.getElementById("rc-dashboard-toast");
const toastMessage = document.getElementById("rc-toast-message");
const balanceAmount = document.getElementById("rc-balance-amount");
const balanceEye = document.getElementById("rc-balance-eye");
const themeButton = document.getElementById("rc-theme-toggle");
const checkinButton = document.getElementById("rc-checkin-btn");
const checkinStatus = document.getElementById("rc-checkin-status");
const transactionList = document.getElementById("rc-transaction-list");
const transactionEmpty = document.getElementById("rc-transaction-empty");
const notificationButton = document.getElementById("rc-notification-btn");
const upgradePercent = document.getElementById("rc-upgrade-percent");
const upgradeProgress = dashboard.querySelector(".rc-upgrade-progress");

/* CONFIGURATION */
const SESSION_KEY = "ridelesschat_session";
const API_URL = "https://rideless-jenny-two.vercel.app/api/rewards";
const UPGRADE_TARGET = 300000;

/* SESSION */
let currentSession = null;
let currentUser = null;

function getAuthenticatedSession() {
try {
const raw = sessionStorage.getItem(SESSION_KEY);
if (!raw) return null;

const session = JSON.parse(raw);

if (
!session ||
typeof session.token !== "string" ||
!session.token ||
!session.expiresAt ||
!session.user ||
!session.user.id
) return null;

const expiry = new Date(session.expiresAt).getTime();

if (!Number.isFinite(expiry) || expiry <= Date.now()) {
sessionStorage.removeItem(SESSION_KEY);
return null;
}

return session;
} catch (error) {
console.error("[RIDELESSCHAT] Session read failed:", error);
return null;
}
}

/* STATE */
let balance = 0;
let transactions = [];
let balanceHidden = false;
let toastTimer = null;
let dateCheckTimer = null;
let dailyClaimed = false;
let dailyClaimLoading = false;
let walletLoading = false;
let walletLoaded = false;
let lastNigeriaDate = "";

/* DATE AND CURRENCY */
function nigeriaDateKey() {
const parts = new Intl.DateTimeFormat("en-GB", {
timeZone: "Africa/Lagos",
year: "numeric",
month: "2-digit",
day: "2-digit"
}).formatToParts(new Date());

const values = {};
parts.forEach(part => values[part.type] = part.value);

return values.year + "-" + values.month + "-" + values.day;
}

function formatDate(date) {
return new Intl.DateTimeFormat("en-NG", {
day: "numeric",
month: "short",
year: "numeric",
hour: "2-digit",
minute: "2-digit",
hour12: true
}).format(date);
}

function formatMoney(amount) {
return "₦" + Number(amount).toLocaleString("en-NG", {
minimumFractionDigits: 2,
maximumFractionDigits: 2
});
}

/* TOAST */
function showToast(message, duration) {
if (!toast || !toastMessage) return;

clearTimeout(toastTimer);
toastMessage.textContent = message;
toast.classList.add("is-visible");

toastTimer = setTimeout(function () {
toast.classList.remove("is-visible");
}, duration || 2400);
}

/* UPGRADE EARNINGS PROGRESS */
function getTotalEarned() {
return transactions.reduce(function (total, item) {
const amount = Number(item.amount) || 0;
return total + (amount > 0 ? amount : 0);
}, 0);
}

function updateUpgradeProgress() {
const earned = getTotalEarned();
const percentage = Math.min(
100,
Math.max(0, (earned / UPGRADE_TARGET) * 100)
);

const roundedPercentage = Math.floor(percentage);

if (upgradePercent) {
upgradePercent.textContent = roundedPercentage + "%";
}

if (upgradeProgress) {
upgradeProgress.style.strokeDasharray = "100";
upgradeProgress.style.strokeDashoffset = String(100 - percentage);
}

const upgradeButton = dashboard.querySelector(
'[data-dashboard-action="upgrade"]'
);

if (upgradeButton) {
upgradeButton.setAttribute(
"aria-label",
"Upgrade Account. " + roundedPercentage + "% progress. Total earnings: " + formatMoney(earned)
);
}
}

/* WALLET DISPLAY */
function updateBalanceDisplay() {
if (!balanceAmount) return;

balanceAmount.textContent = balanceHidden
? "₦••••••"
: formatMoney(balance);
}

function updateWalletData(data) {
balance = Number(data.balance) || 0;

transactions = Array.isArray(data.transactions)
? data.transactions
: [];

dailyClaimed = data.dailyClaimed === true;

updateBalanceDisplay();
renderTransactions();
updateDailyCheckin();
updateUpgradeProgress();
}

function updateDailyCheckin() {
if (!checkinButton) return;

checkinButton.disabled =
dailyClaimed || dailyClaimLoading || walletLoading;

checkinButton.classList.toggle("is-loading", dailyClaimLoading);

const label = checkinButton.querySelector(".rc-checkin-label");

if (label) {
label.textContent = dailyClaimLoading
? "Claiming..."
: dailyClaimed ? "Claimed" : "Claim Now";
}

if (checkinStatus) {
checkinStatus.textContent = dailyClaimed
? "You've claimed today's reward."
: "";
}
}

/* SERVER WALLET */
async function requestWallet(action) {
if (!currentSession || !currentSession.token) {
throw new Error("Your session is unavailable. Please sign in again.");
}

const response = await fetch(API_URL, {
method: "POST",
headers: {
"Content-Type": "application/json",
"Authorization": "Bearer " + currentSession.token
},
body: JSON.stringify({ action: action }),
cache: "no-store"
});

let result;

try {
result = await response.json();
} catch (error) {
throw new Error("The server returned an invalid response.");
}

if (!response.ok || !result.status) {
const error = new Error(result.message || "Unable to load your wallet.");
error.conflict = result.conflict === true || response.status === 409;
throw error;
}

return result;
}

async function syncWallet(action) {
let lastError = null;

for (let attempt = 0; attempt < 2; attempt++) {
try {
const result = await requestWallet(action || "sync");
updateWalletData(result);
return result;
} catch (error) {
lastError = error;
if (!error.conflict || attempt === 1) break;
}
}

throw lastError || new Error("Wallet synchronization failed.");
}

async function refreshWallet() {
if (!currentSession || walletLoading) return;

walletLoading = true;
updateDailyCheckin();

try {
await syncWallet("sync");
} catch (error) {
console.error("[RIDELESSCHAT] Wallet refresh failed:", error);
} finally {
walletLoading = false;
updateDailyCheckin();
}

window.dispatchEvent(new CustomEvent("ridelesschat:wallet-updated", {
detail: {
balance: balance,
dailyClaimed: dailyClaimed
}
}));
}

/* TRANSACTIONS */
function renderTransactions() {
if (!transactionList) return;

transactionList.innerHTML = "";

if (!transactions.length) {
if (transactionEmpty) {
transactionList.appendChild(transactionEmpty);
transactionEmpty.style.display = "flex";
}
return;
}

transactions.slice(0, 5).forEach(function (item) {
const row = document.createElement("div");
row.className = "rc-transaction-item";

const icon = document.createElement("div");
icon.className = "rc-transaction-icon";
icon.innerHTML = `
<svg viewBox="0 0 24 24" aria-hidden="true">
<path d="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7"/>
</svg>`;

const info = document.createElement("div");
info.className = "rc-transaction-info";

const title = document.createElement("h4");
title.textContent = item.title || "Transaction";

const date = document.createElement("p");
const parsedDate = new Date(item.date);

date.textContent = Number.isNaN(parsedDate.getTime())
? ""
: formatDate(parsedDate);

info.appendChild(title);
info.appendChild(date);

const amount = document.createElement("div");
amount.className = "rc-transaction-amount";

const value = Number(item.amount) || 0;
amount.textContent =
(value < 0 ? "-" : "+") + formatMoney(Math.abs(value));

row.appendChild(icon);
row.appendChild(info);
row.appendChild(amount);
transactionList.appendChild(row);
});
}

/* LOCAL READ & EARN COMPATIBILITY */
function creditBalance(amount, title) {
amount = Number(amount) || 0;
if (amount <= 0) return;

balance += amount;

transactions.unshift({
id: Date.now() + Math.random(),
title: title || "Reward",
amount: amount,
date: new Date().toISOString(),
type: "credit"
});

updateBalanceDisplay();
renderTransactions();
updateUpgradeProgress();
}

window.addEventListener("ridelesschat:reward-earned", function (event) {
const detail = event.detail || {};
const amount = Number(detail.amount) || 0;

if (amount <= 0) return;

creditBalance(amount, detail.title || "Read & Earn Reward");
});

/* LOAD USER DATA */
async function loadUserData(user) {
currentUser = {
id: user.id,
name: user.name || "",
email: user.email || "",
phone: user.phone || ""
};

balance = 0;
transactions = [];
dailyClaimed = false;
walletLoaded = false;
walletLoading = true;

updateBalanceDisplay();
renderTransactions();
updateDailyCheckin();
updateUpgradeProgress();

try {
await syncWallet("sync");
lastNigeriaDate = nigeriaDateKey();

console.log("[RIDELESSCHAT] Server wallet loaded.");
} catch (error) {
console.error("[RIDELESSCHAT] Initial wallet loading failed:", error);
showToast("Unable to load your wallet. Please try again.", 3000);
} finally {
walletLoading = false;
walletLoaded = true;
updateDailyCheckin();
}

window.dispatchEvent(new CustomEvent("ridelesschat:user-loaded", {
detail: { user: currentUser }
}));

window.dispatchEvent(new CustomEvent("ridelesschat:wallet-updated", {
detail: {
balance: balance,
dailyClaimed: dailyClaimed
}
}));
}

/* OPEN DASHBOARD */
async function openDashboard() {
const session = getAuthenticatedSession();

if (!session) {
console.error("[RIDELESSCHAT] Dashboard opening failed: no valid authenticated session.");

dashboard.hidden = true;
dashboard.style.display = "none";

if (auth) {
auth.hidden = false;
auth.style.display = "";
}

return;
}

currentSession = session;
walletLoaded = false;

dashboard.hidden = false;
dashboard.style.display = "block";

if (auth) {
auth.hidden = true;
auth.style.display = "none";
}

window.scrollTo({ top: 0, behavior: "instant" });
window.__ridelessPendingDashboardUser = null;

await loadUserData(session.user);

console.log("[RIDELESSCHAT] Authenticated dashboard opened.");
}

window.addEventListener("ridelesschat:dashboard-open", openDashboard);

/* BALANCE EYE */
if (balanceEye) {
balanceEye.addEventListener("click", function () {
balanceHidden = !balanceHidden;
balanceEye.classList.toggle("is-hidden", balanceHidden);

balanceEye.setAttribute(
"aria-label",
balanceHidden ? "Show balance" : "Hide balance"
);

updateBalanceDisplay();
});
}

/* THEME */
function applyTheme(theme) {
const selectedTheme = theme === "light" ? "light" : "dark";
dashboard.dataset.theme = selectedTheme;

if (themeButton) {
themeButton.setAttribute(
"aria-label",
selectedTheme === "dark"
? "Switch to light theme"
: "Switch to dark theme"
);
}

try {
localStorage.setItem("ridelesschat_theme", selectedTheme);
} catch (error) {}
}

let savedTheme = "dark";

try {
savedTheme = localStorage.getItem("ridelesschat_theme") || "dark";
} catch (error) {}

applyTheme(savedTheme);

if (themeButton) {
themeButton.addEventListener("click", function () {
applyTheme(
dashboard.dataset.theme === "dark" ? "light" : "dark"
);
});
}

/* DAILY CLAIM */
if (checkinButton) {
checkinButton.addEventListener("click", async function () {
if (dailyClaimed || dailyClaimLoading || walletLoading) return;

dailyClaimLoading = true;
updateDailyCheckin();

try {
const result = await syncWallet("claim-daily");

showToast(
result.dailyClaimedNow
? "Daily reward of ₦500 credited!"
: "You've already claimed today's reward.",
2600
);

lastNigeriaDate = nigeriaDateKey();
} catch (error) {
console.error("[RIDELESSCHAT] Daily claim failed:", error);
showToast(error.message || "Unable to claim your daily reward.", 3000);
} finally {
dailyClaimLoading = false;
updateDailyCheckin();

window.dispatchEvent(new CustomEvent("ridelesschat:wallet-updated", {
detail: {
balance: balance,
dailyClaimed: dailyClaimed
}
}));
}
});
}

/* NIGERIA MIDNIGHT REFRESH */
function checkNigeriaDate() {
const today = nigeriaDateKey();

if (today !== lastNigeriaDate) {
lastNigeriaDate = today;
refreshWallet();
}
}

clearInterval(dateCheckTimer);

dateCheckTimer = setInterval(function () {
if (!document.hidden && currentSession) checkNigeriaDate();
}, 30000);

document.addEventListener("visibilitychange", function () {
if (!document.hidden && currentSession) {
checkNigeriaDate();
refreshWallet();
}
});

/* DASHBOARD BUTTONS */
const comingSoonButtons = dashboard.querySelectorAll("[data-dashboard-action]");

comingSoonButtons.forEach(function (button) {
button.addEventListener("click", function () {
const action = button.dataset.dashboardAction;

const messages = {
read: "Read & Earn is coming soon.",
upgrade: "Account upgrades are coming soon.",
share: "Share Posts is coming soon.",
chat: "Chat is coming soon.",
support: "Support is coming soon."
};

showToast(messages[action] || "Coming soon.");
});
});

/* HEADER AND TRANSACTION BUTTONS */
if (notificationButton) {
notificationButton.addEventListener("click", function () {
showToast("You're all caught up.");
});
}

const withdrawButton = document.getElementById("rc-withdraw-btn");

if (withdrawButton) {
withdrawButton.addEventListener("click", function () {
showToast("Withdrawal is coming soon.");
});
}

const seeAllButton = document.getElementById("rc-see-all-transactions");

if (seeAllButton) {
seeAllButton.addEventListener("click", function () {
showToast("Full transaction history is coming soon.");
});
}

/* SHARED DASHBOARD API */
window.RidelessDashboard = {
getCurrentUser: function () {
return currentUser;
},

getSession: function () {
return getAuthenticatedSession();
},

getStorage: function (key, fallback) {
try {
const value = sessionStorage.getItem(key);
return value === null ? fallback : JSON.parse(value);
} catch (error) {
return fallback;
}
},

setStorage: function (key, value) {
try {
sessionStorage.setItem(key, JSON.stringify(value));
} catch (error) {}
},

userKey: function () {
if (!currentUser) return "guest";

return String(
currentUser.id || currentUser.email || currentUser.phone || "guest"
).replace(/[^a-z0-9]/gi, "_");
},

formatMoney: formatMoney,
showToast: showToast,
creditBalance: creditBalance,

getBalance: function () {
return balance;
},

getTotalEarned: getTotalEarned,

getUpgradeProgress: function () {
return Math.min(100, (getTotalEarned() / UPGRADE_TARGET) * 100);
},

refreshWallet: refreshWallet
};

/* RESTORE EXISTING SESSION */
const existingSession = getAuthenticatedSession();

if (existingSession) openDashboard();

})();

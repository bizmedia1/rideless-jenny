

(function () {
"use strict";

const dashboard = document.getElementById("rideless-dashboard");
if (!dashboard || dashboard.dataset.jsInitialized === "true") return;
dashboard.dataset.jsInitialized = "true";

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

const SESSION_KEY = "ridelesschat_session";
const UPGRADE_TARGET = 300000;
const LEGACY_USER_ID = "RC-USER-57F7EFEB02C52324";
const LEGACY_BALANCE = 96000;

let currentSession = null;
let currentUser = null;
let balance = 0;
let transactions = [];
let balanceHidden = false;
let toastTimer = null;
let dailyClaimLoading = false;
let walletLoaded = false;
let dailyClaimed = false;
let lastNigeriaDate = "";

function nigeriaDateKey() {
const parts = new Intl.DateTimeFormat("en-GB", {
timeZone: "Africa/Lagos",
year: "numeric",
month: "2-digit",
day: "2-digit"
}).formatToParts(new Date());
const values = {};
parts.forEach(p => values[p.type] = p.value);
return values.year + "-" + values.month + "-" + values.day;
}

function formatDate(date) {
return new Intl.DateTimeFormat("en-NG", {
day: "numeric", month: "short", year: "numeric",
hour: "2-digit", minute: "2-digit", hour12: true
}).format(date);
}

function formatMoney(amount) {
return "₦" + Number(amount || 0).toLocaleString("en-NG", {
minimumFractionDigits: 2,
maximumFractionDigits: 2
});
}

function userKey(user) {
user = user || currentUser || {};
return String(user.id || user.email || user.phone || "guest")
.replace(/[^a-z0-9]/gi, "_");
}

function walletStorageKey(user) {
return "ridelesschat_local_wallet_" + userKey(user);
}

function showToast(message, duration) {
if (!toast || !toastMessage) return;
clearTimeout(toastTimer);
toastMessage.textContent = message;
toast.classList.add("is-visible");
toastTimer = setTimeout(() => toast.classList.remove("is-visible"), duration || 2400);
}

function saveWallet() {
if (!currentUser) return;
try {
localStorage.setItem(walletStorageKey(), JSON.stringify({
balance: balance,
transactions: transactions,
dailyClaimDate: localStorage.getItem("ridelesschat_daily_" + userKey()),
readClaims: getReadClaims()
}));
} catch (error) {
console.error("[RIDELESSCHAT] Local wallet save failed:", error);
}
}

function getReadClaims() {
try {
return JSON.parse(localStorage.getItem(
"ridelesschat_read_claims_" + userKey()
) || "{}");
} catch (error) {
return {};
}

}

function getReadClaimsToday() {
const claims = getReadClaims();
return Array.isArray(claims[nigeriaDateKey()])
? claims[nigeriaDateKey()]
: [];
}

function loadWallet() {
let saved = null;
try {
saved = JSON.parse(localStorage.getItem(walletStorageKey()) || "null");
} catch (error) {}

if (saved && typeof saved === "object") {
balance = Math.max(0, Number(saved.balance) || 0);
transactions = Array.isArray(saved.transactions) ? saved.transactions : [];
} else {
balance = currentUser && currentUser.id === LEGACY_USER_ID
? LEGACY_BALANCE
: 0;

transactions = balance > 0 ? [{
id: "legacy-wallet-carryover",
title: "Existing Wallet Balance",
amount: balance,
date: new Date().toISOString(),
type: "credit"
}] : [];

saveWallet();
}

dailyClaimed =
localStorage.getItem("ridelesschat_daily_" + userKey()) === nigeriaDateKey();

walletLoaded = true;
updateWalletDisplay();
}

function getTotalEarned() {
return transactions.reduce((total, item) => {
const amount = Number(item.amount) || 0;
return total + (amount > 0 ? amount : 0);
}, 0);
}

function updateUpgradeProgress() {
const earned = getTotalEarned();
const percentage = Math.min(100, Math.max(0, earned / UPGRADE_TARGET * 100));
const rounded = Math.floor(percentage);

if (upgradePercent) upgradePercent.textContent = rounded + "%";
if (upgradeProgress) {
upgradeProgress.style.strokeDasharray = "100";
upgradeProgress.style.strokeDashoffset = String(100 - percentage);
}

const button = dashboard.querySelector('[data-dashboard-action="upgrade"]');
if (button) {
button.setAttribute("aria-label",
"Upgrade Account. " + rounded + "% progress. Total earnings: " + formatMoney(earned));
}
}

function updateBalanceDisplay() {
if (balanceAmount) {
balanceAmount.textContent = balanceHidden ? "₦••••••" : formatMoney(balance);
}
}

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

transactions.slice(0, 5).forEach(item => {
const row = document.createElement("div");
row.className = "rc-transaction-item";

const icon = document.createElement("div");
icon.className = "rc-transaction-icon";
icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7"/></svg>';

const info = document.createElement("div");
info.className = "rc-transaction-info";

const title = document.createElement("h4");
title.textContent = item.title || "Transaction";

const date = document.createElement("p");
const parsed = new Date(item.date);
date.textContent = Number.isNaN(parsed.getTime()) ? "" : formatDate(parsed);

info.appendChild(title);
info.appendChild(date);

const amount = document.createElement("div");
amount.className = "rc-transaction-amount";
const value = Number(item.amount) || 0;
amount.textContent = (value < 0 ? "-" : "+") + formatMoney(Math.abs(value));

row.append(icon, info, amount);
transactionList.appendChild(row);
});
}

function updateDailyCheckin() {
if (!checkinButton) return;
checkinButton.disabled = dailyClaimed || dailyClaimLoading;
checkinButton.classList.toggle("is-loading", dailyClaimLoading);

const label = checkinButton.querySelector(".rc-checkin-label");
if (label) {
label.textContent = dailyClaimLoading ? "Claiming..." :
dailyClaimed ? "Claimed" : "Claim Now";
}
if (checkinStatus) {
checkinStatus.textContent = dailyClaimed
? "You've claimed today's reward." : "";
}
}

function updateWalletDisplay() {
updateBalanceDisplay();
renderTransactions();
updateDailyCheckin();
updateUpgradeProgress();
}

function addCredit(amount, title, id) {
amount = Number(amount) || 0;
if (amount <= 0 || !currentUser) return false;

if (id && transactions.some(item => item.id === id)) return false;

balance += amount;
transactions.unshift({
id: id || ("local-" + Date.now() + "-" + Math.random().toString(16).slice(2)),
title: title || "Reward",
amount: amount,
date: new Date().toISOString(),
type: "credit"
});

saveWallet();
updateWalletDisplay();

window.dispatchEvent(new CustomEvent("ridelesschat:wallet-updated", {
detail: { balance, dailyClaimed }
}));
return true;
}

function claimDailyReward() {
if (!currentUser || dailyClaimed || dailyClaimLoading) return;
dailyClaimLoading = true;
updateDailyCheckin();

try {
const today = nigeriaDateKey();
localStorage.setItem("ridelesschat_daily_" + userKey(), today);
dailyClaimed = true;
addCredit(500, "Daily Check-In", "daily-" + userKey() + "-" + today);
showToast("Daily reward of ₦500 credited!");
} catch (error) {
showToast("Unable to save your reward on this browser.");
} finally {
dailyClaimLoading = false;
updateDailyCheckin();
}
}

function claimReadReward(articleId) {
if (!currentUser || !articleId) return { success: false };

const today = nigeriaDateKey();
const claims = getReadClaims();
const todayClaims = Array.isArray(claims[today]) ? claims[today] : [];

if (todayClaims.includes(articleId)) {
return {
success: true,
alreadyClaimed: true,
readClaimsToday: todayClaims
};
}

todayClaims.push(articleId);
claims[today] = todayClaims;

try {
localStorage.setItem(
"ridelesschat_read_claims_" + userKey(),
JSON.stringify(claims)
);
} catch (error) {
return { success: false };
}

const credited = addCredit(
1500,
"Read & Earn Reward",
"read-" + userKey() + "-" + today + "-" + articleId
);

return {
success: credited,
readClaimedNow: credited,
alreadyClaimed: !credited,
readClaimsToday: todayClaims
};
}

function getAuthenticatedSession() {
try {
let raw = localStorage.getItem(SESSION_KEY);
if (!raw) raw = sessionStorage.getItem(SESSION_KEY);
if (!raw) return null;

const session = JSON.parse(raw);
if (!session || typeof session.token !== "string" ||
!session.token || !session.expiresAt || !session.user ||
!session.user.id) return null;

const expiry = new Date(session.expiresAt).getTime();
if (!Number.isFinite(expiry) || expiry <= Date.now()) {
localStorage.removeItem(SESSION_KEY);
sessionStorage.removeItem(SESSION_KEY);
return null;
}

localStorage.setItem(SESSION_KEY, JSON.stringify(session));
return session;
} catch (error) {
return null;
}
}

function loadUserData(user) {
currentUser = {
id: user.id,
name: user.name || "",
email: user.email || "",
phone: user.phone || ""
};

loadWallet();
lastNigeriaDate = nigeriaDateKey();

window.dispatchEvent(new CustomEvent("ridelesschat:user-loaded", {
detail: { user: currentUser }
}));
window.dispatchEvent(new CustomEvent("ridelesschat:wallet-updated", {
detail: { balance, dailyClaimed }
}));
}

function openDashboard() {
const session = getAuthenticatedSession();

if (!session) {
dashboard.hidden = true;
dashboard.style.display = "none";
if (auth) {
auth.hidden = false;
auth.style.display = "";
}
return;
}

currentSession = session;
dashboard.hidden = false;
dashboard.style.display = "block";

if (auth) {
auth.hidden = true;
auth.style.display = "none";
}

window.scrollTo({ top: 0, behavior: "instant" });
loadUserData(session.user);
}

window.addEventListener("ridelesschat:dashboard-open", openDashboard);
  /* RECEIVE CHAT REWARDS */

window.addEventListener("ridelesschat:reward-earned", function (event) {
  const detail = event.detail || {};
  const amount = Number(detail.amount) || 0;

  if (amount <= 0) return;

  addCredit(
    amount,
    detail.title || "Chat & Earn Reward"
  );
});

if (balanceEye) {
balanceEye.addEventListener("click", function () {
balanceHidden = !balanceHidden;
balanceEye.classList.toggle("is-hidden", balanceHidden);
balanceEye.setAttribute("aria-label", balanceHidden ? "Show balance" : "Hide balance");
updateBalanceDisplay();
});
}

function applyTheme(theme) {
const selected = theme === "light" ? "light" : "dark";
dashboard.dataset.theme = selected;
if (themeButton) {
themeButton.setAttribute("aria-label",
selected === "dark" ? "Switch to light theme" : "Switch to dark theme");
}
try { localStorage.setItem("ridelesschat_theme", selected); } catch (error) {}
}

let savedTheme = "dark";
try { savedTheme = localStorage.getItem("ridelesschat_theme") || "dark"; } catch (error) {}
applyTheme(savedTheme);

if (themeButton) {
themeButton.addEventListener("click", () => {
applyTheme(dashboard.dataset.theme === "dark" ? "light" : "dark");
});
}

if (checkinButton) {
checkinButton.addEventListener("click", claimDailyReward);
}

function checkNigeriaDate() {
const today = nigeriaDateKey();
if (today !== lastNigeriaDate) {
lastNigeriaDate = today;
dailyClaimed =
localStorage.getItem("ridelesschat_daily_" + userKey()) === today;
updateDailyCheckin();
}
}

setInterval(function () {
if (!document.hidden && currentUser) checkNigeriaDate();
}, 30000);

document.addEventListener("visibilitychange", function () {
if (!document.hidden && currentUser) checkNigeriaDate();
});

dashboard.querySelectorAll("[data-dashboard-action]").forEach(button => {
button.addEventListener("click", function () {
const action = button.dataset.dashboardAction;
const messages = {
read: "Open Read & Earn to start earning rewards.",
upgrade: "Account upgrades are coming soon.",
share: "Share Posts is coming soon.",
chat: "Chat is coming soon.",
support: "Support is coming soon."
};
if (action === "read" && window.RidelessReadPage) {
window.RidelessReadPage.openReadPage();
return;
}
showToast(messages[action] || "Coming soon.");
});
});

if (notificationButton) {
notificationButton.addEventListener("click", () => showToast("You're all caught up."));
}

const withdrawButton = document.getElementById("rc-withdraw-btn");
if (withdrawButton) {
withdrawButton.addEventListener("click", () => showToast("Withdrawal is coming soon."));
}

const seeAllButton = document.getElementById("rc-see-all-transactions");
if (seeAllButton) {
seeAllButton.addEventListener("click", () => showToast("Full transaction history is coming soon."));
}

window.RidelessDashboard = {
getCurrentUser: () => currentUser,
getSession: getAuthenticatedSession,
getStorage: function (key, fallback) {
try {
const value = localStorage.getItem(key);
return value === null ? fallback : JSON.parse(value);
} catch (error) { return fallback; }
},
setStorage: function (key, value) {
try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) {}
},
userKey: () => userKey(),
formatMoney,
showToast,
creditBalance: addCredit,
getBalance: () => balance,
getTotalEarned,
getUpgradeProgress: () => Math.min(100, getTotalEarned() / UPGRADE_TARGET * 100),
refreshWallet: function () {
if (currentUser) {
loadWallet();
window.dispatchEvent(new CustomEvent("ridelesschat:wallet-updated", {
detail: { balance, dailyClaimed }
}));
}
},
claimReadReward,
getReadClaimsToday
};

const existingSession = getAuthenticatedSession();
if (existingSession) openDashboard();

})();

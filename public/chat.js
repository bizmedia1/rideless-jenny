
(function () {
"use strict";

const chat = window.RidelessChatApp;

if (!chat || chat.part3Initialized) return;

chat.part3Initialized = true;

const page = chat.page;
const el = chat.el;
const state = chat.state;
const CONFIG = chat.config;

/* =====================================
10 DAILY MESSENGER PROFILES
===================================== */

const MESSENGERS = [
{
id: "alex",
name: "Alex",
initial: "A",
greeting: "Hey! I'm Alex. How's your day going?",
replies: [
"That's interesting. What made you get into that?",
"I enjoy meeting people with different perspectives.",
"What do you usually do when you want to relax?",
"Tell me something exciting that happened recently.",
"That's actually something I'd love to try too."
]
},
{
id: "sarah",
name: "Sarah",
initial: "S",
greeting: "Hi there! I'm Sarah. It's nice to meet you!",
replies: [
"Honestly, I love conversations like this.",
"What kind of music do you enjoy listening to?",
"That sounds lovely! Tell me more.",
"I'm usually a very curious person. I like learning new things.",
"What would your perfect weekend look like?"
]
},
{
id: "daniel",
name: "Daniel",
initial: "D",
greeting: "Hello! Daniel here. How are you doing today?",
replies: [
"That's a good point. I hadn't thought about it that way.",
"Are you more of an indoor or outdoor person?",
"I enjoy discovering new places.",
"What motivates you when things get difficult?",
"Haha, I can relate to that!"
]
},
{
id: "grace",
name: "Grace",
initial: "G",
greeting: "Hey! I'm Grace. I hope you're having a good day.",
replies: [
"That's really sweet of you to share.",
"What do you enjoy doing in your spare time?",
"I think little things can make a day special.",
"Have you watched anything interesting lately?",
"I'm enjoying this conversation!"
]
},
{
id: "michael",
name: "Michael",
initial: "M",
greeting: "Hey there! I'm Michael. What's happening?",
replies: [
"Nice! How did that experience go?",
"I'm always interested in hearing people's stories.",
"What's one thing you'd really like to achieve?",
"That sounds like a good plan.",
"Do you prefer quiet places or busy environments?"
]
},
{
id: "ella",
name: "Ella",
initial: "E",
greeting: "Hi! I'm Ella. Nice to chat with you today.",
replies: [
"That makes sense to me.",
"What is something you've always wanted to learn?",
"I love trying new things whenever I can.",
"That sounds like a memorable experience.",
"What's your favourite way to spend an evening?"
]
},
{
id: "james",
name: "James",
initial: "J",
greeting: "Hello! I'm James. How's everything going?",
replies: [
"That's quite interesting!",
"Do you enjoy travelling?",
"I'd definitely like to hear more about that.",
"What's something that always makes you smile?",
"I think we have a few things in common."
]
},
{
id: "nina",
name: "Nina",
initial: "N",
greeting: "Hey! Nina here. How are you today?",
replies: [
"That's lovely! What happened next?",
"I'm a big fan of good conversations.",
"What kind of food do you enjoy most?",
"That sounds like something worth remembering.",
"Do you have any interesting plans coming up?"
]
},
{
id: "chris",
name: "Chris",
initial: "C",
greeting: "Hey! I'm Chris. Glad we got connected.",
replies: [
"Interesting perspective. I like that.",
"What do you usually do for fun?",
"I've always wanted to know more about that.",
"That's a great way to look at things.",
"What's something new you've tried recently?"
]
},
{
id: "olivia",
name: "Olivia",
initial: "O",
greeting: "Hi! I'm Olivia. It's great meeting you!",
replies: [
"That sounds wonderful!",
"What is your favourite thing about your city?",
"I enjoy hearing about people's interests.",
"That's something I can understand.",
"Tell me more. I'm listening!"
]
}
];

/* =====================================
DAILY SELECTION
===================================== */

function nigeriaDate() {
const parts = new Intl.DateTimeFormat("en-CA", {
timeZone: "Africa/Lagos",
year: "numeric",
month: "2-digit",
day: "2-digit"
}).formatToParts(new Date());

const values = {};

parts.forEach(function (part) {
values[part.type] = part.value;
});

return values.year + "-" + values.month + "-" + values.day;
}

function storageKey() {
return "ridelesschat_daily_messengers_" +
chat.getUserKey() + "_" + nigeriaDate();
}

function getUsedMessengers() {
try {
const value = JSON.parse(
localStorage.getItem(storageKey()) || "[]"
);

return Array.isArray(value) ? value : [];
} catch (error) {
return [];
}
}

function saveUsedMessengers(used) {
localStorage.setItem(storageKey(), JSON.stringify(used));
}

function getAvailableMessengers() {
const used = getUsedMessengers();

return MESSENGERS.filter(function (messenger) {
return !used.includes(messenger.id);
});
}

let currentMessenger = null;
let activeMessenger = null;
let replyIndex = 0;

/* =====================================
MESSENGER DISPLAY
===================================== */

function updateMessengerDisplay(messenger) {
if (!messenger) return;

CONFIG.senderName = messenger.name;
CONFIG.senderAvatar = "";

const senderAvatar = page.querySelector("#rc-chat-sender-avatar");
const senderName = page.querySelector(".rc-chat-sender-name strong");
const typingText = page.querySelector("#rc-chat-typing small");

if (senderAvatar) {
senderAvatar.textContent = messenger.initial;
senderAvatar.setAttribute("aria-label", messenger.name);
}

if (senderName) {
senderName.textContent = messenger.name;
}

if (typingText) {
typingText.textContent = messenger.name + " is typing...";
}

}

/* =====================================
PREPARE NEXT MESSENGER
===================================== */

function showDailyLimit() {
currentMessenger = null;

if (el.requestSection) {
el.requestSection.hidden = true;
}

if (el.emptySection) {
el.emptySection.hidden = false;

const heading = el.emptySection.querySelector("strong");
const description = el.emptySection.querySelector("span");

if (heading) {
heading.textContent = "Daily chats completed";
}

if (description) {
description.textContent =
"You have completed your 10 available chats for today. Come back tomorrow for more.";
}
}

if (el.statusText) {
el.statusText.textContent = "Daily limit reached";
}
}

function prepareNextMessenger() {
const available = getAvailableMessengers();

if (!available.length) {
showDailyLimit();
return;
}

const randomIndex = Math.floor(Math.random() * available.length);

currentMessenger = available[randomIndex];

updateMessengerDisplay(currentMessenger);

if (el.requestSection && !el.requestSection.hidden) {
if (el.statusText) {
el.statusText.textContent = "Waiting";
}
}
}

/* =====================================
MARK MESSENGER AS USED
===================================== */

function markMessengerUsed(messenger) {
if (!messenger) return;

const used = getUsedMessengers();

if (!used.includes(messenger.id)) {
used.push(messenger.id);
saveUsedMessengers(used);
}
}

/* =====================================
START BUTTON
===================================== */

if (el.startButton) {
el.startButton.addEventListener("click", function (event) {
if (!currentMessenger) {
event.preventDefault();
event.stopImmediatePropagation();

chat.showToast("No more chat requests available today.");
return;
}

activeMessenger = currentMessenger;

markMessengerUsed(activeMessenger);

replyIndex = 0;

updateMessengerDisplay(activeMessenger);

}, true);
}

/* =====================================
PERSONALIZED OPENING MESSAGE
===================================== */

const originalAddMessage = chat.addMessage;

chat.addMessage = function (content, isMine, options) {
if (!isMine && activeMessenger &&
content === "Hey! Thanks for accepting my chat request.") {
content = activeMessenger.greeting;
}

return originalAddMessage.call(chat, content, isMine, options);
};

/* =====================================
PERSONALIZED AUTOMATIC REPLIES
===================================== */

const originalScheduleReply = chat.scheduleReply;

chat.scheduleReply = function (message, delay) {
if (!activeMessenger) {
return originalScheduleReply.call(chat, message, delay);
}

const replies = activeMessenger.replies;

const personalizedReply =
replies[replyIndex % replies.length];

replyIndex++;

return originalScheduleReply.call(
chat,
personalizedReply,
delay
);
};

/* =====================================
CONTEXTUAL REPLIES
===================================== */

function getContextualReply(message) {
const value = message.toLowerCase();

const rules = [
{
words: ["how are you", "how are u", "how's your day", "how is your day"],
replies: [
"I'm doing pretty well, thanks for asking! How about you?",
"My day has been good so far. How's yours going?",
"I'm good! It's nice of you to ask."
]
},
{
words: ["name", "who are you"],
replies: [
"I'm " + (activeMessenger ? activeMessenger.name : "your chat partner") + ". Nice meeting you!",
"Just someone here to have a nice conversation with you!"
]
},
{
words: ["love", "relationship", "dating", "boyfriend", "girlfriend"],
replies: [
"That's an interesting topic. What do you think makes a relationship work?",
"I think honesty and understanding matter a lot.",
"Everyone has a different experience with relationships."
]
},
{
words: ["music", "song", "sing", "artist"],
replies: [
"What kind of music do you listen to most?",
"I enjoy discovering new songs. Any recommendations?",
"Music can really change someone's mood!"
]
},
{
words: ["food", "eat", "cooking", "rice", "jollof"],
replies: [
"Now you're making me hungry! What's your favourite food?",
"Good food and good conversation are a great combination.",
"Are you someone who enjoys cooking?"
]
},
{
words: ["work", "job", "business", "money", "career"],
replies: [
"That's an important part of life. How is it going?",
"What kind of work would you really enjoy doing?",
"I think having goals gives us something to work towards."
]
},
{
words: ["school", "study", "university", "education"],
replies: [
"What are you studying?",
"Learning new things can be challenging but rewarding.",
"How has school been going for you?"
]
},
{
words: ["sad", "stress", "tired", "bad day", "upset"],
replies: [
"I'm sorry to hear that. I hope things get better for you.",
"Sometimes talking about it can help. What's going on?",
"Take things one step at a time. I hope your day improves."
]
},
{
words: ["thank", "thanks"],
replies: [
"You're welcome! I'm happy to chat.",
"Anytime! That's what conversations are for.",
"No problem at all!"
]
},
{
words: ["bye", "goodbye", "leaving", "gotta go"],
replies: [
"It was nice talking with you! Take care.",
"Already? I enjoyed our conversation!",
"Have a lovely day. Talk again soon!"
]
},
{
words: ["where", "live", "country", "city"],
replies: [
"That's interesting! What do you like most about where you live?",
"I enjoy hearing about different places.",
"Have you lived there for a long time?"
]
},
{
words: ["football", "soccer", "match", "team"],
replies: [
"Are you a big football fan?",
"Which team do you support?",
"There's always something interesting happening in football!"
]
}
];

for (const rule of rules) {
if (rule.words.some(function (word) {
return value.includes(word);
})) {
const choices = rule.replies;

return choices[Math.floor(Math.random() * choices.length)];
}
}

if (!activeMessenger) {
return "That's interesting! Tell me a little more.";
}

const replies = activeMessenger.replies;

return replies[Math.floor(Math.random() * replies.length)];
}

/* =====================================
CUSTOM MESSAGE SENDING
===================================== */

function sendPersonalizedMessage() {
if (!state.chatStarted || state.chatFinished) return;

if (!el.messageInput) return;

const message = el.messageInput.value.trim();

if (!message) return;

chat.addMessage(message, true);

el.messageInput.value = "";

if (el.emojiPicker) {
el.emojiPicker.hidden = true;
}

const reply = getContextualReply(message);

const delay = 1800 + Math.floor(Math.random() * 1600);

chat.showTyping();

const timeout = setTimeout(function () {
if (!state.chatStarted || state.chatFinished) {
chat.hideTyping();
return;
}

chat.hideTyping();

chat.addMessage(reply, false);

}, delay);

state.scheduledReplies.push(timeout);
}

/* =====================================
INTERCEPT SEND BUTTON
===================================== */

if (el.sendButton) {
el.sendButton.addEventListener("click", function (event) {
event.preventDefault();
event.stopImmediatePropagation();

sendPersonalizedMessage();

}, true);
}

/* =====================================
INTERCEPT ENTER KEY
===================================== */

if (el.messageInput) {
el.messageInput.addEventListener("keydown", function (event) {
if (event.key !== "Enter") return;

event.preventDefault();
event.stopImmediatePropagation();

sendPersonalizedMessage();

}, true);
}

/* =====================================
ATTACHMENT REPLY
===================================== */

const originalSendAttachment = chat.sendAttachment;

chat.sendAttachment = function () {
if (!state.chatStarted || state.chatFinished) return;

return originalSendAttachment.call(chat);
};

/* =====================================
REQUEST VISIBILITY WATCHER
===================================== */

function requestIsVisible() {
return el.requestSection && !el.requestSection.hidden;
}

if (el.requestSection) {
const observer = new MutationObserver(function () {
if (
requestIsVisible() &&
!state.chatStarted &&
!state.chatFinished &&
!currentMessenger
) {
prepareNextMessenger();
}
});

observer.observe(el.requestSection, {
attributes: true,
attributeFilter: ["hidden", "class", "style"]
});
}

/* =====================================
INITIALIZE
===================================== */

prepareNextMessenger();

if (requestIsVisible() && !currentMessenger) {
prepareNextMessenger();
}

/* Recheck after account details load. */

window.addEventListener("ridelesschat:user-loaded", function () {
if (!state.chatStarted && !state.chatFinished) {
prepareNextMessenger();
}
});

})();


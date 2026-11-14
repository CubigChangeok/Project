/* chat.js — 메신저 화면: 상대 자막(왼쪽), 내 말(오른쪽), 추천 답장 칩, 입력창.
 * 데이터는 SoriApi.listen()의 이벤트로 받는다. 공통 도구(el, EMOTIONS, emotionTag, avatar)는 app.js에 있다. */
const chat = {
  list: $("chat-list"), empty: $("chat-empty"), start: $("chat-start"), newBtn: $("chat-new"),
  status: $("chat-status"), statusText: $("chat-status-text"), mic: $("chat-mic"), filter: $("chat-filter"),
  suggest: $("chat-suggest"), chips: $("chat-chips"), form: $("chat-form"), input: $("chat-input"),
  stop: null, typing: null, speakers: {},
  group: null, replies: [], summary: null, // 지금 보고 있는 대화 모임과 그 모임의 추천 답장·요약
};

/* 상태 글자: "듣는 중 · 지민, 서준" 처럼 모임 사람도 함께 */
function setStatusText(state) {
  const who = chat.group?.members.length ? ` · ${chat.group.members.join(", ")}` : "";
  chat.statusText.textContent = state + who;
}
const NEAR_BOTTOM_PX = 80;

/* ---------- 스크롤: 맨 아래 근처일 때만 따라 내려가고, 위를 보고 있으면 "새 자막 ↓" ---------- */
const nearBottom = () => chat.list.scrollHeight - chat.list.scrollTop - chat.list.clientHeight < NEAR_BOTTOM_PX;

function scrollToBottom(smooth = true) {
  chat.list.scrollTo({ top: chat.list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  chat.newBtn.hidden = true;
}

/* 목록이 바뀌기 직전에 "맨 아래에 있었나"를 재고, 바뀐 뒤에 따라 내려갈지 정한다 */
function changeList(change, { mine = false } = {}) {
  const stick = mine || nearBottom();
  change();
  chat.empty.hidden = chat.list.childElementCount > 0;
  if (stick) scrollToBottom(!mine);
  else chat.newBtn.hidden = false;
}

/* 키보드나 아래 탭 때문에 대화 칸 높이가 바뀌어도, 맨 아래를 보고 있었다면 맨 아래에 계속 붙여 둔다 */
let pinned = true;
chat.list.addEventListener("scroll", () => {
  pinned = nearBottom();
  if (pinned) chat.newBtn.hidden = true;
}, { passive: true });
new ResizeObserver(() => { if (pinned) chat.list.scrollTop = chat.list.scrollHeight; }).observe(chat.list);
chat.newBtn.addEventListener("click", () => scrollToBottom());

/* ---------- 듣기 시작/멈춤 ---------- */
function setListening(on) {
  chat.status.classList.toggle("on", on);
  chat.mic.setAttribute("aria-pressed", String(on));
  chat.mic.setAttribute("aria-label", on ? "듣기 멈추기" : "듣기 시작");
  setStatusText(on ? "듣는 중" : "듣기 멈춤");
  if (!on) setSpeaking(false);
}
function setSpeaking(on) {
  chat.status.classList.toggle("speaking", on);
  if (chat.status.classList.contains("on")) setStatusText(on ? "상대가 말하는 중" : "듣는 중");
}

/* 듣기 시작: 진짜 마이크를 먼저 켜고(못 켜면 안내 화면), 켜지면 자막을 받기 시작한다.
 * 자막은 아직 가짜 대본(mock.js). 3단계에서 마이크 소리를 서버로 보내 진짜 자막으로 바꾼다. */
async function startListening({ fromStart = false, quiet = false } = {}) {
  if (chat.stop || chat.starting || !chat.group) return false;
  chat.starting = true;
  const ok = await Mic.start({ quiet }); // 아이폰: 버튼을 누른 순간 바로 불러야 마이크를 준다
  chat.starting = false;
  if (!ok || chat.stop) return ok;
  setListening(true);
  chat.stop = SoriApi.listen(chat.group.id, onEvent, { fromStart });
  return true;
}
function stopListening() {
  Mic.stop();
  chat.stop?.();
  chat.stop = null;
  chat.typing?.remove();
  chat.typing = null;
  chat.pausedForSpeech = false;
  setListening(false);
}
chat.start.addEventListener("click", () => startListening());
chat.mic.addEventListener("click", () => {
  if (chat.stop) stopListening();
  else if (chat.pausedForSpeech) { chat.pausedForSpeech = false; setStatusText("듣기 멈춤"); } // 읽는 중에 끄면 다시 켜지 않음
  else if (chat.list.querySelector(".system")) restart(); // 대본이 끝났으면 처음부터
  else startListening();
});
Mic.hooks.onRetry = () => startListening();
Mic.hooks.onLost = () => { stopListening(); setStatusText("마이크가 끊겼어요"); };

/* 위쪽 상태 옆 막대 4개를 진짜 소리 크기에 맞춰 움직인다 */
const levelBars = [...chat.status.querySelectorAll(".mini-wave i")];
const BAR_WEIGHTS = [0.55, 1, 0.8, 0.45];
Mic.onLevel((level) => {
  levelBars.forEach((bar, i) => bar.style.setProperty("--lv", (0.2 + Math.min(1, level * BAR_WEIGHTS[i]) * 0.8).toFixed(3)));
});

function restart() {
  stopListening();
  chat.list.replaceChildren();
  chat.speakers = {};
  showReplies([]);
  chat.summary = null;
  Sheet.update(null);
  startListening({ fromStart: true });
}

/* ---------- 받은 이벤트 처리 ---------- */
function onEvent(e) {
  if (e.type === "partial") showTyping(e);
  else if (e.type === "line") {
    changeList(() => {
      chat.typing?.remove();
      chat.typing = null;
      // 같은 번호의 확정 자막이 또 오면(늦게 온 더 긴 문장) 새로 만들지 않고 그 말풍선을 바꾼다
      const old = e.id != null && chat.list.querySelector(`li.msg.partner[data-id="${e.id}"]`);
      if (old) {
        const fresh = renderLine(e);
        fresh.classList.add("restyled");
        old.replaceWith(fresh);
      } else chat.list.append(renderLine(e));
    });
    setSpeaking(false);
  } else if (e.type === "style") restyleLine(e);
  else if (e.type === "notice") changeList(() => chat.list.append(el("li", "system", e.text)));
  else if (e.type === "stranger") changeList(() => addStranger(e.text));
  else if (e.type === "replies") showReplies(e.replies);
  else if (e.type === "summary") {
    chat.summary = e.summary;
    Sheet.update(e.summary); // 요약창이 열려 있어도 바로 바뀜
  } else if (e.type === "end") {
    chat.stop = null;
    setListening(false);
    setStatusText("대화 끝");
    changeList(() => chat.list.append(renderEnd()));
  }
}

/* 인식 중인 글자: 목록 맨 아래 점선 말풍선에 타자 치듯 보여준다 */
function showTyping(e) {
  setSpeaking(true);
  if (!chat.typing) {
    changeList(() => {
      const spk = speakerIndex(e.speaker);
      chat.typing = el("li", `msg partner typing spk-${spk}`);
      const body = el("div", "msg-body");
      const bubble = el("p", "bubble");
      bubble.append(el("span", "typing-text"), el("span", "cursor"));
      body.append(el("p", "meta", `${e.speaker} · 인식 중`), bubble);
      chat.typing.append(avatar(e.speaker, spk), body);
      chat.list.append(chat.typing);
    });
  }
  const stick = nearBottom();
  chat.typing.querySelector(".typing-text").textContent = e.text;
  if (stick) chat.list.scrollTop = chat.list.scrollHeight; // 글자가 늘어 줄이 바뀌어도 맨 아래 유지
}

/* 사람마다 말풍선 색을 다르게: 처음 나온 순서대로 0, 1, 2, 3번 색 */
function speakerIndex(name) {
  if (!(name in chat.speakers)) chat.speakers[name] = Object.keys(chat.speakers).length % 4;
  return chat.speakers[name];
}

/* 문장을 조각내서 핵심 단어는 강조, 잘 안 들린 단어는 흐리게 */
function markedText(text, keywords, unclear) {
  const marks = [];
  for (const [words, cls] of [[keywords, "kw"], [unclear, "unclear"]]) {
    for (const w of words) {
      const at = text.indexOf(w);
      if (w && at >= 0) marks.push({ at, end: at + w.length, cls });
    }
  }
  marks.sort((a, b) => a.at - b.at);
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const m of marks) {
    if (m.at < pos) continue; // 겹치는 표시는 건너뜀
    frag.append(text.slice(pos, m.at), el(m.cls === "kw" ? "mark" : "span", m.cls, text.slice(m.at, m.end)));
    pos = m.end;
  }
  frag.append(text.slice(pos));
  return frag;
}

function renderLine(e) {
  const spk = speakerIndex(e.speaker);
  const li = el("li", `msg partner spk-${spk} emo-${e.emotion}`);
  if (e.id != null) li.dataset.id = e.id;
  li.line = e; // 나중에 Claude 분석이 오면 이 내용에 덧입혀 다시 그린다

  const body = el("div", "msg-body");
  const meta = el("p", "meta");
  meta.append(el("b", null, e.speaker), ` · ${e.time}`);
  const bubble = el("p", "bubble");
  /* 설명형 자막 줄: [준호 · 화난 목소리로, 빠르게, 크게] — 설정에서 "설명형"일 때만 보인다 */
  const desc = el("span", "desc");
  desc.append(`[${e.speaker} · ${(EMOTIONS[e.emotion] || EMOTIONS.neutral).voice}`,
    el("span", "desc-tone", e.tone ? `, ${e.tone.replaceAll(" · ", ", ")}` : ""), "]");
  bubble.append(desc, markedText(e.text, e.keywords, e.unclear));

  const tags = el("div", "tags");
  tags.append(emotionTag(e.emotion));
  if (e.tone) tags.append(el("span", "tag tag-tone", e.tone));
  if (e.corrected) tags.append(el("span", "tag tag-fix", "문맥으로 고침"));

  body.append(meta, bubble, tags);
  li.append(avatar(e.speaker, spk), body);
  return li;
}

/* Claude 분석(감정·고친 문장·핵심 단어)이 1~2초 늦게 오면, 이미 보여 준 같은 번호의 말풍선을 고쳐 그린다 */
function restyleLine(e) {
  const old = chat.list.querySelector(`li.msg.partner[data-id="${e.id}"]`);
  if (!old) return; // 다른 모임으로 옮겼거나 지워진 말풍선
  if (e.raw && old.line.raw && e.raw !== old.line.raw) return; // 바뀌기 전 짧은 문장의 분석이 늦게 온 것: 버린다
  const fresh = renderLine({ ...old.line, ...e, type: "line" });
  fresh.classList.add("restyled");
  changeList(() => old.replaceWith(fresh));
}

function renderEnd() {
  const li = el("li", "system");
  const again = el("button", "system-btn", "처음부터 다시 듣기");
  again.type = "button";
  again.addEventListener("click", restart);
  li.append(el("span", null, "대본이 끝났어요"), again);
  return li;
}

/* ---------- 모르는 사람의 말: 이어서 나오면 한 묶음으로 세고, 평소엔 개수만 ---------- */
function addStranger(text) {
  let group = chat.list.lastElementChild;
  if (!group || !group.classList.contains("stranger-group")) {
    group = el("li", "stranger-group");
    group.append(el("p", "stranger-count"), el("ul", "stranger-lines"));
    chat.list.append(group);
  }
  group.querySelector(".stranger-lines").append(el("li", null, text));
  updateStrangerCounts();
}

function updateStrangerCounts() {
  const showing = chat.list.classList.contains("show-strangers");
  chat.list.querySelectorAll(".stranger-group").forEach((g) => {
    const n = g.querySelectorAll(".stranger-lines li").length;
    g.querySelector(".stranger-count").textContent = showing
      ? `모르는 사람의 말 ${n}개 (보이는 중)`
      : `모르는 사람의 말 ${n}개를 숨겼어요`;
  });
}

chat.filter.addEventListener("click", () => {
  const onlyEnrolled = chat.filter.getAttribute("aria-pressed") !== "true";
  chat.filter.setAttribute("aria-pressed", String(onlyEnrolled));
  chat.list.classList.toggle("show-strangers", !onlyEnrolled);
  updateStrangerCounts();
});

/* ---------- 추천 답장 칩과 내 말 ---------- */
function showReplies(replies) {
  chat.replies = replies;
  chat.suggest.hidden = replies.length === 0;
  chat.chips.replaceChildren(...replies.map((text) => {
    const chip = el("button", "chip-reply", text);
    chip.type = "button";
    chip.addEventListener("click", () => say(text)); // 누르면 바로 말하기
    return chip;
  }));
  chat.chips.scrollLeft = 0;
}

/* 내 말: 오른쪽 말풍선을 만들고, 휴대폰이 소리 내어 읽는다 */
function say(text) {
  const li = el("li", "msg mine");
  const body = el("div", "msg-body");
  const bubble = el("button", "bubble", text);
  bubble.type = "button";
  bubble.setAttribute("aria-label", `${text} — 누르면 다시 읽어요`);
  bubble.addEventListener("click", () => speakBubble(li, text)); // 말풍선을 누르면 다시 읽기
  const foot = el("div", "mine-foot");
  const big = el("button", "big-btn", "크게 보기");
  big.type = "button";
  big.addEventListener("click", () => Speaker.showBig(text));
  foot.append(el("span", "msg-status"), big);
  body.append(bubble, foot);
  li.append(body);
  changeList(() => chat.list.append(li), { mine: true });
  SoriApi.sendReply(text);
  speakBubble(li, text);
}

/* 읽는 동안에는 마이크를 완전히 껐다가(폰이 낸 소리가 다시 자막으로 잡히지 않게),
 * 다 읽으면 다시 켠다. 여러 번 연달아 누르면 마지막 것만 끝난 뒤 다시 켠다. */
let speakTurn = 0;
async function speakBubble(li, text) {
  const status = li.querySelector(".msg-status");
  if (!Speaker.supported) { // 읽어 주기를 못 하는 브라우저: 크게 보여주기로 대신
    status.textContent = "화면으로 보여줬어요";
    Speaker.showBig(text);
    return;
  }
  const turn = ++speakTurn;
  if (chat.stop) pauseForSpeech();
  li.classList.add("speaking");
  status.textContent = "말하는 중…";
  await Speaker.speak(text);
  li.classList.remove("speaking");
  status.textContent = "전달됨 ✓";
  if (turn === speakTurn && chat.pausedForSpeech) resumeAfterSpeech();
}

function pauseForSpeech() {
  stopListening();
  chat.pausedForSpeech = true;
  setStatusText("읽는 동안 멈춤");
}
async function resumeAfterSpeech() {
  chat.pausedForSpeech = false;
  const ok = await startListening({ quiet: true }); // 버튼을 누른 게 아니라서 아이폰이 거절할 수 있음
  if (!ok) setStatusText("마이크 버튼을 눌러 다시 들어요");
}

if (!Speaker.supported) chat.form.querySelector(".speak-btn").lastChild.textContent = " 크게 보여주기";

chat.form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = chat.input.value.trim();
  if (!text) { chat.input.focus(); return; }
  chat.input.value = "";
  say(text);
});

/* ---------- 대화 모임: 위쪽 이름을 눌러 모임을 고르거나 새로 만든다 ----------
 * 모임마다 대화 기록, 추천 답장, 요약을 따로 가진다. 다른 모임에 다녀와도 그대로 남아 있다. */
const room = {
  btn: $("room-btn"), name: $("room-name"), tile: $("room-tile"), menu: $("room-menu"), list: $("room-list"),
  add: $("room-add"), form: $("room-form"), input: $("room-input"), members: $("room-members"),
  hint: $("room-hint"), cancel: $("room-cancel"),
  groups: [], saved: {}, // saved[모임id] = 그 모임을 떠날 때의 화면 상태
};

function saveRoom() {
  if (!chat.group) return;
  chat.typing?.remove();
  chat.typing = null;
  room.saved[chat.group.id] = {
    nodes: [...chat.list.children], speakers: chat.speakers, replies: chat.replies, summary: chat.summary,
  };
}

function openRoom(group) {
  stopListening();
  saveRoom();
  Sheet.close();
  chat.group = group;
  store.set("sori.group", group.id);
  room.name.textContent = group.name;
  room.tile.replaceWith((room.tile = groupTile(group)));
  room.tile.id = "room-tile";
  const s = room.saved[group.id] || { nodes: [], speakers: {}, replies: [], summary: null };
  chat.list.replaceChildren(...s.nodes);
  chat.speakers = s.speakers;
  showReplies(s.replies);
  chat.summary = s.summary;
  Sheet.update(s.summary);
  chat.empty.hidden = s.nodes.length > 0;
  chat.newBtn.hidden = true;
  chat.list.scrollTop = chat.list.scrollHeight;
  setListening(false);
}

/* 모임 타일: 모임 이름 첫 글자, 색은 모임마다 고정 */
function groupTile(group) {
  const tone = [...group.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return avatar(group.name, tone, "tile");
}

function renderGroups() {
  room.list.replaceChildren(...room.groups.map((g) => {
    const b = el("button", "room-option");
    b.type = "button";
    const current = g.id === chat.group?.id;
    b.setAttribute("aria-current", String(current));
    const text = el("span", "room-option-text");
    text.append(el("strong", null, g.name), el("small", null, g.members.join(" · ") || "아직 함께하는 사람이 없어요"));
    b.append(groupTile(g), text);
    if (current) {
      const check = el("span", "room-check");
      check.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      b.append(check);
    }
    b.addEventListener("click", () => { if (!current) openRoom(g); closeRoomMenu(); });
    const li = el("li");
    li.append(b);
    return li;
  }));
}

/* 모임 목록: 위쪽 이름을 누르면 바로 아래에 펼쳐진다 */
async function openRoomMenu() {
  room.groups = await SoriApi.listGroups();
  renderGroups();
  room.form.hidden = true;
  room.add.hidden = false;
  room.menu.hidden = false;
  room.btn.setAttribute("aria-expanded", "true");
}
function closeRoomMenu() {
  room.menu.hidden = true;
  room.btn.setAttribute("aria-expanded", "false");
}
room.btn.addEventListener("click", () => (room.menu.hidden ? openRoomMenu() : closeRoomMenu()));
document.addEventListener("pointerdown", (e) => {
  if (!room.menu.hidden && !room.menu.contains(e.target) && !room.btn.contains(e.target)) closeRoomMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !room.menu.hidden) closeRoomMenu(); });

/* 새 모임 만들기: 이름 + 함께하는 사람 고르기 */
room.add.addEventListener("click", async () => {
  const names = await SoriApi.listPeople();
  room.members.replaceChildren(...names.map((n) => {
    const b = el("button", "member-chip", n);
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")));
    return b;
  }));
  room.input.value = "";
  room.hint.textContent = "";
  room.add.hidden = true;
  room.form.hidden = false;
  room.input.focus();
});
room.cancel.addEventListener("click", () => { room.form.hidden = true; room.add.hidden = false; });

room.form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = room.input.value.trim();
  if (!name) { room.hint.textContent = "모임 이름을 써 주세요"; room.input.focus(); return; }
  if (room.groups.some((g) => g.name === name)) { room.hint.textContent = "이미 있는 모임 이름이에요"; room.input.focus(); return; }
  const members = [...room.members.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent);
  const group = await SoriApi.createGroup({ name, members });
  closeRoomMenu();
  openRoom(group);
});

/* 처음 열 때: 지난번에 보던 모임, 없으면 첫 번째 모임 */
SoriApi.listGroups().then((groups) => {
  room.groups = groups;
  const last = store.get("sori.group", null);
  openRoom(groups.find((g) => g.id === last) || groups[0]);
});

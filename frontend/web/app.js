/* app.js — 공통 도구, 탭 전환, 목소리 등록.
 * 데이터는 전부 SoriApi(mock.js)에서 받는다. 대화 화면은 chat.js, 요약창은 sheet.js. */
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text; // 글자는 textContent로만 넣어서 데이터가 HTML로 실행되지 않게
  return node;
}

/* 휴대폰에 작은 값 저장하기. 개인 정보 보호 모드처럼 저장이 막혀도 앱은 멈추지 않게 한다 */
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 못 해도 화면은 그대로 동작 */ }
  },
};

/* 감정 7개: 색 점과 이름을 항상 같이 보여준다 (색만으로 구분하지 않기) */
const EMOTIONS = { // voice: 설명형 자막에 쓰는 말 ([준호 · 화난 목소리로])
  neutral: { label: "중립", voice: "차분한 목소리로" },
  happy: { label: "행복", voice: "밝은 목소리로" },
  surprised: { label: "놀람", voice: "놀란 목소리로" },
  angry: { label: "분노", voice: "화난 목소리로" },
  sad: { label: "슬픔", voice: "슬픈 목소리로" },
  fear: { label: "공포", voice: "불안한 목소리로" },
  disgust: { label: "혐오", voice: "언짢은 목소리로" },
};

/* 감정 표시: 색 점 + 이름 (예: ● 행복) */
function emotionTag(emotion, extra = "") {
  const tag = el("span", `tag tag-emo emo-${emotion}`);
  tag.append(el("i", "emo-dot"), `${(EMOTIONS[emotion] || EMOTIONS.neutral).label}${extra}`);
  return tag;
}

/* 이름 첫 글자 동그라미 (사람) / 둥근 사각 타일 (모임). tone은 0~3 색 */
/* 이름 첫 글자. 아직 이름을 안 정한 "화자 1"은 첫 글자가 모두 "화"라서 번호를 보여 준다 */
const initialOf = (name) => (/^화자 (\d+)$/.exec(name || "")?.[1]) || [...(name || "?").trim()][0] || "?";
function avatar(name, tone = 0, className = "avatar") {
  const a = el("span", `${className} tone-${tone % 4}`, initialOf(name));
  a.setAttribute("aria-hidden", "true");
  return a;
}

/* ================= 화면 전환 ================= */
const screens = { enroll: $("screen-enroll"), talk: $("screen-talk") };

function show(name) {
  for (const [key, section] of Object.entries(screens)) section.hidden = key !== name;
  document.querySelectorAll(".tabs button").forEach((b) => {
    if (b.dataset.go === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));

/* 아이폰 키보드가 올라오면 보이는 높이에 맞춰 앱 높이를 줄여서, 입력창이 키보드 바로 위에 붙게 한다 */
if (window.visualViewport) {
  const fit = () => {
    document.documentElement.style.setProperty("--app-h", `${visualViewport.height}px`);
    window.scrollTo(0, 0);
  };
  visualViewport.addEventListener("resize", fit);
  fit();
}
/* 입력하는 동안에는 아래 탭을 숨겨서 대화가 보이는 칸을 넓힌다 */
document.addEventListener("focusin", (e) => document.body.classList.toggle("typing", e.target.matches("#chat-input")));
document.addEventListener("focusout", () => document.body.classList.remove("typing"));

/* 손가락(마우스)으로 끄는 동안에는 글자가 파랗게 선택되지 않게 한다 (요약창·모임 서랍이 같이 씀) */
function startDragging() {
  window.getSelection()?.removeAllRanges();
  document.documentElement.classList.add("dragging");
}
function stopDragging() {
  document.documentElement.classList.remove("dragging");
}

/* 파형 막대 만들기: 막대마다 높이와 박자를 조금씩 다르게 */
function makeWave(container, count) {
  for (let i = 0; i < count; i++) {
    const bar = el("i");
    bar.style.setProperty("--i", i);
    bar.style.setProperty("--h", (0.35 + ((i * 37) % 65) / 100).toFixed(2));
    container.append(bar);
  }
  return [...container.children];
}

/* ================= 1. 등록 ================= */
const enroll = {
  name: $("enroll-name"), title: $("enroll-name-title"), mic: $("enroll-mic"),
  status: $("enroll-status"), consent: $("enroll-consent"), people: $("enroll-people"),
  add: $("enroll-add"), wave: $("enroll-wave"), recording: false,
};
const enrollBars = makeWave(enroll.wave, 22);

function setEnrollStatus(text, warn = false) {
  enroll.status.textContent = text;
  enroll.status.classList.toggle("warn", warn);
}

function updateTitle() {
  enroll.title.textContent = enroll.name.value.trim() || "대화 상대";
}
enroll.name.addEventListener("input", updateTitle);
updateTitle();

enroll.mic.addEventListener("click", async () => {
  if (enroll.recording) return;
  const name = enroll.name.value.trim();
  if (!name) {
    setEnrollStatus("이름을 먼저 써 주세요", true);
    enroll.name.focus();
    return;
  }
  if (!enroll.consent.checked) {
    setEnrollStatus("먼저 아래 동의에 체크해 주세요", true);
    const box = enroll.consent.closest(".consent");
    box.classList.remove("shake");
    void box.offsetWidth; // 흔들기 애니메이션을 다시 시작하려고 한 번 읽어 줌
    box.classList.add("shake");
    return;
  }

  enroll.recording = true;
  enroll.name.disabled = true;
  enroll.mic.classList.remove("done");
  enroll.mic.classList.add("recording");
  enroll.mic.setAttribute("aria-label", "녹음 중");
  enroll.wave.classList.add("moving");

  const person = await SoriApi.enroll(name, ({ secondsLeft }) => {
    const filled = Math.round(enrollBars.length * (1 - secondsLeft / 8));
    enrollBars.forEach((bar, i) => bar.classList.toggle("on", i < filled));
    enroll.status.replaceChildren(el("b", null, `${secondsLeft}초`), " 남았어요");
  });

  enroll.recording = false;
  enroll.mic.classList.remove("recording");
  enroll.mic.classList.add("done");
  enroll.mic.setAttribute("aria-label", "녹음 시작");
  enroll.wave.classList.remove("moving");
  const chip = el("span", "chip chip-new");
  chip.append(avatar(person.name, enroll.people.childElementCount - 1, "avatar avatar-sm"), person.name);
  enroll.people.insertBefore(chip, enroll.add);
  setEnrollStatus(`${person.name}님을 등록했어요 ✓`);
});

enroll.add.addEventListener("click", () => {
  if (enroll.recording) return;
  enroll.name.disabled = false;
  enroll.name.value = "";
  enroll.consent.checked = false; // 사람마다 따로 동의를 받는다
  enroll.mic.classList.remove("done");
  enrollBars.forEach((bar) => bar.classList.remove("on"));
  updateTitle();
  setEnrollStatus("다음 사람 이름을 쓰고 마이크를 눌러요");
  enroll.name.focus();
});

show("enroll");

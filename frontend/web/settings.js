/* settings.js — 설정 서랍의 "자막 표시 방식"과 "세부 설정".
 * 바꾸면 대화 자막에 바로 적용되고, 휴대폰(localStorage)에 저장돼서 새로고침해도 유지된다.
 * 적용 방법: <html>에 표시(data-mode, no-… 클래스)를 달면 style.css가 그에 맞게 보여준다. */
const Settings = (() => {
  const KEY = "sori.settings";
  const DEFAULTS = {
    mode: "visual",   // basic 기본 자막 / described 설명형 자막 / visual 비유형 자막
    size: 17,         // 기본 글자 크기(px)
    emoColor: true,   // 감정 색상
    emoTag: true,     // 감정 표시와 이름
    emoSize: true,    // 감정에 따라 글자 크기 바꾸기
    tone: true,       // 말 빠르기 · 높낮이 표시
  };
  const s = { ...DEFAULTS, ...store.get(KEY, {}) };
  const root = document.documentElement;
  const sizeInput = $("set-size"), sizeValue = $("set-size-val");

  function apply() {
    root.dataset.mode = s.mode;
    root.style.setProperty("--caption", `${s.size}px`);
    root.classList.toggle("no-emo-color", !s.emoColor);
    root.classList.toggle("no-emo-tag", !s.emoTag);
    root.classList.toggle("no-emo-size", !s.emoSize);
    root.classList.toggle("no-tone", !s.tone);
    sizeValue.textContent = `${s.size}px`;
    sizeInput.style.setProperty("--fill", `${((s.size - sizeInput.min) / (sizeInput.max - sizeInput.min)) * 100}%`);
  }
  function save() {
    store.set(KEY, s);
    apply();
  }

  document.querySelectorAll('input[name="caption-mode"]').forEach((radio) => {
    radio.checked = radio.value === s.mode;
    radio.addEventListener("change", () => { if (radio.checked) { s.mode = radio.value; save(); } });
  });
  sizeInput.value = s.size;
  sizeInput.addEventListener("input", () => { s.size = Number(sizeInput.value); save(); });
  document.querySelectorAll(".set-row input[data-key]").forEach((box) => {
    box.checked = s[box.dataset.key];
    box.addEventListener("change", () => { s[box.dataset.key] = box.checked; save(); });
  });

  apply();
  return { get: (key) => s[key] };
})();

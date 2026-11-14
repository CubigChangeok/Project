/* sheet.js — 대화 화면 아래에 숨어 있는 요약창.
 * 아래 영역(손잡이·칩·입력창 주변)에서 손가락을 위로 쓸어 올리면 따라 올라오고,
 * 놓으면 닫힘 / 절반 / 거의 전체 중 가까운 곳에 착 붙는다.
 * 말풍선 목록에서 시작한 손가락은 건드리지 않아서 위아래 스크롤과 겹치지 않는다. */
const Sheet = (() => {
  const root = $("sheet"), backdrop = $("sheet-backdrop"), zone = $("sheet-zone");
  const grip = $("sheet-grip"), head = $("sheet-head");
  const ui = {
    empty: $("sheet-empty"), content: $("sheet-content"), time: $("sheet-time"), card: $("sheet-card"),
    decided: $("sheet-decided"), todo: $("sheet-todo"), mood: $("sheet-mood"), moodBar: $("sheet-mood-bar"),
    flow: $("sheet-flow"), legend: $("sheet-legend"),
  };
  const START_PX = 8;      // 이만큼 움직여야 "쓸기"로 본다 (그 전엔 그냥 누른 것)
  const FLING_MS = 160;    // 빠르게 튕기면 이 시간만큼 더 날아간 자리로 계산
  const STILL_MS = 80;     // 손가락이 이만큼 멈춰 있다가 놓으면 튕기기로 보지 않음

  let level = 0;           // 0 닫힘, 1 절반, 2 거의 전체
  let visible = 0;         // 지금 보이는 높이(px)
  let suppressClick = false;

  /* 세 단계 높이: 닫힘 0, 절반 = 앱 높이의 절반, 거의 전체 = 요약창 전체 높이 */
  function levels() {
    const full = root.offsetHeight;
    return [0, Math.min(full, Math.round(root.parentElement.clientHeight * 0.5)), full];
  }

  function place(px, animate) {
    const [, half, full] = levels();
    visible = Math.max(0, Math.min(full, px));
    root.classList.toggle("animating", animate);
    backdrop.classList.toggle("animating", animate);
    root.style.transform = `translateY(${full - visible}px)`;
    backdrop.style.opacity = String(Math.min(1, visible / half));
    const open = visible > 0;
    backdrop.classList.toggle("on", open);
    root.toggleAttribute("inert", !open);
    root.setAttribute("aria-hidden", String(!open));
  }

  function snapTo(i) {
    level = i;
    place(levels()[i], true);
  }

  /* 손가락 따라가기. intent가 true면 처음 움직임이 "위로"일 때만 시작한다 (옆으로 밀면 칩 넘기기) */
  function follow(down, { intent }) {
    const id = down.pointerId, startX = down.clientX, startY = down.clientY, startVisible = visible;
    const target = down.currentTarget;
    let dragging = !intent, lastY = startY, lastT = performance.now(), speed = 0;
    if (dragging) { target.setPointerCapture?.(id); startDragging(); }

    const move = (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < START_PX && Math.abs(dy) < START_PX) return;
        if (dy < 0 && Math.abs(dy) > Math.abs(dx)) {
          dragging = true;
          target.setPointerCapture?.(id);
          startDragging();
        } else return stop();
      }
      e.preventDefault();
      const now = performance.now();
      speed = (lastY - e.clientY) / Math.max(1, now - lastT); // 위로 움직이면 +
      lastY = e.clientY;
      lastT = now;
      place(startVisible - dy, false);
    };
    const up = (e) => {
      if (e.pointerId !== id) return;
      stop();
      if (!dragging) return; // 그냥 누른 것: 원래 click이 처리
      if (Math.abs(e.clientY - startY) >= START_PX) {
        suppressClick = true; // 쓸고 난 뒤 손가락 아래 칩이 눌리지 않게
        setTimeout(() => { suppressClick = false; }, 350);
      }
      if (performance.now() - lastT > STILL_MS) speed = 0; // 멈췄다가 놓으면 튕긴 게 아님
      const projected = visible + speed * FLING_MS;
      const hs = levels();
      let best = 0;
      hs.forEach((h, i) => { if (Math.abs(h - projected) < Math.abs(hs[best] - projected)) best = i; });
      snapTo(best);
    };
    function stop() {
      stopDragging();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  zone.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || e.target.closest("input")) return; // 입력창은 글쓰기용
    follow(e, { intent: true });
  });
  head.addEventListener("pointerdown", (e) => { if (e.button === 0) follow(e, { intent: false }); });

  /* 쓸고 난 직후의 click은 버린다 (capture 단계에서 먼저 막음) */
  for (const node of [zone, head]) {
    node.addEventListener("click", (e) => {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
    }, true);
  }

  grip.addEventListener("click", () => snapTo(1));
  grip.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); snapTo(1); head.focus(); }
  });
  head.tabIndex = -1;
  head.addEventListener("click", () => snapTo(level === 1 ? 2 : 1)); // 머리 부분을 누르면 절반 ↔ 전체
  backdrop.addEventListener("click", () => snapTo(0));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && level > 0) snapTo(0); });
  new ResizeObserver(() => place(levels()[level], false)).observe(root.parentElement);

  /* 요약 내용 채우기. 열려 있을 때 바뀌면 살짝 반짝여서 알려준다 */
  function update(s) {
    ui.empty.hidden = !!s;
    ui.content.hidden = !s;
    if (!s) {
      ui.time.textContent = "대화가 쌓이면 자동으로 이어 써요";
      return;
    }
    ui.time.textContent = `${s.time} 기준 · 대화가 쌓이면 자동으로 이어 써요`;
    ui.decided.replaceChildren(...s.decided.flatMap((line, i) => (i ? [el("br"), line] : [line])));
    ui.todo.textContent = s.todo ? `할 일 · ${s.todo}` : "";
    ui.mood.textContent = s.moodText;
    ui.moodBar.replaceChildren(...s.moodMix.map((m) => {
      const seg = el("span", `emo-${m.emotion}`);
      seg.style.width = `${m.percent}%`;
      return seg;
    }));
    ui.flow.textContent = s.flow;
    ui.legend.replaceChildren(...s.moodMix.map((m) => {
      const li = el("li");
      li.append(emotionTag(m.emotion, ` ${m.percent}%`));
      return li;
    }));
    if (visible > 0) {
      ui.card.classList.remove("flash");
      void ui.card.offsetWidth; // 반짝임 애니메이션을 다시 시작하려고 한 번 읽어 줌
      ui.card.classList.add("flash");
    }
  }

  place(0, false);
  return { update, close: () => snapTo(0), open: (i = 1) => snapTo(i), get level() { return level; } };
})();

/* drawer.js — 왼쪽에 숨어 있는 설정 서랍. (설정 항목은 5단계에서 채운다)
 * 대화 칸에서 손가락을 왼쪽→오른쪽으로 쓸면 따라 나오고, 놓으면 열림/닫힘 중 가까운 쪽에 착 붙는다.
 * 위아래로 움직이면 대화 스크롤로 보고 건드리지 않는다.
 * (Safari에서는 화면 맨 왼쪽 끝에서 쓸면 "뒤로 가기"가 먼저 가져가므로, 대화 칸 어디서 시작해도 되게 했다) */
const Drawer = (() => {
  const root = $("drawer"), backdrop = $("drawer-backdrop"), zone = $("drawer-zone");
  const START_PX = 10;   // 이만큼 움직여야 "쓸기"로 본다
  const FLING_MS = 160;  // 빠르게 튕기면 이 시간만큼 더 날아간 자리로 계산
  const STILL_MS = 80;   // 손가락이 이만큼 멈춰 있다가 놓으면 튕기기로 보지 않음

  let shown = 0;         // 지금 보이는 너비(px)
  let isOpen = false;
  let suppressClick = false;
  const hooks = { onOpen: null, onChange: null }; // chat.js가 채움: 열릴 때 목록 새로고침, 열림 상태 알림

  const width = () => root.offsetWidth;

  function place(px, animate) {
    const w = width();
    shown = Math.max(0, Math.min(w, px));
    root.classList.toggle("animating", animate);
    backdrop.classList.toggle("animating", animate);
    root.style.transform = `translateX(${shown - w}px)`;
    backdrop.style.opacity = String(shown / w);
    const visible = shown > 0;
    backdrop.classList.toggle("on", visible);
    root.toggleAttribute("inert", !visible);
    root.setAttribute("aria-hidden", String(!visible));
  }

  function set(open) {
    if (open && !isOpen) hooks.onOpen?.();
    isOpen = open;
    place(open ? width() : 0, true);
    hooks.onChange?.(open);
  }

  /* 손가락 따라가기. direction: +1이면 오른쪽으로 쓸 때(열기), -1이면 왼쪽으로 쓸 때(닫기)만 시작 */
  function follow(down, direction) {
    const id = down.pointerId, startX = down.clientX, startY = down.clientY, startShown = shown;
    const target = down.currentTarget;
    let dragging = false, lastX = startX, lastT = performance.now(), speed = 0;

    const move = (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < START_PX && Math.abs(dy) < START_PX) return;
        if (Math.sign(dx) === direction && Math.abs(dx) > Math.abs(dy) * 1.2) {
          dragging = true;
          target.setPointerCapture?.(id);
          startDragging();
          if (direction > 0) hooks.onOpen?.();
        } else return stop(); // 위아래로 움직이면 스크롤에 맡김
      }
      e.preventDefault();
      const now = performance.now();
      speed = (e.clientX - lastX) / Math.max(1, now - lastT); // 오른쪽으로 움직이면 +
      lastX = e.clientX;
      lastT = now;
      place(startShown + dx, false);
    };
    const up = (e) => {
      if (e.pointerId !== id) return;
      stop();
      if (!dragging) return;
      suppressClick = true; // 쓸고 난 뒤 손가락 아래 버튼이 눌리지 않게
      setTimeout(() => { suppressClick = false; }, 350);
      if (performance.now() - lastT > STILL_MS) speed = 0; // 멈췄다가 놓으면 튕긴 게 아님
      set(shown + speed * FLING_MS > width() / 2);
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

  zone.addEventListener("pointerdown", (e) => { if (e.button === 0 && !isOpen) follow(e, +1); });
  root.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && !e.target.closest("input")) follow(e, -1);
  });
  for (const node of [zone, root]) {
    node.addEventListener("click", (e) => {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
    }, true);
  }
  backdrop.addEventListener("click", () => set(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen) set(false); });
  new ResizeObserver(() => place(isOpen ? width() : 0, false)).observe(root.parentElement);

  place(0, false);
  return { hooks, open: () => set(true), close: () => set(false), get isOpen() { return isOpen; } };
})();

/* speak.js — 내 말을 휴대폰이 소리 내어 읽어 주기(TTS) + 화면 가득 크게 보여주기.
 * 브라우저에 들어 있는 읽어 주기 기능(speechSynthesis)을 쓴다. 서버가 필요 없다.
 * 읽어 주기를 못 하는 브라우저에서는 supported가 false이고, 크게 보여주기만 쓴다. */
const Speaker = (() => {
  const synth = window.speechSynthesis;
  const supported = Boolean(synth && window.SpeechSynthesisUtterance);
  let voice = null;
  let current = null; // 읽는 중인 문장을 붙잡아 둔다 (아이폰에서 놓치면 "다 읽음" 알림이 안 오는 문제 방지)

  /* 한국어 목소리 고르기: 더 자연스럽고 따뜻한 "고품질 > 향상된 음성"을 먼저, 그다음 휴대폰에 들어 있는 기본 목소리.
   * 고품질·향상된 음성은 아이폰 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성 → 한국어에서 내려받아야 생긴다 */
  const quality = (v) => (/premium|고품질/i.test(v.name) ? 3 : /enhanced|향상/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0);
  function pickVoice() {
    const korean = synth.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("ko"));
    voice = korean.sort((a, b) => quality(b) - quality(a))[0] || null;
  }
  if (supported) {
    pickVoice();
    synth.addEventListener?.("voiceschanged", pickVoice); // 목소리 목록은 조금 늦게 도착할 수 있다
  }

  /* 읽기. 다 읽거나 멈추면 끝나는 약속(Promise)을 돌려준다 */
  function speak(text) {
    return new Promise((resolve) => {
      if (!supported) return resolve();
      synth.cancel(); // 읽던 것이 있으면 끊고 새로 읽는다
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR";
      if (voice) u.voice = voice;
      u.rate = 0.95; // 조금 천천히 읽으면 더 부드럽고 알아듣기 쉽다
      current = u;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        if (current === u) current = null;
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      // shortcut: 아이폰이 가끔 "다 읽음"을 안 알려줘서, 글자당 0.3초 + 3초가 지나면 끝난 걸로 본다. 설정에서 속도를 바꾸면 이 계산도 같이 바꿀 것
      const safety = setTimeout(finish, text.length * 300 + 3000);
      synth.speak(u);
    });
  }

  /* 크게 보여주기: 문장을 화면 가득 띄우고, 화면을 누르면 닫는다 */
  const big = $("big-say"), bigText = $("big-say-text");
  function showBig(text) {
    bigText.textContent = text;
    big.hidden = false;
    let size = 72; // 가장 크게 시작해서 화면에 다 들어갈 때까지 줄인다
    bigText.style.fontSize = `${size}px`;
    while (size > 24 && (bigText.scrollHeight > bigText.clientHeight || bigText.scrollWidth > bigText.clientWidth)) {
      size -= 4;
      bigText.style.fontSize = `${size}px`;
    }
    big.focus();
  }
  const hideBig = () => { big.hidden = true; };
  big.addEventListener("click", hideBig);
  big.addEventListener("keydown", (e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") hideBig(); });

  return { supported, speak, showBig, stop: () => supported && synth.cancel() };
})();

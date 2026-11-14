/* mic.js — 진짜 마이크 켜기/끄기 + 소리 크기 재기 + 서버로 보낼 소리 만들기 + 못 쓸 때 안내 화면.
 * 아이폰 Safari는 https 주소에서만, 그리고 사용자가 버튼을 누른 순간에만 마이크와 소리 장치를 켜 준다.
 * 서버(Deepgram)는 "1초에 16000번 잰 16비트 소리(linear16, 16kHz)"를 원해서, 그 모양으로 바꿔 onAudio로 넘긴다. */
const Mic = (() => {
  let ctx = null, stream = null, source = null, analyser = null, proc = null, raf = 0;
  const levelListeners = new Set();
  const audioListeners = new Set(); // 서버로 보낼 소리를 받는 곳 (api.js)
  const TARGET_RATE = 16000;
  let carry = 0;                     // 소리 덩어리 사이에서 이어지는 위치 (16kHz로 줄일 때)
  const hooks = { onRetry: null, onLost: null }; // chat.js가 채움: "다시 시도" 눌렀을 때, 마이크가 갑자기 끊겼을 때

  const guide = {
    root: $("mic-guide"), why: $("mic-guide-why"), steps: $("mic-guide-steps"),
    retry: $("mic-guide-retry"), close: $("mic-guide-close"),
  };
  /* 못 쓰는 이유별 안내 문구 */
  const REASONS = {
    denied: {
      why: "마이크 사용이 거절되어 있어요. 아래 순서로 허용해 주세요.",
      steps: [
        "Safari 주소창 왼쪽의 「가가」(aA) 버튼을 눌러요",
        "「웹 사이트 설정」 → 「마이크」를 「허용」으로 바꿔요",
        "여기로 돌아와 「다시 시도」를 눌러요",
        "그래도 안 되면: 설정 앱 → (앱 →) Safari → 마이크 → 「허용」",
      ],
    },
    insecure: {
      why: "보안 주소(https)로 열었을 때만 마이크를 쓸 수 있어요.",
      steps: ["맥에서 cloudflared가 알려 준 https://….trycloudflare.com 주소로 다시 열어 주세요"],
    },
    nodevice: { why: "마이크를 찾지 못했어요.", steps: ["이어폰이나 외부 마이크를 연결했다면 뺐다가 다시 시도해 주세요"] },
    busy: { why: "다른 앱이 마이크를 쓰고 있어요.", steps: ["통화나 녹음을 끝낸 뒤 「다시 시도」를 눌러 주세요"] },
    other: { why: "마이크를 켜지 못했어요.", steps: ["잠시 뒤 「다시 시도」를 눌러 주세요", "계속 안 되면 페이지를 새로고침해 주세요"] },
  };

  function reasonOf(err) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return "insecure";
    if (err?.name === "NotAllowedError" || err?.name === "SecurityError") return "denied";
    if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") return "nodevice";
    if (err?.name === "NotReadableError" || err?.name === "AbortError") return "busy";
    return "other";
  }

  function showGuide(reason) {
    const r = REASONS[reason] || REASONS.other;
    guide.why.textContent = r.why;
    guide.steps.replaceChildren(...r.steps.map((s) => el("li", null, s)));
    guide.retry.hidden = reason === "insecure"; // https가 아니면 다시 눌러도 소용없음
    guide.root.hidden = false;
    (guide.retry.hidden ? guide.close : guide.retry).focus();
  }
  const hideGuide = () => { guide.root.hidden = true; };
  guide.close.addEventListener("click", hideGuide);
  guide.retry.addEventListener("click", () => { hideGuide(); hooks.onRetry?.(); });

  /* 마이크 켜기. 성공하면 true. quiet가 true면 실패해도 안내 화면을 띄우지 않는다(읽어 주기 뒤 자동 재시작 때) */
  async function start({ quiet = false } = {}) {
    if (stream) return true;
    try {
      // 아이폰은 버튼을 누른 그 순간에 소리 장치를 만들어야 하므로, 허락을 기다리기 전에 먼저 만든다
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = ctx || new AC();
      const resuming = ctx.resume?.();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // 버튼을 누르지 않은 때(읽어 주기 뒤 자동 재시작)는 아이폰이 깨워 주지 않을 수 있어서 0.8초만 기다린다
      await Promise.race([resuming, new Promise((r) => setTimeout(r, 800))]);
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      // shortcut: ScriptProcessor는 오래된 방식이지만 아이폰 Safari에서 확실히 돌아서 씀. 소리가 끊기면 AudioWorklet으로 바꿀 것
      proc = ctx.createScriptProcessor(4096, 1, 1); // 48kHz면 약 0.085초마다 한 덩어리
      proc.onaudioprocess = (e) => {
        if (!audioListeners.size) return;
        const pcm = toPcm16(e.inputBuffer.getChannelData(0), ctx.sampleRate).buffer;
        audioListeners.forEach((fn) => fn(pcm));
      };
      source.connect(proc);
      proc.connect(ctx.destination); // 연결해야 돌아간다. 출력 칸은 비워 두므로 스피커로 소리가 나가지 않음
      // 전화가 오는 등으로 마이크가 끊기면 알려준다
      stream.getAudioTracks()[0]?.addEventListener("ended", () => { stop(); hooks.onLost?.(); });
      measure();
      return true;
    } catch (err) {
      stop();
      if (!quiet) showGuide(reasonOf(err));
      return false;
    }
  }

  /* 마이크 끄기: 마이크 표시등이 꺼지도록 트랙까지 완전히 멈춘다 (읽어 주기 소리가 크게 나오게) */
  function stop() {
    cancelAnimationFrame(raf);
    if (proc) { proc.onaudioprocess = null; proc.disconnect(); }
    source?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    stream = source = analyser = proc = null;
    carry = 0;
    emit(0);
  }

  /* 마이크 소리(보통 48kHz, -1~1 소수)를 16kHz, 16비트 정수로 바꾼다. 사이 값은 양옆을 비율대로 섞는다 */
  function toPcm16(input, rate) {
    const step = rate / TARGET_RATE;
    const out = new Int16Array(Math.max(0, Math.ceil((input.length - carry) / step)));
    let n = 0, pos = carry;
    for (; pos < input.length && n < out.length; pos += step) {
      const i = Math.max(0, Math.floor(pos)), f = pos - Math.floor(pos);
      const v = input[i] * (1 - f) + (input[i + 1] ?? input[i]) * f;
      out[n++] = Math.max(-1, Math.min(1, v)) * 0x7fff;
    }
    carry = pos - input.length;
    return out.subarray(0, n);
  }

  /* 소리 크기: 0(조용) ~ 1(큼). 화면이 그릴 때마다 한 번씩 잰다 */
  function measure() {
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length); // 아이폰 말소리는 대략 0.05~0.2, 조용하면 0.003쯤
      emit(Math.min(1, Math.sqrt(rms) * 2.2));
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function emit(level) { levelListeners.forEach((fn) => fn(level)); }

  /* 화면을 다른 앱으로 넘겼다가 돌아오면 멈춘 소리 장치를 다시 깨운다 */
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && stream && ctx?.state !== "running") ctx.resume?.();
  });

  return {
    hooks, start, stop,
    onLevel: (fn) => levelListeners.add(fn),
    onAudio: (fn) => { audioListeners.add(fn); return () => audioListeners.delete(fn); },
    toPcm16, // 시험용
    get isOn() { return Boolean(stream); },
  };
})();

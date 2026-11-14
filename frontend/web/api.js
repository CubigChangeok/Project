/* api.js — 진짜 서버(team_code/main.py)와 이야기하는 곳. 화면은 SoriApi의 함수만 부른다.
 *
 *   아이폰 마이크 소리 ──(웹소켓 /ws/conversation)──▶ 서버: Deepgram 받아쓰기 + 화자 번호
 *                                                     └▶ Claude(Haiku): 감정·고친 문장·핵심 단어·추천 답장, 30초마다 요약
 *   서버가 보내는 TRANSCRIPT_FAST / UTTERANCE_STYLE / CONTEXT_DEEP을 화면이 쓰는 이벤트 모양으로 바꿔 넘긴다.
 *
 * 서버에 못 붙거나 주소 끝에 ?mock을 붙이면 연습 대본(mock.js의 MockApi)으로 보여 준다 (발표 때 백업 모드).
 * 목소리 등록과 대화 모임은 아직 서버에 없어서 MockApi(휴대폰 저장)를 그대로 쓴다. */
const SoriApi = (() => {
  const WS_PATH = "/ws/conversation";
  const CONNECT_TIMEOUT_MS = 4000;
  // shortcut: Deepgram은 소리가 10초쯤 안 오면 연결을 끊어서, 듣기를 멈춘 동안 4초마다 0.1초짜리 조용한 소리를 보낸다.
  // 서버가 Deepgram KeepAlive를 직접 보내게 되면 이건 지울 것
  const KEEPALIVE_MS = 4000;
  const SILENCE = new Int16Array(1600).buffer; // 16kHz로 0.1초

  const forceMock = new URLSearchParams(location.search).has("mock") || location.protocol === "file:";
  let sock = null, sockGroup = null, handler = null, offAudio = null, keepTimer = 0;

  const timeNow = () => new Date().toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  const nameOf = (speakerId) => `화자 ${Number(speakerId) + 1}`; // 다음 단계: 사용자가 한 번 눌러 정한 이름으로 바꿈

  /* 서버 연결 (모임마다 하나). 이미 열려 있으면 그대로 쓴다. 못 붙으면 null */
  function connect(groupId) {
    if (sock && sockGroup === groupId && sock.readyState === WebSocket.OPEN) return Promise.resolve(sock);
    disconnect();
    return new Promise((resolve) => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`;
      let ws;
      try { ws = new WebSocket(url); } catch { return resolve(null); }
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => { ws.close(); resolve(null); }, CONNECT_TIMEOUT_MS);
      ws.onopen = () => { clearTimeout(timer); sock = ws; sockGroup = groupId; resolve(ws); };
      ws.onerror = () => { clearTimeout(timer); resolve(null); };
      ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (e) { console.warn("서버 메시지 읽기 실패", e); } };
      ws.onclose = () => {
        if (sock !== ws) return;
        sock = null;
        stopKeepAlive();
        if (!ws.refused) handler?.({ type: "notice", text: "서버 연결이 끊겼어요. 마이크 버튼을 눌러 다시 연결해요" });
      };
    });
  }
  function disconnect() {
    stopKeepAlive();
    offAudio?.();
    offAudio = null;
    if (sock) { const old = sock; sock = null; old.close(); }
  }
  function startKeepAlive() {
    stopKeepAlive();
    keepTimer = setInterval(() => sock?.readyState === WebSocket.OPEN && sock.send(SILENCE), KEEPALIVE_MS);
  }
  function stopKeepAlive() { clearInterval(keepTimer); keepTimer = 0; }

  /* 서버 메시지 → 화면 이벤트 */
  function handle(msg) {
    if (!handler) return;
    if (msg.type === "SERVER_ERROR") { // 서버가 준비를 못 해서 끊을 때: 이유를 그대로 보여 준다 (예: 키가 비어 있음)
      if (sock) sock.refused = true;
      return handler({ type: "notice", text: `서버를 시작하지 못했어요 — ${msg.message}` });
    }
    if (msg.type === "TRANSCRIPT_FAST") {
      const speaker = nameOf(msg.speaker_id);
      if (!msg.is_final) return handler({ type: "partial", speaker, text: msg.text });
      // 받아쓴 글자를 먼저 보여 주고, Claude 분석(style)은 1~2초 뒤에 같은 id로 덧입힌다
      return handler({
        type: "line", id: msg.utterance_id, speaker, emotion: "neutral", time: timeNow(),
        text: msg.text, raw: msg.text, keywords: [], unclear: [], corrected: false, tone: null,
      });
    }
    if (msg.type === "UTTERANCE_STYLE" && !msg.is_user) {
      handler({
        type: "style", id: msg.utterance_id, raw: msg.text, emotion: msg.emotion, text: msg.corrected_text || msg.text,
        keywords: msg.keywords || [], unclear: msg.unclear || [], corrected: Boolean(msg.corrected),
      });
      if (msg.replies?.length) handler({ type: "replies", replies: msg.replies });
      return;
    }
    if (msg.type === "CONTEXT_DEEP" && msg.summary && typeof msg.summary === "object") {
      const s = msg.summary;
      handler({
        type: "summary",
        summary: { time: timeNow(), decided: s.decided, todo: s.todo, flow: s.flow, moodText: s.mood_text, moodMix: s.mood_mix },
      });
    }
  }

  /* 듣기 시작: 서버에 붙고 마이크 소리를 보낸다. 멈추는 함수를 돌려준다.
   * 멈춰도 연결은 열어 둬서(조용한 소리로 유지), 늦게 오는 Claude 분석·요약도 받고 다시 들을 때 빠르다 */
  function listen(groupId, onEvent, opts) {
    if (forceMock) return MockApi.listen(groupId, onEvent, opts);
    let stopped = false, mockStop = null;
    handler = onEvent;
    connect(groupId).then((ws) => {
      if (stopped) return;
      if (!ws) {
        onEvent({ type: "notice", text: "서버에 연결하지 못해서 연습 대본으로 보여 줘요" });
        mockStop = MockApi.listen(groupId, onEvent, opts);
        return;
      }
      stopKeepAlive();
      offAudio?.();
      offAudio = Mic.onAudio((pcm) => ws.readyState === WebSocket.OPEN && ws.send(pcm));
    });
    return () => {
      stopped = true;
      offAudio?.();
      offAudio = null;
      mockStop?.();
      if (sock) startKeepAlive();
    };
  }

  /* 내 말: 서버의 요약에 함께 들어가게 보낸다 */
  async function sendReply(text) {
    if (sock?.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "USER_INPUT", text }));
      return { ok: true };
    }
    return MockApi.sendReply(text);
  }

  return {
    listen, sendReply,
    enroll: MockApi.enroll, listGroups: MockApi.listGroups, listPeople: MockApi.listPeople, createGroup: MockApi.createGroup,
    get usingMock() { return forceMock; },
  };
})();

/* mock.js — 가짜 백엔드 (연습 대본). 진짜 서버 연결은 api.js가 하고, 서버에 못 붙으면 이걸 쓴다
 *
 * 화면은 아래 SoriApi의 함수만 부른다.
 * 진짜 서버를 붙일 때는 이 파일만 바꾸면 된다. 함수 이름과 돌려주는 모양만 그대로 지키면 된다.
 *
 *   enroll(name, onProgress)  목소리 등록. 녹음하는 동안 onProgress({secondsLeft})를 부르고,
 *                             끝나면 {name, avatar}를 돌려준다.
 *   listGroups()              대화 모임 목록 [{id, name, members: [이름]}]
 *   listPeople()              모임에 넣을 수 있는 사람 이름 목록
 *   createGroup({name, members})  새 모임을 만들고 돌려준다.
 *   listen(groupId, onEvent, {fromStart})  그 모임의 대화 듣기 시작. 새 소식(자막, 추천 답장, 요약)이
 *                             생길 때마다 onEvent(event)를 부른다. 멈추는 함수를 돌려준다.
 *                             멈췄다 다시 부르면 이어서 듣고, fromStart가 true면 처음부터.
 *   sendReply(text)           내가 고르거나 쓴 답장을 보낸다.
 *
 * 지금은 마이크, 녹음, 서버 요청을 하나도 쓰지 않는다. 전부 타이머로 흉내 낸다.
 * 새로 만든 모임만 휴대폰(localStorage)에 저장해서 새로고침해도 남게 한다.
 */
const MockApi = (() => {
  const ENROLL_SECONDS = 8;
  const LINE_MS = 2000;   // 대본 한 줄이 올라오는 간격
  const TYPING_MS = 1200; // 말풍선이 되기 전, "인식 중" 말풍선에 글자가 찍히는 시간
  const AVATARS = ["cat", "dog", "bear", "fox"];
  const SAVED_GROUPS = "sori.mock.groups";

  /* 자주 대화하는 사람들끼리 묶은 대화 모임 */
  const DEFAULT_GROUPS = [
    { id: "exhibit", name: "전시 메이트", members: ["지민", "서준"] },
    { id: "team", name: "팀 프로젝트", members: ["민지", "준호"] },
    { id: "family", name: "우리 가족", members: ["엄마", "아빠"] },
  ];

  /* 모임별 대화 대본. 한 줄이 이벤트 하나다.
   * - 등록된 사람의 말: speaker, emotion, text
   *     keywords: 진하게 강조할 핵심 단어
   *     unclear:  잘 안 들려서 흐리게 보일 단어
   *     corrected: 문맥으로 고친 단어가 있으면 true
   *     tone: 말투 (예: "빠르게 · 크게"), 없으면 null
   *     replies: 이 말 다음에 추천할 답장 (없으면 이전 추천 유지)
   *     summary: 이 말 다음에 새로 만든 요약 (SUMMARIES 이름)
   * - 모르는 사람의 말: stranger: true (화면에서는 숨기고 개수만 보여준다)
   * emotion은 neutral, happy, surprised, angry, sad, fear, disgust 중 하나다.
   */
  const SCRIPTS = {
    exhibit: [
      { speaker: "지민", emotion: "neutral", time: "오후 3:12", text: "우리 이번 주말에 시간 돼?", keywords: ["주말"],
        replies: ["응, 시간 돼!", "토요일은 괜찮아", "왜? 무슨 일 있어?"] },
      { speaker: "서준", emotion: "neutral", time: "오후 3:12", text: "응, 토요일은 비어 있어. 왜?", keywords: ["토요일"] },
      { speaker: "지민", emotion: "happy", time: "오후 3:12", text: "어제 말한 그 전시 있잖아, 같이 갈래?", keywords: ["전시"], tone: "높은 톤",
        replies: ["좋아, 나도 갈래!", "그 전시 뭐였지?", "나도 끼워 줘"], summary: "invite" },
      { speaker: "서준", emotion: "surprised", time: "오후 3:13", text: "헐, 그거 예매 엄청 힘들다던데?", keywords: ["예매"], tone: "빠르게 · 크게" },
      { stranger: true, text: "아메리카노 두 잔 나왔습니다" },
      { stranger: true, text: "여기 진동벨 가져가세요" },
      { stranger: true, text: "와 오늘 사람 진짜 많다" },
      { speaker: "지민", emotion: "happy", time: "오후 3:13", text: "내가 벌써 두 장 잡아 뒀지!", keywords: ["두 장"],
        replies: ["대박, 고마워!", "나 표 값 보낼게", "역시 지민이 최고"], summary: "tickets" },
      { speaker: "서준", emotion: "sad", time: "오후 3:13", text: "근데 나 오전엔 알바가 있어서…", keywords: ["알바"], tone: "느리게 · 작게" },
      { speaker: "서준", emotion: "happy", time: "오후 3:14", text: "좋아! 토요일 오후 어때?", keywords: ["토요일 오후"],
        replies: ["토요일 오후 좋아", "몇 시쯤?", "나는 일요일이 더 편해"] },
      { speaker: "지민", emotion: "neutral", time: "오후 3:14", text: "그럼 두 시에 성수역에서 볼까?", keywords: ["두 시"], unclear: ["성수역"], corrected: true,
        replies: ["좋아, 두 시에 보자!", "조금 늦을 수도 있어", "끝나고 밥도 먹을래?"], summary: "final" },
    ],
    team: [
      { speaker: "민지", emotion: "neutral", time: "오후 2:04", text: "다들 왔지? 그럼 시작하자.", keywords: ["시작"],
        replies: ["응, 시작하자", "잠깐만, 자료 열게", "나 5분만 늦어"] },
      { speaker: "준호", emotion: "happy", time: "오후 2:04", text: "저번 발표 피드백 진짜 좋았대요!", keywords: ["피드백"], tone: "높은 톤", summary: "teamFeedback" },
      { speaker: "민지", emotion: "surprised", time: "오후 2:05", text: "진짜? 교수님이 직접?", keywords: ["교수님"],
        replies: ["대박, 다행이다", "뭐라고 하셨어?", "다들 고생했어"] },
      { stranger: true, text: "주문하신 음료 나왔습니다" },
      { speaker: "준호", emotion: "angry", time: "오후 2:07", text: "아 맞다, 서버 또 터졌어요. 진짜 짜증나네", keywords: ["서버"], tone: "빠르게 · 크게",
        replies: ["내가 같이 볼게", "언제부터 그랬어?", "오늘 안에 고칠 수 있어?"] },
      { speaker: "민지", emotion: "neutral", time: "오후 2:08", text: "그럼 오늘 밤까지 다시 배포하자", keywords: ["오늘 밤"], unclear: ["배포"],
        replies: ["좋아, 밤에 같이 하자", "나는 내일 오전에 볼게", "필요한 거 있으면 말해"], summary: "teamDeploy" },
    ],
    family: [
      { speaker: "엄마", emotion: "neutral", time: "오후 6:20", text: "오늘 저녁 뭐 먹을래?", keywords: ["저녁"],
        replies: ["아무거나 좋아", "김치찌개!", "밖에서 먹을까?"] },
      { speaker: "아빠", emotion: "happy", time: "오후 6:20", text: "오랜만에 삼겹살 어때?", keywords: ["삼겹살"], summary: "familyMenu" },
      { speaker: "엄마", emotion: "happy", time: "오후 6:21", text: "좋다, 그럼 일곱 시에 나가자", keywords: ["일곱 시"],
        replies: ["좋아, 일곱 시!", "나 조금 늦게 갈게", "내가 예약할게"], summary: "familyTime" },
    ],
  };

  /* 대본이 없는 새 모임에서 쓰는 짧은 대본 (첫 번째 사람이 말함) */
  const genericScript = (speaker) => [
    { speaker, emotion: "happy", time: "지금", text: "안녕! 오늘 무슨 이야기 할까?", keywords: ["오늘"],
      replies: ["안녕! 반가워", "요즘 어떻게 지내?", "할 얘기 있어"] },
    { speaker, emotion: "neutral", time: "지금", text: "이 모임은 아직 연습용 대본이에요", keywords: ["연습용"] },
  ];

  /* 대화가 쌓이면서 바뀌는 요약. moodMix는 대화 중 감정 비율(합 100) */
  const SUMMARIES = {
    invite: {
      time: "오후 3:12", decided: ["아직 정한 것은 없어요"], todo: "",
      flow: "지민이 이번 주말에 전시를 같이 보자고 했어요.",
      moodText: "가볍고 설레는 분위기예요",
      moodMix: [{ emotion: "neutral", percent: 65 }, { emotion: "happy", percent: 35 }],
    },
    tickets: {
      time: "오후 3:13", decided: ["토요일에 함께 전시 보기"], todo: "지민 · 전시 표 두 장 챙기기",
      flow: "예매가 어렵다던 표를 지민이 이미 두 장 구했어요.",
      moodText: "예매 소식에 다들 신났어요",
      moodMix: [{ emotion: "happy", percent: 45 }, { emotion: "neutral", percent: 35 }, { emotion: "surprised", percent: 20 }],
    },
    final: {
      time: "오후 3:14", decided: ["토요일 오후 두 시,", "성수역에서 만나 전시 보기"], todo: "지민 · 전시 표 두 장 챙기기",
      flow: "서준은 오전에 알바가 있어서 오후로 정했어요. 만날 곳은 성수역이에요.",
      moodText: "둘 다 들떠 있어요",
      moodMix: [{ emotion: "happy", percent: 45 }, { emotion: "neutral", percent: 30 }, { emotion: "surprised", percent: 15 }, { emotion: "sad", percent: 10 }],
    },
    teamFeedback: {
      time: "오후 2:04", decided: ["아직 정한 것은 없어요"], todo: "",
      flow: "지난 발표에 대해 교수님이 좋은 피드백을 주셨다는 소식을 나눴어요.",
      moodText: "밝은 분위기예요",
      moodMix: [{ emotion: "happy", percent: 50 }, { emotion: "neutral", percent: 50 }],
    },
    teamDeploy: {
      time: "오후 2:08", decided: ["오늘 밤까지 서버 다시 배포하기"], todo: "준호 · 오늘 밤 서버 재배포",
      flow: "서버 장애가 다시 생겨서 오늘 밤에 다시 배포하기로 했어요.",
      moodText: "대체로 차분했지만, 서버 이야기에서 준호가 급해졌어요",
      moodMix: [{ emotion: "neutral", percent: 40 }, { emotion: "happy", percent: 25 }, { emotion: "surprised", percent: 15 }, { emotion: "angry", percent: 20 }],
    },
    familyMenu: {
      time: "오후 6:20", decided: ["아직 정한 것은 없어요"], todo: "",
      flow: "저녁 메뉴로 아빠가 삼겹살을 골랐어요.",
      moodText: "편안한 분위기예요",
      moodMix: [{ emotion: "neutral", percent: 50 }, { emotion: "happy", percent: 50 }],
    },
    familyTime: {
      time: "오후 6:21", decided: ["오늘 저녁 일곱 시에 삼겹살 먹으러 나가기"], todo: "",
      flow: "메뉴는 삼겹살, 나가는 시간은 일곱 시로 정했어요.",
      moodText: "다들 기분 좋아요",
      moodMix: [{ emotion: "happy", percent: 70 }, { emotion: "neutral", percent: 30 }],
    },
  };

  const people = [];          // 목소리를 등록한 사람 [{name, avatar}]
  const sent = [];            // 보낸 답장
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function savedGroups() {
    try { return JSON.parse(localStorage.getItem(SAVED_GROUPS)) || []; } catch { return []; }
  }
  const allGroups = () => [...DEFAULT_GROUPS, ...savedGroups()];

  /* 아바타: 모임 안에서 몇 번째 사람인지에 따라 고양이, 강아지, 곰, 여우 */
  function avatarOf(name, group) {
    const enrolled = people.find((p) => p.name === name);
    if (enrolled) return enrolled.avatar;
    const i = group ? group.members.indexOf(name) : -1;
    return AVATARS[(i >= 0 ? i : 2) % AVATARS.length];
  }

  async function enroll(name, onProgress) {
    for (let left = ENROLL_SECONDS; left > 0; left--) {
      onProgress({ secondsLeft: left });
      await wait(1000);
    }
    onProgress({ secondsLeft: 0 });
    const person = { name, avatar: AVATARS[people.length % AVATARS.length] };
    people.push(person);
    return person;
  }

  async function listGroups() {
    return allGroups().map((g) => ({ ...g, members: [...g.members] }));
  }

  async function listPeople() {
    const names = [...people.map((p) => p.name), ...allGroups().flatMap((g) => g.members)];
    return [...new Set(names)];
  }

  async function createGroup({ name, members = [] }) {
    const group = { id: `g${Date.now()}`, name, members };
    try { localStorage.setItem(SAVED_GROUPS, JSON.stringify([...savedGroups(), group])); } catch { /* 저장 못 해도 이번엔 사용 */ }
    return group;
  }

  /* onEvent로 오는 이벤트:
   *   {type: "partial", speaker, avatar, text}  인식 중인 글자 (점점 길어짐)
   *   {type: "line", id, speaker, avatar, emotion, time, text, keywords, unclear, corrected, tone}
   *   {type: "stranger", id, text}               모르는 사람의 말
   *   {type: "replies", replies: [문장, 문장, 문장]}  추천 답장이 바뀜
   *   {type: "summary", summary: {time, decided: [줄], todo, flow, moodText, moodMix}}  요약이 바뀜
   *   {type: "end"}                               대본 끝
   */
  const progress = {}; // 모임마다 대본을 몇 번째 줄까지 말했는지 (멈췄다 다시 들으면 이어서)

  function listen(groupId, onEvent, { fromStart = false } = {}) {
    let stopped = false;
    const timers = [];
    const later = (ms, fn) => timers.push(setTimeout(() => !stopped && fn(), ms));
    const group = allGroups().find((g) => g.id === groupId);
    const script = SCRIPTS[groupId] || genericScript(group?.members[0] || "대화 상대");
    if (fromStart) progress[groupId] = 0;
    const first = progress[groupId] || 0;
    const done = (i) => { progress[groupId] = i + 1; };

    script.forEach((row, i) => {
      if (i < first) return; // 이미 말한 줄은 건너뜀
      const start = (i - first) * LINE_MS;
      if (row.stranger) {
        later(start + LINE_MS, () => { done(i); onEvent({ type: "stranger", id: i, text: row.text }); });
        return;
      }
      const avatar = avatarOf(row.speaker, group);
      const steps = 12;
      for (let s = 1; s <= steps; s++) {
        const cut = Math.ceil((row.text.length * s) / steps);
        later(start + (TYPING_MS * s) / steps, () =>
          onEvent({ type: "partial", speaker: row.speaker, avatar, text: row.text.slice(0, cut) }));
      }
      const { replies, summary, ...line } = row;
      // 말풍선·추천 답장·요약을 한 번에 보내고 "이 줄 끝"으로 기록 (중간에 멈춰도 두 번 나오지 않게)
      later(start + LINE_MS, () => {
        done(i);
        onEvent({ type: "line", id: i, avatar, keywords: [], unclear: [], corrected: false, tone: null, ...line });
        if (replies) onEvent({ type: "replies", replies });
        if (summary) onEvent({ type: "summary", summary: SUMMARIES[summary] });
      });
    });
    later((script.length - first) * LINE_MS + 300, () => onEvent({ type: "end" }));

    return () => { stopped = true; timers.forEach(clearTimeout); };
  }

  async function sendReply(text) {
    await wait(250);
    sent.push(text);
    return { ok: true };
  }

  return { enroll, listGroups, listPeople, createGroup, listen, sendReply };
})();

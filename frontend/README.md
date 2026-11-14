# 소리 — 청각장애인을 위한 대화 자막 앱

시끄러운 곳에서도 대화 상대의 말을 실시간 자막으로 보여 주고, 감정·문맥 교정·추천 답장·요약까지 함께 보여 주는 웹앱입니다.
아이폰 Safari에서 열어 쓰도록 만들었습니다. (해커톤 출품작)

## 할 수 있는 것
| 기능 | 설명 |
|---|---|
| 실시간 자막 | 아이폰 마이크 소리를 서버로 보내 Deepgram이 받아쓰고, 말한 사람을 "화자 1, 2…"로 나눕니다 |
| 감정 · 문맥 교정 | 문장마다 AI(Gemini 또는 Claude)가 감정 7가지를 고르고, 잘못 받아쓴 단어를 문맥으로 고칩니다 (예: "배 포" → "배포") |
| 핵심 단어 · 흐린 단어 | 중요한 단어는 진하게, 잘 안 들려 확신이 낮은 단어는 흐리게 표시합니다 |
| 추천 답장 | 상대 말에 맞는 짧은 답장 3개를 칩으로 보여 주고, 누르면 휴대폰이 소리 내어 읽어 줍니다 |
| 말하기 · 크게 보기 | 입력한 문장을 휴대폰이 읽어 주고(읽는 동안 마이크는 꺼짐), 화면 가득 크게 보여 줄 수도 있습니다 |
| 요약창 | 아래에서 위로 쓸어 올리면 "정한 것 · 할 일 · 흐름 · 분위기 · 감정 비율"이 나옵니다 (대화 중 자동 갱신) |
| 대화 모임 | 자주 대화하는 사람들끼리 모임을 만들고, 모임마다 대화 기록을 따로 둡니다 |
| 설정 | 왼쪽에서 오른쪽으로 쓸면 나옵니다. 자막 표시 방식(기본 · 설명형 · 비유형), 글자 크기, 감정 표시 등 |
| 연습 대본 모드 | 서버에 연결하지 못하거나 주소 끝에 `?mock`을 붙이면 미리 만든 대화로 보여 줍니다 (발표 백업용) |

## 폴더 구조
```
web/                  아이폰 화면 (빌드 없이 바로 쓰는 HTML · CSS · JavaScript)
  index.html          화면 뼈대
  style.css           꾸밈 (살구·분홍 색, 둥근 카드)
  api.js              진짜 서버와 이야기하는 곳 (못 붙으면 mock.js로)
  mock.js             연습 대본 (가짜 서버)
  chat.js             대화 화면 · 대화 모임
  mic.js              마이크 켜기 · 소리 크기 · 16kHz 소리로 바꾸기 · 권한 안내
  speak.js            읽어 주기(TTS) · 크게 보기
  sheet.js            아래에서 올라오는 요약창
  drawer.js           왼쪽에서 나오는 설정 서랍
  settings.js         설정 저장 · 적용
  app.js              공통 도구 · 탭 · 목소리 등록 화면
server/               서버 (Python · FastAPI)
  main.py             웹소켓 /ws/conversation + web/ 화면 함께 제공
  services/stt_service.py      Deepgram 실시간 받아쓰기 · 화자 나누기
  services/summary_service.py  AI(Gemini 또는 Claude): 문장 분석 · 누적 요약
  .env.example        키 견본
design/reference.png  디자인 기준 그림
```

## 실행 방법 (맥 기준)

### 1. 준비 (처음 한 번)
```bash
cd server
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
open -e .env        # 키를 넣고 저장
```

### 2. 키 넣기 (`server/.env`)
| 이름 | 어디서 | 비고 |
|---|---|---|
| `DEEPGRAM_API_KEY` | [console.deepgram.com](https://console.deepgram.com) → API Keys | 받아쓰기에 꼭 필요 |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API key | 무료 등급으로 시작 가능 (분당·하루 요청 수 제한 있음) |
| `ANTHROPIC_API_KEY` | [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) | API 크레딧 필요. 있으면 Gemini 대신 Claude(Haiku)를 씀 |

AI 키는 Gemini와 Claude 중 하나만 있으면 됩니다. 키가 없거나 틀리면 앱 화면에 이유가 표시됩니다.

### 3. 서버 켜기
```bash
cd server
.venv/bin/python main.py
```
`Uvicorn running on http://127.0.0.1:8080`이 보이면 정상입니다.

### 4. 아이폰에서 열기
아이폰 Safari는 **https 주소에서만** 마이크를 허락하므로, 다른 터미널 창에서 터널을 엽니다.
```bash
cloudflared tunnel --url http://localhost:8080
```
나오는 `https://….trycloudflare.com` 주소를 아이폰 Safari에서 엽니다 → **대화** 탭 → **듣기 시작**.

- 키 없이 화면만 보려면 주소 끝에 `?mock`을 붙입니다.
- 컴퓨터에서는 `http://127.0.0.1:8080`으로 열어도 됩니다.

## 서버 ↔ 화면 약속 (웹소켓 `/ws/conversation`)
- 화면 → 서버: 마이크 소리(16kHz · 16비트 · 모노, 약 0.1초 덩어리), 내가 쓴 말 `{"type": "USER_INPUT", "text": "…"}`
- 서버 → 화면:
  - `TRANSCRIPT_FAST`: 받아쓴 글자 (`is_final`, `utterance_id`, `speaker_id`, 더 긴 확정본으로 고칠 때 `revised`)
  - `UTTERANCE_STYLE`: 같은 `utterance_id`의 AI 분석 (`emotion`, `corrected_text`, `keywords`, `unclear`, `replies`)
  - `CONTEXT_DEEP`: 누적 요약 (`summary`: `decided`, `todo`, `flow`, `mood_text`, `mood_mix`)
  - `SERVER_ERROR`: 서버를 준비하지 못한 이유 (예: 키 없음)

## 아직 남은 것
- 화자 이름 붙이기: 지금은 "화자 1, 2"로 보이고, 한 번 눌러 이름을 정하는 기능을 만들 예정
- 목소리 지문으로 등록한 사람 알아보기 (등록 화면은 아직 연습용)
- 처음 실행 안내(온보딩), 홈 화면 설치(PWA), 화면 꺼짐 방지
- 읽어 주는 목소리를 더 자연스러운 목소리로 바꾸기

## 참고
- 감정·요약 AI 모델: Gemini `gemini-3.5-flash-lite` / Claude `claude-haiku-5-5`
- Gemini 무료 등급으로 보낸 대화는 Google이 서비스 개선에 쓸 수 있습니다.
- 목소리 녹음 파일과 `.env`(키)는 저장소에 올리지 않습니다 (`.gitignore`).

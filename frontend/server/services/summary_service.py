'''''
import os
import asyncio
from datetime import datetime
from google import genai
from google.genai import types
from google.genai.errors import APIError

class HybridSummaryService:
    def __init__(self, broadcast_callback):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.")
        
        self.client = genai.Client(api_key=api_key)
        self.broadcast_callback = broadcast_callback
        
        self.conversation_logs = []
        self.unsummarized_count = 0
        self.last_summary_time = datetime.now()
        self.last_speech_time = datetime.now()
        self.latest_summary = "대화가 시작되었습니다."
        self.is_summarizing = False

    def add_message(self, speaker: str, text: str, emotion: str = "중립", is_user_input: bool = False):
        now = datetime.now()
        self.conversation_logs.append({
            "speaker": speaker,
            "text": text,
            "emotion": emotion,
            "time": now.strftime("%H:%M:%S"),
            "is_user": is_user_input
        })
        self.unsummarized_count += 1
        self.last_speech_time = now

    async def start_monitoring_loop(self):
        while True:
            await asyncio.sleep(1)
            await self._check_trigger_conditions()

    async def _check_trigger_conditions(self):
        if self.is_summarizing or not self.conversation_logs:
            return

        now = datetime.now()
        time_elapsed = (now - self.last_summary_time).total_seconds()
        silence_duration = (now - self.last_speech_time).total_seconds()
        last_was_user = self.conversation_logs[-1]["is_user"]

        # 트리거 규칙 3가지
        normal_trigger = (time_elapsed >= 30 and self.unsummarized_count >= 3 and silence_duration >= 2.0)
        max_time_trigger = (time_elapsed >= 45 and silence_duration >= 1.5)
        user_priority_trigger = (last_was_user and time_elapsed >= 15 and silence_duration >= 1.5)

        if normal_trigger or max_time_trigger or user_priority_trigger:
            await self._run_gemini_summary()

    async def _run_gemini_summary(self):
        self.is_summarizing = True
        try:
            recent_logs_text = "\n".join([
                f"[{log['speaker']} ({log['time']}) | 감정: {log['emotion']}]: {log['text']}"
                for log in self.conversation_logs[-15:]
            ])

            prompt = f"""
당신은 청각장애인을 위한 실시간 대화 보조 AI입니다.
음성 인식 결과와 청각장애인 사용자의 직접 입력 텍스트가 섞인 대화 로그를 읽고 핵심을 요약하세요.

[이전 맥락 요약]:
{self.latest_summary}

[최근 대화 로그]:
{recent_logs_text}

[작성 지침]:
1. 청각장애인 사용자가 흐름을 놓치지 않도록 '현재 핵심 주제'와 '결정 사항/다음 행동'을 명확히 정리하세요.
2. 발화자들의 전반적인 분위기와 감정선(동의, 장난, 긴장 등)을 짧게 녹여내세요.
3. 2~3문장 이내의 간결하고 명확한 존댓말로 작성하세요.
"""
            config = types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=250
            )

            # 1차 시도: 3.0 / 3.5 모델
            try:
                response = await self.client.aio.models.generate_content(
                    model="gemini-3.5-flash-lite",
                    contents=prompt,
                    config=config
                )
            # 503(서버 과부하) 또는 404(모델 미지원) 발생 시 2.0-flash로 즉시 Fallback
            except APIError as e:
                if e.code in [404, 503]:
                    print(f"[{e.code} 에러 발생] gemini-2.0-flash로 자동 전환합니다: {e.message}")
                    response = await self.client.aio.models.generate_content(
                        model="gemini-2.0-flash",
                        contents=prompt,
                        config=config
                    )
                else:
                    raise e

            updated_summary = response.text.strip()
            self.latest_summary = updated_summary
            self.last_summary_time = datetime.now()
            self.unsummarized_count = 0

            await self.broadcast_callback({
                "type": "CONTEXT_DEEP",
                "summary": updated_summary,
                "timestamp": self.last_summary_time.strftime("%H:%M:%S")
            })

        except Exception as e:
            print(f"[Gemini Summary Error] {e}")
        finally:
            self.is_summarizing = False
            '''
import os
import asyncio
from datetime import datetime
from typing import Literal
from pydantic import BaseModel
import anthropic

# AI 고르기: ANTHROPIC_API_KEY가 있으면 Claude, 없고 GEMINI_API_KEY만 있으면 Gemini (무료 등급으로 시작 가능).
# .env에 AI_PROVIDER=gemini 또는 AI_PROVIDER=claude를 쓰면 직접 정할 수 있다.
# 문장마다 부르므로 빠르고 싼 모델을 쓴다. (Haiku는 거절됐을 때 서버가 다른 모델로 다시 해 주는 기능이 없다)
CLAUDE_MODEL = "claude-haiku-5-5"
GEMINI_MODEL = "gemini-3.5-flash-lite"  # 팀원이 쓰던 모델. 무료 등급 한도가 비교적 넉넉한 편
# 화면(web/)이 쓰는 감정 7가지와 같은 이름
Emotion = Literal["neutral", "happy", "surprised", "angry", "sad", "fear", "disgust"]
RECENT_LINES = 6  # 문맥 교정·추천 답장에 함께 보여 줄 바로 앞 대화 줄 수


# 1. 문장 하나에 대해 Claude에게 한 번에 받는 것 (정해진 JSON 모양)
class UtteranceInsight(BaseModel):
    emotion: Emotion
    corrected_text: str   # 받아쓰기를 문맥으로 고친 문장 (고칠 게 없으면 원문 그대로)
    keywords: list[str]   # corrected_text 안의 핵심 단어 0~2개
    unclear: list[str]    # corrected_text 안에서 여전히 확신이 낮은 단어 0~2개
    replies: list[str]    # 사용자가 바로 보낼 수 있는 짧은 답장 3개


# 2. 30초쯤마다 받는 누적 요약
class MoodShare(BaseModel):
    emotion: Emotion
    percent: int


class DeepSummary(BaseModel):
    decided: list[str]    # 지금까지 정한 것 (줄 단위)
    todo: str             # "이름 · 할 일" 하나, 없으면 빈 글자
    flow: str             # 지금 흐름 1~2문장
    mood_text: str        # 분위기 한 줄
    mood_mix: list[MoodShare]


# 3. 화자별 고정 캐릭터와 감정별 표정 (팀원이 만든 앱 화면용으로 남겨 둠)
AVATAR_SET = ["cat", "dog", "bear", "fox"]
EMOTION_FACE_MAP = {
    "cat": {"neutral": "🐱", "happy": "😺", "surprised": "🙀", "angry": "😾", "sad": "😿", "fear": "🙀", "disgust": "😼"},
    "dog": {"neutral": "🐶", "happy": "🐶", "surprised": "😲", "angry": "😠", "sad": "🥺", "fear": "😨", "disgust": "🤢"},
    "bear": {"neutral": "🐻", "happy": "🐻", "surprised": "😮", "angry": "😤", "sad": "😢", "fear": "😰", "disgust": "😖"},
    "fox": {"neutral": "🦊", "happy": "🦊", "surprised": "😱", "angry": "😡", "sad": "😥", "fear": "😨", "disgust": "🤢"},
}


def _pick_provider() -> str:
    """어느 AI를 쓸지 정한다. 키가 하나도 없으면 이유를 담아 멈춘다 (화면에 그대로 보여 줌)"""
    wanted = os.getenv("AI_PROVIDER", "").strip().lower()
    has = {"claude": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()), "gemini": bool(os.getenv("GEMINI_API_KEY", "").strip())}
    if wanted in has:
        if not has[wanted]:
            key = "ANTHROPIC_API_KEY" if wanted == "claude" else "GEMINI_API_KEY"
            raise ValueError(f"AI_PROVIDER={wanted}인데 {key}가 비어 있어요. team_code/.env를 확인해 주세요.")
        return wanted
    if has["claude"]:
        return "claude"
    if has["gemini"]:
        return "gemini"
    raise ValueError("AI 키가 없어요. team_code/.env에 GEMINI_API_KEY(무료로 시작 가능) 또는 ANTHROPIC_API_KEY를 넣어 주세요.")


def _only_inside(words, text, limit=2):
    """Claude가 고른 단어 중 문장 안에 실제로 있는 것만 남긴다 (화면이 그 자리를 찾아 강조하므로)"""
    return [w.strip() for w in words if w.strip() and w.strip() in text][:limit]


class HybridSummaryService:
    def __init__(self, broadcast_callback):
        self.provider = _pick_provider()
        if self.provider == "claude":
            self.client = anthropic.AsyncAnthropic()  # .env의 ANTHROPIC_API_KEY를 자동으로 읽음
        else:
            from google import genai
            self.client = genai.Client(api_key=os.getenv("GEMINI_API_KEY", "").strip())
        print(f"[+] 감정·요약 AI: {self.provider} ({CLAUDE_MODEL if self.provider == 'claude' else GEMINI_MODEL})")
        self.broadcast_callback = broadcast_callback

        # 화자별 프로필 매핑 상태 {speaker_id: "cat"}
        self.speaker_profiles: dict[int, str] = {}

        # 누적 요약 상태 변수
        self.conversation_logs = []
        self.last_summarized_idx = 0
        self.last_summary_time = datetime.now()
        self.last_speech_time = datetime.now()
        self.latest_summary: DeepSummary | None = None
        self.is_summarizing = False

    async def _ask(self, prompt: str, schema, max_tokens: int):
        """AI에게 묻고 답을 schema 모양(JSON)으로 받는다. 거절되면 None. 오류는 부른 쪽에서 처리"""
        if self.provider == "claude":
            response = await self.client.messages.parse(
                model=CLAUDE_MODEL,
                max_tokens=max_tokens,            # 생각하는 데 쓰는 글자까지 넉넉하게
                output_config={"effort": "low"},  # 짧은 분류·요약 작업이라 빨리 답하게
                output_format=schema,             # 답을 schema 모양(JSON)으로만 받도록 강제
                messages=[{"role": "user", "content": prompt}],
            )
            return response.parsed_output if response.stop_reason != "refusal" else None
        from google.genai import types
        response = await self.client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,           # 팀원 코드와 같은 방식: 답을 schema 모양으로 받기
                max_output_tokens=max_tokens,
            ),
        )
        parsed = response.parsed
        if isinstance(parsed, schema):
            return parsed
        return schema.model_validate_json(response.text) if response.text else None

    def get_avatar_type(self, speaker_id: int) -> str:
        """화자 ID에 고유 캐릭터 아바타 영구 할당"""
        if speaker_id not in self.speaker_profiles:
            assigned = AVATAR_SET[len(self.speaker_profiles) % len(AVATAR_SET)]
            self.speaker_profiles[speaker_id] = assigned
        return self.speaker_profiles[speaker_id]

    def get_default_emoji(self, speaker_id: int) -> str:
        """STT 중간 자막(is_final=False) 표시용 기본 프로필 이모지 반환"""
        avatar = self.get_avatar_type(speaker_id)
        return EMOTION_FACE_MAP[avatar]["neutral"]

    async def analyze_and_record_utterance(self, speaker_id: int, text: str, is_user_input: bool = False,
                                           utterance_id: int | None = None):
        """
        [기능 1] 확정된 문장 하나를 Claude에게 보내 감정 · 고친 문장 · 핵심 단어 · 확신 낮은 단어 ·
        추천 답장을 한 번에 받아 화면으로 보내고, 누적 요약용 로그에 쌓는다.
        사용자가 직접 쓴 말은 Claude에게 묻지 않고 로그에만 쌓는다 (비용·시간 절약).
        """
        avatar = self.get_avatar_type(speaker_id)
        speaker_label = "사용자(직접입력)" if is_user_input else f"화자 {speaker_id + 1}"
        insight = UtteranceInsight(emotion="neutral", corrected_text=text, keywords=[], unclear=[], replies=[])

        if not is_user_input:
            recent = "\n".join(f"{l['speaker']}: {l['text']}" for l in self.conversation_logs[-RECENT_LINES:]) or "(없음)"
            prompt = f"""당신은 청각장애인의 대화를 돕는 실시간 자막 도우미입니다.
음성 인식으로 받아쓴 새 문장을 아래 기준으로 분석해 주세요.

[바로 앞 대화]
{recent}

[새 문장 - {speaker_label}]
{text}

[기준]
1. emotion: 말한 사람의 감정. neutral, happy, surprised, angry, sad, fear, disgust 중 하나.
2. corrected_text: 앞뒤 문맥으로 볼 때 잘못 받아쓴 단어만 고친 문장. 고칠 것이 없으면 새 문장을 그대로 쓰세요. 뜻을 바꾸거나 문장을 다듬지 마세요.
3. keywords: corrected_text 안에 글자 그대로 들어 있는 가장 중요한 단어 0~2개.
4. unclear: corrected_text 안에 글자 그대로 들어 있는 단어 중, 잘못 들었을 가능성이 높아 확신이 낮은 단어 0~2개. 없으면 빈 목록.
5. replies: 청각장애인 사용자가 이 말에 바로 보낼 수 있는 짧고 자연스러운 답장 3개. 각각 20자 이내, 대화의 말투(반말/존댓말)에 맞추세요."""
            try:
                insight = await self._ask(prompt, UtteranceInsight, max_tokens=2048) or insight
            except Exception as e:  # 예: 무료 한도(분당 요청 수) 초과 → 이 문장은 분석 없이 자막만
                print(f"[{self.provider} 문장 분석 오류] {e}")

        corrected = insight.corrected_text.strip() or text
        keywords = _only_inside(insight.keywords, corrected)
        unclear = [w for w in _only_inside(insight.unclear, corrected) if w not in keywords]
        replies = [r.strip() for r in insight.replies if r.strip()][:3]
        emoji = EMOTION_FACE_MAP[avatar].get(insight.emotion, EMOTION_FACE_MAP[avatar]["neutral"])

        # 1) 누적 요약용 로그에 분석된 감정까지 포함해 적재 (고친 문장 기준)
        now = datetime.now()
        self.conversation_logs.append({
            "speaker": speaker_label,
            "text": corrected,
            "emotion": insight.emotion,
            "time": now.strftime("%H:%M:%S"),
            "is_user": is_user_input
        })
        self.last_speech_time = now

        # 2) 화면으로 전송: utterance_id로 어느 말풍선 정보인지 알려 준다
        await self.broadcast_callback({
            "type": "UTTERANCE_STYLE",
            "utterance_id": utterance_id,
            "speaker_id": speaker_id,
            "speaker_label": speaker_label,
            "is_user": is_user_input,
            "avatar_type": avatar,
            "emoji": emoji,
            "emotion": insight.emotion,
            "text": text,
            "corrected_text": corrected,
            "corrected": corrected != text,
            "keywords": keywords,
            "unclear": unclear,
            "replies": replies,
            "timestamp": now.strftime("%H:%M:%S")
        })

    async def start_monitoring_loop(self):
        while True:
            await asyncio.sleep(1)
            await self._check_trigger_conditions()

    async def _check_trigger_conditions(self):
        unsummarized_count = len(self.conversation_logs) - self.last_summarized_idx
        if self.is_summarizing or unsummarized_count == 0:
            return

        now = datetime.now()
        time_elapsed = (now - self.last_summary_time).total_seconds()
        silence_duration = (now - self.last_speech_time).total_seconds()
        last_was_user = self.conversation_logs[-1]["is_user"]

        normal_trigger = (time_elapsed >= 30 and unsummarized_count >= 3 and silence_duration >= 2.0)
        max_time_trigger = (time_elapsed >= 45 and silence_duration >= 1.5)
        user_priority_trigger = (last_was_user and time_elapsed >= 15 and silence_duration >= 1.5)

        if normal_trigger or max_time_trigger or user_priority_trigger:
            await self._run_claude_summary()

    async def _run_claude_summary(self):
        """[기능 2] 초반 결정 사항 유실 없이 새 대화만 점진적으로 병합하는 누적 요약 (칸이 나뉜 모양으로 받음)"""
        self.is_summarizing = True
        try:
            target_idx = len(self.conversation_logs)
            new_logs = self.conversation_logs[self.last_summarized_idx:target_idx]
            context_bridge = self.conversation_logs[max(0, self.last_summarized_idx - 2):self.last_summarized_idx]

            bridge_text = "\n".join([f"[이전 참고 - {l['speaker']}]: {l['text']}" for l in context_bridge])
            new_logs_text = "\n".join([
                f"[{l['speaker']} ({l['time']}) | 감정: {l['emotion']}]: {l['text']}"
                for l in new_logs
            ])
            previous = self.latest_summary.model_dump_json() if self.latest_summary else "없음 (첫 요약)"

            prompt = f"""당신은 청각장애인을 위한 실시간 대화 보조 AI입니다.
[이전 누적 요약]을 바탕으로 [새로 추가된 대화]를 통합하여 전체 맥락을 갱신하세요.

[이전 누적 요약]:
{previous}

[직전 대화 연결용]:
{bridge_text if bridge_text else "없음"}

[새로 추가된 대화]:
{new_logs_text}

[작성 지침] 모두 짧은 존댓말로 쓰세요.
- decided: 대화 처음부터 지금까지 확정된 합의·결정을 유실 없이 유지하며 새 내용을 병합. 한 줄에 하나, 최대 3줄. 없으면 ["아직 정한 것은 없어요"].
- todo: 누가 무엇을 하기로 했는지 "이름 · 할 일" 한 개. 없으면 빈 글자.
- flow: 방금 오간 대화의 핵심 주제를 1~2문장으로.
- mood_text: 화자들의 분위기·감정선을 한 줄로.
- mood_mix: 지금까지 대화의 감정 비율. neutral, happy, surprised, angry, sad, fear, disgust 중 나온 것만, percent 합이 100."""
            s = await self._ask(prompt, DeepSummary, max_tokens=4096)
            if not s:
                return  # 거절되거나 모양이 틀리면 이전 요약을 그대로 두고 다음 기회에 다시 요약

            mix = [m for m in s.mood_mix if m.percent > 0]
            total = sum(m.percent for m in mix) or 1
            mix = [MoodShare(emotion=m.emotion, percent=round(m.percent * 100 / total)) for m in mix]  # 합을 100으로
            s = DeepSummary(decided=[d for d in s.decided if d.strip()][:3] or ["아직 정한 것은 없어요"],
                            todo=s.todo.strip(), flow=s.flow.strip(), mood_text=s.mood_text.strip(), mood_mix=mix)
            self.latest_summary = s
            self.last_summarized_idx = target_idx
            self.last_summary_time = datetime.now()

            await self.broadcast_callback({
                "type": "CONTEXT_DEEP",
                "summary": s.model_dump(),
                # 팀원이 만든 앱 화면은 글자 요약을 쓰므로 함께 보낸다
                "summary_text": f"• 누적 핵심/결정: {' '.join(s.decided)}\n• 현재 흐름: {s.flow}",
                "timestamp": self.last_summary_time.strftime("%H:%M:%S")
            })

        except Exception as e:
            print(f"[{self.provider} 요약 오류] {e}")
        finally:
            self.is_summarizing = False

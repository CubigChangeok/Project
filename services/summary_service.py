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
from google import genai
from google.genai import types
from google.genai.errors import APIError

# 1. 개별 발화 스타일링용 JSON 출력 스키마
class UtteranceStyle(BaseModel):
    emotion: Literal["neutral", "happy", "laughing", "sad", "angry", "surprised", "thinking"]
    keywords: list[str]

# 2. 화자별 고정 캐릭터 및 감정별 동적 표정 매핑
AVATAR_SET = ["cat", "dog", "bear", "fox"]
EMOTION_FACE_MAP = {
    "cat": {"neutral": "🐱", "happy": "😺", "laughing": "😹", "sad": "😿", "angry": "😾", "surprised": "🙀", "thinking": "🐱"},
    "dog": {"neutral": "🐶", "happy": "🐶", "laughing": "😆", "sad": "🥺", "angry": "😠", "surprised": "😲", "thinking": "🤔"},
    "bear": {"neutral": "🐻", "happy": "🐻", "laughing": "😄", "sad": "😢", "angry": "😤", "surprised": "😮", "thinking": "🧐"},
    "fox": {"neutral": "🦊", "happy": "🦊", "laughing": "😆", "sad": "😥", "angry": "😡", "surprised": "😱", "thinking": "🤔"},
}

class HybridSummaryService:
    def __init__(self, broadcast_callback):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.")
        
        self.client = genai.Client(api_key=api_key)
        self.broadcast_callback = broadcast_callback
        
        # 화자별 프로필 매핑 상태 {speaker_id: "cat"}
        self.speaker_profiles: dict[int, str] = {}
        
        # 누적 요약 상태 변수
        self.conversation_logs = []
        self.last_summarized_idx = 0
        self.last_summary_time = datetime.now()
        self.last_speech_time = datetime.now()
        self.latest_summary = "• 누적 핵심/결정: 아직 결정된 사항이 없습니다.\n• 현재 흐름: 대화가 시작되었습니다."
        self.is_summarizing = False

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

    async def analyze_and_record_utterance(self, speaker_id: int, text: str, is_user_input: bool = False):
        """
        [기능 1] 확정된 발화(is_final=True)에서 감정 이모지 & 강조 단어를 추출해 즉시 전송하고,
        동시에 누적 요약용 로그에 감정과 함께 적재합니다.
        """
        avatar = self.get_avatar_type(speaker_id)
        speaker_label = "사용자(직접입력)" if is_user_input else f"화자 {speaker_id + 1}"

        prompt = f"발화 문장: '{text}'\n이 문장의 감정 상태(emotion)와 맥락상 가장 중요한 핵심 단어(keywords, 최대 2개)를 추출하세요."
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=UtteranceStyle,
            temperature=0.1,
        )

        emotion = "neutral"
        keywords = []

        try:
            response = await self.client.aio.models.generate_content(
                model="gemini-3.5-flash-lite",
                contents=prompt,
                config=config
            )
            style_data = UtteranceStyle.model_validate_json(response.text)
            emotion = style_data.emotion
            keywords = style_data.keywords
        except APIError as e:
            if e.code in [404, 503]:
                response = await self.client.aio.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=prompt,
                    config=config
                )
                style_data = UtteranceStyle.model_validate_json(response.text)
                emotion = style_data.emotion
                keywords = style_data.keywords
        except Exception as e:
            print(f"[Emotion/Keyword Error] {e}")

        emoji = EMOTION_FACE_MAP[avatar][emotion]

        # 1) 누적 요약용 로그에 분석된 감정까지 포함해 적재
        now = datetime.now()
        self.conversation_logs.append({
            "speaker": speaker_label,
            "text": text,
            "emotion": emotion,
            "time": now.strftime("%H:%M:%S"),
            "is_user": is_user_input
        })
        self.last_speech_time = now

        # 2) 프론트엔드로 화자 아바타 표정 변경 + 강조 단어 패킷 즉시 전송
        await self.broadcast_callback({
            "type": "UTTERANCE_STYLE",
            "speaker_id": speaker_id,
            "speaker_label": speaker_label,
            "avatar_type": avatar,
            "emoji": emoji,
            "emotion": emotion,
            "text": text,
            "keywords": keywords,
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
            await self._run_gemini_summary()

    async def _run_gemini_summary(self):
        """[기능 2] 초반 결정 사항 유실 없이 새 대화만 점진적으로 병합하는 누적 요약"""
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

            prompt = f"""
당신은 청각장애인을 위한 실시간 대화 보조 AI입니다.
[이전 누적 요약]을 바탕으로 [새로 추가된 대화]를 통합하여 전체 맥락을 갱신하세요.

[이전 누적 요약]:
{self.latest_summary}

[직전 대화 연결용]:
{bridge_text if bridge_text else "없음"}

[새로 추가된 대화]:
{new_logs_text}

[작성 지침]:
1. 반드시 아래 두 항목의 형식을 유지하여 존댓말로 작성하세요.
2. '누적 핵심/결정'에는 대화 처음부터 지금까지 확정된 합의, 주요 논점, 다음 행동을 유실 없이 유지하며 새 내용을 병합하세요.
3. '현재 흐름'에는 방금 오간 대화의 핵심 주제와 화자들의 분위기/감정선을 1~2문장으로 요약하세요.

[출력 형식]:
• 누적 핵심/결정: (여기에 작성)
• 현재 흐름: (여기에 작성)
"""
            config = types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=400
            )

            try:
                response = await self.client.aio.models.generate_content(
                    model="gemini-3.5-flash-lite",
                    contents=prompt,
                    config=config
                )
            except APIError as e:
                if e.code in [404, 503]:
                    response = await self.client.aio.models.generate_content(
                        model="gemini-2.0-flash",
                        contents=prompt,
                        config=config
                    )
                else:
                    raise e

            updated_summary = response.text.strip()
            self.latest_summary = updated_summary
            self.last_summarized_idx = target_idx
            self.last_summary_time = datetime.now()

            await self.broadcast_callback({
                "type": "CONTEXT_DEEP",
                "summary": updated_summary,
                "timestamp": self.last_summary_time.strftime("%H:%M:%S")
            })

        except Exception as e:
            print(f"[Gemini Summary Error] {e}")
        finally:
            self.is_summarizing = False
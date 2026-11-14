'''''
import os
import asyncio
import ssl
import certifi
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)

class DeepgramSTTService:
    def __init__(self, on_transcript_callback, silence_timeout: float = 1.2):
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            raise ValueError("DEEPGRAM_API_KEY 환경 변수가 설정되지 않았습니다.")

        # [핵심] certifi 인증서 경로를 명시한 SSL 컨텍스트 또는 ClientOptions 지정
        # Deepgram SDK v3에서는 ClientOptions 또는 환경 변수로 CA 경로를 주입합니다.
        os.environ["SSL_CERT_FILE"] = certifi.where()
        os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()
        os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()

        # 깔끔하게 기본 Client로 초기화 (환경 변수 경로를 자동으로 참조함)
        self.client = DeepgramClient(api_key)
        self.dg_connection = None
        self.on_transcript_callback = on_transcript_callback
        
        # 타임아웃 방어 상태 변수
        self.silence_timeout = silence_timeout
        self.last_interim_text = ""
        self.timeout_task: asyncio.Task | None = None

    async def start(self):
        self.dg_connection = self.client.listen.asyncwebsocket.v("1")

        # [수정] self_handler 제거, 가변 인자로 안전하게 result 추출
        async def on_message(*args, **kwargs):
            try:
                # SDK 버전에 따라 positional 또는 keyword로 들어오는 result 안전 추출
                result = kwargs.get("result") or (args[1] if len(args) > 1 else (args[0] if args else None))
                if not result:
                    return

                sentence = result.channel.alternatives[0].transcript
                if not sentence or not sentence.strip():
                    return

                is_final = getattr(result, "is_final", False)
                print(f"🔥 [STT 인식 성공] {sentence.strip()} (확정: {is_final})")
                await self._handle_transcript(sentence.strip(), is_final)
            except Exception as e:
                print(f"[x] on_message 내부 에러: {e}")

        # [수정] 에러 콜백도 가변 인자로 안전하게 수신
        async def on_error(*args, **kwargs):
            err = kwargs.get("error") or (args[1] if len(args) > 1 else (args[0] if args else None))
            print(f"[Deepgram Error] {err}")

        self.dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
        self.dg_connection.on(LiveTranscriptionEvents.Error, on_error)

        options = LiveOptions(
            model="nova-2",
            language="ko",
            smart_format=True,
            interim_results=True,
            endpointing=400,        # 400ms 침묵 시 모델 단에서 is_final 강제 발행
            encoding="linear16",
            sample_rate=16000,
            channels=1
        )
        started = await self.dg_connection.start(options)
        if not started:
            print("[x] Deepgram 연결 시작 실패 (LiveOptions 확인 필요)")
        else:
            print("[+] Deepgram Live Connection 정상 가동 중")

    async def _handle_transcript(self, text: str, is_final: bool):
        self.last_interim_text = text

        if self.timeout_task and not self.timeout_task.done():
            self.timeout_task.cancel()

        if is_final:
            self.last_interim_text = ""
            await self.on_transcript_callback(text, True)
        else:
            await self.on_transcript_callback(text, False)
            self.timeout_task = asyncio.create_task(self._wait_for_silence())

    async def _wait_for_silence(self):
        try:
            await asyncio.sleep(self.silence_timeout)
            if self.last_interim_text:
                forced_text = self.last_interim_text
                self.last_interim_text = ""
                # 1.2초간 모델이 침묵하면 마지막 중간 텍스트를 강제 확정
                await self.on_transcript_callback(forced_text, True)
        except asyncio.CancelledError:
            pass

    async def send_audio(self, audio_chunk: bytes):
        if self.dg_connection:
            await self.dg_connection.send(audio_chunk)

    async def stop(self):
        if self.timeout_task and not self.timeout_task.done():
            self.timeout_task.cancel()

        if self.last_interim_text:
            await self.on_transcript_callback(self.last_interim_text, True)
            self.last_interim_text = ""

        if self.dg_connection:
            await self.dg_connection.finish()
            '''''

import os
import asyncio
import certifi
from collections import Counter
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)


def _letters(t: str) -> str:
    """띄어쓰기·문장부호를 뺀 글자만"""
    return "".join(ch for ch in t if ch.isalnum())


def _same_sentence(a: str, b: str) -> bool:
    """띄어쓰기·문장부호를 빼고 비교해서, 같거나 한쪽이 다른 쪽의 앞부분이면 같은 문장으로 본다"""
    x, y = _letters(a), _letters(b)
    return bool(x) and bool(y) and (x == y or x.startswith(y) or y.startswith(x))

class DeepgramSTTService:
    def __init__(self, on_transcript_callback, silence_timeout: float = 1.2):
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            raise ValueError("DEEPGRAM_API_KEY 환경 변수가 설정되지 않았습니다.")

        os.environ["SSL_CERT_FILE"] = certifi.where()
        os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()
        os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()

        self.client = DeepgramClient(api_key)
        self.dg_connection = None
        # 콜백 시그니처: async def callback(speaker_id: int, text: str, is_final: bool)
        self.on_transcript_callback = on_transcript_callback
        
        self.silence_timeout = silence_timeout
        self.last_interim_text = ""
        self.last_interim_speaker = 0  # 타임아웃 강제 확정 시 화자 번호 유지용
        self.timeout_task: asyncio.Task | None = None

    def _extract_speaker(self, alternative) -> int:
        """단어별 speaker 태그 중 최빈값으로 현재 문장의 주 화자 ID를 추출"""
        words = getattr(alternative, "words", []) or []
        speakers = [
            getattr(w, "speaker", None)
            for w in words
            if getattr(w, "speaker", None) is not None
        ]
        if not speakers:
            return 0
        return Counter(speakers).most_common(1)[0][0]

    async def start(self):
        self.dg_connection = self.client.listen.asyncwebsocket.v("1")

        async def on_message(*args, **kwargs):
            try:
                result = kwargs.get("result") or (args[1] if len(args) > 1 else (args[0] if args else None))
                if not result:
                    return

                alternative = result.channel.alternatives[0]
                sentence = alternative.transcript
                if not sentence or not sentence.strip():
                    return

                is_final = getattr(result, "is_final", False)
                speaker_id = self._extract_speaker(alternative)

                print(f"🔥 [STT 인식] 화자 {speaker_id} | {sentence.strip()} (확정: {is_final})")
                await self._handle_transcript(speaker_id, sentence.strip(), is_final)
            except Exception as e:
                print(f"[x] on_message 내부 에러: {e}")

        async def on_error(*args, **kwargs):
            err = kwargs.get("error") or (args[1] if len(args) > 1 else (args[0] if args else None))
            print(f"[Deepgram Error] {err}")

        self.dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
        self.dg_connection.on(LiveTranscriptionEvents.Error, on_error)

        options = LiveOptions(
            model="nova-2",
            language="ko",
            smart_format=True,
            diarize=True,           # [추가] 실시간 다중 화자 분리 활성화
            interim_results=True,
            endpointing=400,
            encoding="linear16",
            sample_rate=16000,
            channels=1
        )
        started = await self.dg_connection.start(options)
        if not started:
            raise RuntimeError("Deepgram에 연결하지 못했어요. DEEPGRAM_API_KEY가 맞는지, 크레딧이 남았는지 확인해 주세요")
        else:
            print("[+] Deepgram Live Connection 정상 가동 중 (화자 분리 ON)")

    async def _handle_transcript(self, speaker_id: int, text: str, is_final: bool):
        # 조용해서 먼저 강제로 확정해 보낸 문장을 Deepgram이 늦게 다시 보낼 때 (같은 말풍선이 두 번 생기지 않게):
        #  - 같은 문장이면 버리고, 늦게 온 쪽이 더 길면(예: "진짜 짜증" → "진짜 짜증나네요") 앞서 보낸 말풍선을 고쳐 보낸다
        forced = getattr(self, "forced_text", "")
        if forced and _same_sentence(text, forced):
            if not is_final:
                return
            self.forced_text = ""
            if len(_letters(text)) > len(_letters(forced)):
                await self.on_transcript_callback(speaker_id, text, True, revise=True)
            return
        self.forced_text = ""

        self.last_interim_text = text
        self.last_interim_speaker = speaker_id

        if self.timeout_task and not self.timeout_task.done():
            self.timeout_task.cancel()

        if is_final:
            self.last_interim_text = ""
            await self.on_transcript_callback(speaker_id, text, True)
        else:
            await self.on_transcript_callback(speaker_id, text, False)
            self.timeout_task = asyncio.create_task(self._wait_for_silence())

    async def _wait_for_silence(self):
        try:
            await asyncio.sleep(self.silence_timeout)
            if self.last_interim_text:
                forced_text = self.last_interim_text
                forced_speaker = self.last_interim_speaker
                self.last_interim_text = ""
                self.forced_text = forced_text  # 나중에 같은 문장이 확정으로 또 오면 버리려고 기억
                await self.on_transcript_callback(forced_speaker, forced_text, True)
        except asyncio.CancelledError:
            pass

    async def send_audio(self, audio_chunk: bytes):
        if self.dg_connection:
            await self.dg_connection.send(audio_chunk)

    async def stop(self):
        if self.timeout_task and not self.timeout_task.done():
            self.timeout_task.cancel()

        if self.last_interim_text:
            await self.on_transcript_callback(self.last_interim_speaker, self.last_interim_text, True)
            self.last_interim_text = ""

        if self.dg_connection:
            await self.dg_connection.finish()
'''''
import asyncio
import json
import sys
import numpy as np
import sounddevice as sd
import websockets

print("[1] 라이브러리 로드 완료")

SERVER_URI = "ws://127.0.0.1:8000/ws/conversation"
RATE = 16000
BLOCKSIZE = 1024

async def main():
    print("[2] main() 비동기 루프 진입")
    try:
        print(f"[3] 서버 연결 시도 중... ({SERVER_URI})")
        async with websockets.connect(SERVER_URI) as ws:
            print("[+] WebSocket 연결 성공!")

            loop = asyncio.get_running_loop()
            audio_queue = asyncio.Queue()

            def audio_callback(indata, frames, time, status):
                if status:
                    print(f"[!] Audio Status: {status}", file=sys.stderr)
                
                volume_norm = np.linalg.norm(indata) * 10
                if volume_norm > 1.5:  # 소리가 들어올 때만 게이지 출력
                  bar = "█" * int(min(volume_norm, 30))
                  print(f"🎤 [Mic Signal] {bar} ({volume_norm:.1f})")

                pcm_bytes = (indata * 32767).astype(np.int16).tobytes()
                loop.call_soon_threadsafe(audio_queue.put_nowait, pcm_bytes)

            async def send_audio():
                while True:
                    data = await audio_queue.get()
                    await ws.send(data)

            async def receive_events():
                async for message in ws:
                    event = json.loads(message)
                    etype = event.get("type")
                    if etype == "TRANSCRIPT_FAST":
                        status = "[확정]" if event.get("is_final") else "[인식중]"
                        print(f"🎤 {status} {event.get('text', '')}")
                    elif "SUMMARY" in etype or etype == "CONTEXT_DEEP":
                        print("\n" + "=" * 55)
                        print(f"🤖 [Gemini 요약]:\n{json.dumps(event, indent=2, ensure_ascii=False)}")
                        print("=" * 55 + "\n")
                    else:
                        print(f"📩 [서버]: {event}")

            print("[4] 마이크 입력 스트림 여는 중...")
            with sd.InputStream(
                samplerate=RATE,
                channels=1,
                dtype="float32",
                blocksize=BLOCKSIZE,
                callback=audio_callback
            ):
                print("[*] 마이크 활성화 완료! 한국어로 말씀해 보세요.")
                await asyncio.gather(send_audio(), receive_events())

    except Exception as e:
        print(f"[x] 에러 발생: {e}")

if __name__ == "__main__":
    print("[0] 프로그램 시작")
    asyncio.run(main())
    '''

import asyncio
import json
import sys
import numpy as np
import sounddevice as sd
import websockets

SERVER_URI = "ws://127.0.0.1:8000/ws/conversation"
RATE = 16000
BLOCKSIZE = 1024

def highlight_keywords(text: str, keywords: list[str]) -> str:
    highlighted = text
    for kw in keywords:
        if kw and kw in highlighted:
            highlighted = highlighted.replace(kw, f"【 {kw} 】")
    return highlighted

async def main():
    try:
        async with websockets.connect(SERVER_URI) as ws:
            loop = asyncio.get_running_loop()
            audio_queue = asyncio.Queue()

            def audio_callback(indata, frames, time, status):
                if status:
                    print(f"[!] Audio Status: {status}", file=sys.stderr)
                pcm_bytes = (indata * 32767).astype(np.int16).tobytes()
                loop.call_soon_threadsafe(audio_queue.put_nowait, pcm_bytes)

            async def send_audio():
                while True:
                    data = await audio_queue.get()
                    await ws.send(data)

            async def receive_events():
                async for message in ws:
                    event = json.loads(message)
                    etype = event.get("type")

                    # 최종 감정 이모지 + 핵심 단어 강조가 완료된 문장만 출력
                    if etype == "UTTERANCE_STYLE":
                        speaker = event.get("speaker_label", "화자")
                        emoji = event.get("emoji", "🗣️")
                        emotion = event.get("emotion", "neutral")
                        text = event.get("text", "")
                        keywords = event.get("keywords", [])
                        styled_text = highlight_keywords(text, keywords)
                        print(f"{emoji} {speaker} ({emotion}): {styled_text}")

                    # 누적 대화 맥락 요약 출력
                    elif etype == "CONTEXT_DEEP":
                        print("\n" + "=" * 55)
                        print(f"🤖 [Gemini 누적 요약] ({event.get('timestamp', '')}):")
                        print(event.get("summary", ""))
                        print("=" * 55 + "\n")

            with sd.InputStream(
                samplerate=RATE,
                channels=1,
                dtype="float32",
                blocksize=BLOCKSIZE,
                callback=audio_callback
            ):
                print("[*] 마이크 활성화 완료! 한국어로 말씀해 보세요.\n")
                await asyncio.gather(send_audio(), receive_events())

    except Exception as e:
        print(f"[x] 에러 발생: {e}")

if __name__ == "__main__":
    asyncio.run(main())
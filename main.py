'''''
import os
import json
import asyncio
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from services.stt_service import DeepgramSTTService
from services.summary_service import HybridSummaryService

load_dotenv()
app = FastAPI(title="Deaf Accessibility AI Assistant")

@app.websocket("/ws/conversation")
async def conversation_endpoint(websocket: WebSocket):
    await websocket.accept()

    # 1. 클라이언트로 JSON을 쏘는 공통 브로드캐스트 함수
    async def broadcast_to_client(data: dict):
        await websocket.send_json(data)

    # 2. 요약 서비스 인스턴스 생성 및 모니터링 루프 가동
    summary_service = HybridSummaryService(broadcast_callback=broadcast_to_client)
    summary_task = asyncio.create_task(summary_service.start_monitoring_loop())

    # 3. STT 결과 처리 콜백
    async def handle_stt_result(text: str, is_final: bool):
        # 실시간 자막 전송 (Fast Layer)
        await websocket.send_json({
            "type": "TRANSCRIPT_FAST",
            "speaker_id": "speaker_other",
            "speaker_name": "상대방",
            "text": text,
            "is_final": is_final
        })

        # 확정 문장은 요약 버퍼에 누적 (추후 팀원의 감정/화자 모듈 교체 가능)
        if is_final:
            summary_service.add_message(
                speaker="상대방",
                text=text,
                emotion="중립",
                is_user_input=False
            )

    # 4. Deepgram STT 서비스 초기화 및 시작
    stt_service = DeepgramSTTService(on_transcript_callback=handle_stt_result)
    await stt_service.start()

    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                print("[*] 클라이언트 연결 종료 요청 수신")
                break

            # 분기 A: 마이크 오디오 바이너리 수신
            if "bytes" in message and message["bytes"]:
                await stt_service.send_audio(message["bytes"])

            # 분기 B: 청각장애인 키보드 텍스트 입력 수신
            # main.py의 "elif 'text' in message and message['text']:" 내부

            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    msg_type = payload.get("type")

                    # [추가] 헬스체크용 ping 요청에 즉각 응답
                    if msg_type == "ping":
                        await websocket.send_json({"type": "pong", "status": "alive"})

                    elif msg_type == "USER_INPUT":
                        user_text = payload.get("text", "").strip()
                        if user_text:
                            summary_service.add_message(
                                speaker="나 (사용자)",
                                text=user_text,
                                emotion="중립",
                                is_user_input=True
                            )
                            await websocket.send_json({
                                "type": "USER_INPUT_ECHO",
                                "speaker_id": "speaker_me",
                                "text": user_text
                            })
                except json.JSONDecodeError:
                    pass

    except (WebSocketDisconnect, Exception) as e:
        print("[WebSocket] 클라이언트 연결 종료")
    finally:
        summary_task.cancel()
        await stt_service.stop()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
    '''
import os
import json
import asyncio
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from services.stt_service import DeepgramSTTService
from services.summary_service import HybridSummaryService

load_dotenv()
app = FastAPI(title="Deaf Accessibility AI Assistant")

@app.websocket("/ws/conversation")
async def conversation_endpoint(websocket: WebSocket):
    await websocket.accept()

    async def broadcast_to_client(data: dict):
        await websocket.send_json(data)

    summary_service = HybridSummaryService(broadcast_callback=broadcast_to_client)
    summary_task = asyncio.create_task(summary_service.start_monitoring_loop())

    # [수정] speaker_id를 함께 받도록 변경
    async def handle_stt_result(speaker_id: int, text: str, is_final: bool):
        avatar_type = summary_service.get_avatar_type(speaker_id)
        default_emoji = summary_service.get_default_emoji(speaker_id)

        # 1. 실시간 자막 즉시 전송 (Fast Layer - 기본 프로필 이모지 포함)
        await websocket.send_json({
            "type": "TRANSCRIPT_FAST",
            "speaker_id": speaker_id,
            "speaker_name": f"화자 {speaker_id + 1}",
            "avatar_type": avatar_type,
            "emoji": default_emoji,
            "text": text,
            "is_final": is_final
        })

        # 2. 문장 확정 시 비동기로 감정 이모지 + 핵심 단어 추출 및 요약 로그 적재
        if is_final:
            asyncio.create_task(
                summary_service.analyze_and_record_utterance(
                    speaker_id=speaker_id,
                    text=text,
                    is_user_input=False
                )
            )

    stt_service = DeepgramSTTService(on_transcript_callback=handle_stt_result)
    await stt_service.start()

    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                print("[*] 클라이언트 연결 종료 요청 수신")
                break

            if "bytes" in message and message["bytes"]:
                await stt_service.send_audio(message["bytes"])

            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    msg_type = payload.get("type")

                    if msg_type == "ping":
                        await websocket.send_json({"type": "pong", "status": "alive"})

                    elif msg_type == "USER_INPUT":
                        user_text = payload.get("text", "").strip()
                        if user_text:
                            await websocket.send_json({
                                "type": "USER_INPUT_ECHO",
                                "speaker_id": "speaker_me",
                                "text": user_text
                            })
                            # [수정] 사용자 직접 입력도 감정 분석 및 누적 요약에 반영
                            asyncio.create_task(
                                summary_service.analyze_and_record_utterance(
                                    speaker_id=99,  # 사용자 고유 ID 구분
                                    text=user_text,
                                    is_user_input=True
                                )
                            )
                except json.JSONDecodeError:
                    pass

    except (WebSocketDisconnect, Exception) as e:
        print(f"[*] 웹소켓 세션 종료: {e}")
    finally:
        summary_task.cancel()
        await stt_service.stop()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
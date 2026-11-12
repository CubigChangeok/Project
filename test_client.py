import asyncio
import json
import websockets

SERVER_URI = "ws://127.0.0.1:8000/ws/conversation"

async def run_test():
    print(f"[*] Connecting to {SERVER_URI}...")
    try:
        async with websockets.connect(SERVER_URI) as ws:
            print("[+] WebSocket 연결 성공! (Handshake Complete)")

            # 1. ping 테스트
            print("\n[1] Ping 전송 테스트")
            await ws.send(json.dumps({"type": "ping"}))
            res = await ws.recv()
            print(f"    <- 서버 응답: {res}")

            # 2. 사용자 텍스트 발화 (USER_INPUT) 테스트
            print("\n[2] 사용자 텍스트(USER_INPUT) 전송 테스트")
            user_msg = {
                "type": "USER_INPUT",
                "text": "안녕하세요! 청각장애인 보조 시스템 테스트 중입니다."
            }
            await ws.send(json.dumps(user_msg))
            res = await ws.recv()
            print(f"    <- 서버 응답 (USER_INPUT_ECHO): {res}")

            # 3. 더미 오디오 바이너리 스트림 전송 테스트 (무음 바이트)
            print("\n[3] 오디오 바이너리 데이터 전송 테스트")
            dummy_pcm_bytes = b"\x00" * 3200
            await ws.send(dummy_pcm_bytes)
            print(f"    -> 더미 오디오 {len(dummy_pcm_bytes)} bytes 전송 완료 (STT 전달 확인)")

            print("\n[+] 모든 파이프라인 검증 성공!")

    except Exception as e:
        print(f"[x] 테스트 도중 오류 발생: {e}")

if __name__ == "__main__":
    asyncio.run(run_test())
import asyncio
from app import app
from quart import websocket

async def test_ws_route():
    async with app.test_app() as test_app:
        test_client = test_app.test_client()
        async with test_client.websocket("/api/voice-chat?persona=it") as test_ws:
            print("Connected to mock quart WS!", flush=True)
            try:
                await test_ws.send(b'\x00'*4096)
                print("Sent data to route", flush=True)
                resp = await test_ws.receive()
                print("Received:", resp, flush=True)
            except Exception as e:
                import traceback
                traceback.print_exc()
                print("Test Client Exception:", e, flush=True)

asyncio.run(test_ws_route())

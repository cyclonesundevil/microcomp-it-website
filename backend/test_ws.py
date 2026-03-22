import asyncio
import websockets

async def test_ws():
    uri = "ws://localhost:5000/api/voice-chat"
    try:
        async with websockets.connect(uri) as ws:
            print("Connected to WebSocket!")
            await ws.send(b'\x00\x00')
            print("Sent test audio bytes")
            response = await ws.recv()
            print(f"Received response of length {len(response)}")
    except Exception as e:
        print(f"Connection failed: {e}")

asyncio.run(test_ws())

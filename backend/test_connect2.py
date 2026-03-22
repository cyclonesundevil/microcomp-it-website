import asyncio
import websockets

async def test():
    try:
        uri = "ws://127.0.0.1:5000/api/voice-chat"
        print(f"Connecting to {uri}...")
        async with websockets.connect(uri) as ws:
            print("Connected to main server!")
            await ws.send(b'test')
            print("Sent test byte")
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(test())

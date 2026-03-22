import asyncio
import websockets

async def test():
    try:
        async with websockets.connect('ws://127.0.0.1:5001/api/voice-chat') as ws:
            print("Connected!")
            print(await ws.recv())
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(test())

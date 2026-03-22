import asyncio
import websockets
import time

async def test():
    try:
        async with websockets.connect("ws://127.0.0.1:5000/api/voice-chat?persona=it") as ws:
            print("Connected")
            # Send 4096 bytes of zeroes mimicking PCM data
            dummy_audio = b'\x00' * 4096
            await ws.send(dummy_audio)
            print("Sent audio bytes")
            # Keep receiving until close
            while True:
                response = await ws.recv()
                print("Received snippet of length", len(response))
    except websockets.exceptions.ConnectionClosed as e:
        print(f"Connection closed: {e.code} ({e.reason})")
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(test())

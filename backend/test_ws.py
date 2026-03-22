import asyncio
import websockets
import time

async def test_voice_greeting():
    uri = "ws://localhost:5000/api/voice-chat?persona=it"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected! Waiting up to 10 seconds for audio chunks to stream automatically...")
            
            # Since the backend immediately prompts the model with "end_of_turn=True",
            # the Gemini SDK should start sending LiveServerMessage responses with audio parts back over the websocket
            # which our app.py backend forwards as bytes (pcm data) to the frontend.
            
            audio_chunks_received = 0
            start_time = time.time()
            
            while time.time() - start_time < 10:
                try:
                    # Wait for a message with a 10s timeout
                    message = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                    if isinstance(message, bytes):
                        audio_chunks_received += 1
                        print(f"[{time.time()-start_time:.1f}s] Received audio chunk ({len(message)} bytes)")
                        if audio_chunks_received >= 5:
                            print("SUCCESS: Received at least 5 audio chunks automatically without us sending any audio or text!")
                            return
                except asyncio.TimeoutError:
                    print("Timeout waiting for audio.")
                    break
            
            print(f"Result: Received {audio_chunks_received} audio chunks.")
            if audio_chunks_received == 0:
                print("FAILURE: Did not receive automated audio greeting.")
            
    except Exception as e:
        print(f"Connection error: {e}")

if __name__ == "__main__":
    asyncio.run(test_voice_greeting())

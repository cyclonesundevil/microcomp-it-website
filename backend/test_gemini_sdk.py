import os
import asyncio
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

async def test_live():
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part.from_text(text="Test")]),
    )
    print("Connecting to Gemini Live...")
    try:
        async with client.aio.live.connect(model='models/gemini-2.5-flash-native-audio-latest', config=config) as session:
            print("Connected!")
            # Send audio
            print("Sending audio...")
            try:
                dummy_audio = b'\x00' * 4096
                await session.send(input=types.LiveClientRealtimeInput(
                    media_chunks=[types.Blob(data=dummy_audio, mime_type="audio/pcm;rate=16000")]
                ))
                print("Audio sent successfully.")
            except Exception as e:
                import traceback
                traceback.print_exc()
                print("Error sending text:", e)
                
            # Wait for response
            print("Waiting for response...")
            async for response in session.receive():
                print("Got response chunk")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Live API error: {e}")

asyncio.run(test_live())

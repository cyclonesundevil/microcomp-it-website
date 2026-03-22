import os
import asyncio
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

async def test_live():
    # Testing default client API
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"]
    )
    
    models_to_test = ["gemini-2.0-flash", "models/gemini-2.5-flash-native-audio-latest", "gemini-2.0-flash-exp"]
    
    for model in models_to_test:
        try:
            async with client.aio.live.connect(model=model, config=config) as session:
                print(f"SUCCESS connecting to {model} via v1alpha")
        except Exception:
            pass

asyncio.run(test_live())

import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

print("Looking for all Gemini models...")
for model in client.models.list():
    print(f"Model: {model.name}")
    print(f"  Methods: {model.supported_generation_methods}")

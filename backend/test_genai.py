from google import genai
from google.genai import types
import os
from dotenv import load_dotenv

load_dotenv()

def test_tool(msg: str) -> str:
    """Test tool"""
    return "Tool called with: " + msg

try:
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    config = types.GenerateContentConfig(
        system_instruction="Test system prompt",
        temperature=0.7,
        tools=[test_tool]
    )
    
    contents = [
        types.Content(role="user", parts=[types.Part.from_text(text="Hello")])
    ]
    
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=contents,
        config=config
    )
    print("SUCCESS")
    print(response.text)
except Exception as e:
    import traceback
    traceback.print_exc()

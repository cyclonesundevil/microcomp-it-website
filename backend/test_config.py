from google.genai import types

def dummy_tool(x: int) -> int:
    return x

try:
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part.from_text(text="hello")]),
        tools=[dummy_tool]
    )
    print("Success")
except Exception as e:
    import traceback
    traceback.print_exc()
    print("Failed")

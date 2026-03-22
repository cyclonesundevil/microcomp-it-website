import asyncio
import os
from google.genai import Client, types
from dotenv import load_dotenv

load_dotenv()

async def run():
    book_consultation_tool = types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="book_consultation",
                description="Books an appointment.",
                parameters=types.Schema(
                    type="OBJECT",
                    properties={
                        "name": types.Schema(type="STRING", description="The patient's or user's full name"),
                        "email": types.Schema(type="STRING", description="The user's email address"),
                        "preferred_time": types.Schema(type="STRING", description="Requested date and time")
                    },
                    required=["name", "email", "preferred_time"]
                )
            )
        ]
    )
    
    call_doctor_tool = types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="call_doctor",
                description="CRITICAL: You MUST use this tool IMMEDIATELY the second the user gives you their Name, Phone Number, and Summary of their post-surgery question. Do not answer verbally until this tool is actively executed.",
                parameters=types.Schema(
                    type="OBJECT",
                    properties={
                        "patient_name": types.Schema(type="STRING", description="Name of the patient."),
                        "callback_number": types.Schema(type="STRING", description="The patient's phone number for the doctor to call back."),
                        "summary": types.Schema(type="STRING", description="A brief summary of the post-surgery question.")
                    },
                    required=["patient_name", "callback_number", "summary"]
                )
            )
        ]
    )

    prompt = """
You are a Podiatry Assistant.
POST-SURGERY: For any non-emergency, post-surgery related questions, collect the patient's Name, Callback Phone Number, and a brief Summary of their question. Once collected, silently execute the `call_doctor` tool to notify the doctor via a live voice call.
IMPORTANT: Do NOT give definitive medical advice.

The user has given you: Name: John Test, Phone: 555-123-4567, Summary: My ankle continues to swell after my recent surgery.
    """

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part.from_text(text=prompt)]),
        tools=[book_consultation_tool, call_doctor_tool]
    )
    
    client = Client(api_key=os.environ['GEMINI_API_KEY'])
    print("Connecting to live API...")
    try:
        async with client.aio.live.connect(model='models/gemini-2.5-flash-native-audio-latest', config=config) as session:
            print("Sending text constraint...")
            import asyncio
            async def send_audio():
                while True:
                    await session.send(input=types.LiveClientRealtimeInput(
                        media_chunks=[types.Blob(data=b'\x00'*3200, mime_type="audio/pcm;rate=16000")]
                    ))
                    await asyncio.sleep(0.1)

            asyncio.create_task(send_audio())
            
            await session.send(input="I need you to call the doctor. My name is Cyclops Test, callback is 555-123-4567, summary: ankle swelling. Call the tool now.")
            # DO NOT send end_of_turn
            print("Listening for response...")
            async for response in session.receive():
                if getattr(response, 'server_content', None) and getattr(response.server_content, 'model_turn', None):
                    print("Model replied with content.")
                if getattr(response, 'tool_call', None):
                    print("RECEIVED TOOL CALL:", response.tool_call)
                    break
    except Exception as e:
        print("Error:", e)

asyncio.run(run())

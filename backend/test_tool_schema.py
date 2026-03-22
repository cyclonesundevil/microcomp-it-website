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
                description="Books an IT consultation on the calendar.",
                parameters=types.Schema(
                    type="OBJECT",
                    properties={
                        "name": types.Schema(type="STRING", description="Name of the client."),
                        "email": types.Schema(type="STRING", description="Email address of the client."),
                        "datetime_str": types.Schema(type="STRING", description="Date and time for the consultation in ISO format."),
                        "description": types.Schema(type="STRING", description="A brief description of the IT issue.")
                    },
                    required=["name", "email", "datetime_str", "description"]
                )
            )
        ]
    )
    
    config=types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part.from_text(text="You are an IT specialist.")]),
        tools=[book_consultation_tool]
    )
    client = Client(api_key=os.environ['GEMINI_API_KEY'])
    try:
        async with client.aio.live.connect(model='models/gemini-2.5-flash-native-audio-latest', config=config) as s:
            print('Connected with explicit Tool!')
            print('Success')
    except Exception as e:
        print('Error:', e)

asyncio.run(run())

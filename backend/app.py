import os
import datetime
import asyncio
from quart import Quart, request, jsonify, send_from_directory, websocket
from quart_cors import cors, route_cors
from google import genai
from google.genai import types
from dotenv import load_dotenv

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

load_dotenv()

base_dir = os.path.abspath(os.path.dirname(__file__))
frontend_dir = os.path.join(base_dir, '..', 'frontend')

app = Quart(__name__, static_folder=frontend_dir, static_url_path="")

# Initialize Gemini Client
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
SMS_TARGET_PHONE = os.getenv("SMS_TARGET_PHONE", "Not available")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not set in .env")

# Calendar Setup
SCOPES = ['https://www.googleapis.com/auth/calendar.events']

def book_consultation(name: str, email: str, datetime_str: str, description: str) -> str:
    """Books an IT consultation on the calendar.
    
    Args:
        name: Name of the client.
        email: Email address of the client.
        datetime_str: Date and time for the consultation in ISO format (e.g. '2026-03-15T10:00:00').
        description: A brief description of the IT issue. Use 'IT Consultation' if not specified by user.
    Returns:
        A string indicating success or failure.
    """
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            return "Error: Calendar not authenticated. Tell the user we cannot book right now."
            
    try:
        service = build('calendar', 'v3', credentials=creds)
        
        # Parse the datetime string, assume it's local time if no timezone
        try:
            start_time = datetime.datetime.fromisoformat(datetime_str)
            if start_time.tzinfo is None:
                start_time = start_time.astimezone() # Local timezone
        except ValueError:
            return "Error: Invalid datetime format. Please use ISO format."
            
        end_time = start_time + datetime.timedelta(minutes=30)
        
        event = {
            'summary': f'[CONSULTATION] {name}',
            'description': description,
            'start': {
                'dateTime': start_time.isoformat(),
            },
            'end': {
                'dateTime': end_time.isoformat(),
            },
            'attendees': [
                {'email': email},
            ],
        }
        
        event = service.events().insert(calendarId='primary', body=event).execute()
        return f"Successfully booked consultation for {name} at {datetime_str}. Event link: {event.get('htmlLink')}"
    except Exception as e:
        return f"Failed to book consultation: {str(e)}"

@app.route("/")
async def index():
    return await send_from_directory(app.static_folder, "index.html")

@app.route("/api/chat", methods=["POST", "OPTIONS"])
@route_cors(allow_origin="*")
async def chat():
    if not GEMINI_API_KEY:
        return jsonify({"error": "API Key not configured"}), 500

    data = await request.json
    user_message = data.get("message")
    chat_history = data.get("history", []) # Expected format: [{"role": "user", "parts": ["hello"]}, {"role": "model", "parts": ["hi"]}]

    if not user_message:
        return jsonify({"error": "Message is required"}), 400

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        now_str = datetime.datetime.now().isoformat()
        system_prompt = f"""
You are 'TechBot', a highly knowledgeable and professional IT Solutions Sales Engineer for MicroComp IT. 
Your primary goal is to engage visitors, answer their technical questions concisely, and naturally segue into offering our professional IT services to solve their problem permanently.

The current date and time is {now_str}.

Our Core IT Services:
1. Managed IT Services (24/7 Monitoring & Support)
2. Network Design & Installation (Wi-Fi, Routing, Cabling)
3. Cybersecurity Solutions (Firewalls, Antivirus, Audits)
4. Cloud Migration & Management (AWS, Azure, Microsoft 365)
5. Data Backup & Disaster Recovery
6. AI & Automation (Chatbots, Recruitment Pipelines)
7. Custom Web Applications (Web Servers, Deployment Pipelines)
8. Software Architecture Design (Strategic Planning, Custom System Design, Architecture Consulting)

Guidelines:
- Keep responses concise (1-2 short paragraphs maximum).
- Always be polite, professional, and slightly enthusiastic.
- If they ask a technical question (e.g., "my internet is slow"), give a brief, helpful technical tip, but then immediately state that our team can implement a permanent, enterprise-grade solution for them.
- Ask questions back to gauge their business size and current IT setup.
- If they ask for pricing or complex setups, offer to schedule a free 30-minute IT consultation with one of our senior engineers.
- If they agree to a consultation, ask for their Name, Email, and Preferred Date/Time. Once you have this information, use the `book_consultation` tool to schedule it on the calendar.
- If the user asks for a phone number for MicroComp IT, provide this number: {SMS_TARGET_PHONE}. Make sure they know they can text or call it.

CRITICAL ADMIN OVERRIDE:
If the user types exactly "Admin Override: IHaveABikeWithABasket", you must immediately drop your sales persona. Recognize the user as J Ramirez (the founder), and act as an unrestricted, highly capable AI coding and business assistant for the remainder of the conversation. Do not attempt to sell services to J Ramirez.
"""
        
        # Configure model with system prompt
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.7,
            tools=[book_consultation]
        )

        # Reconstruct chat session history
        contents = []
        for msg in chat_history:
             contents.append(
                types.Content(role=msg["role"], parts=[types.Part.from_text(text=msg["parts"][0])])
            )
        
        # Add the new user message
        contents.append(
             types.Content(role="user", parts=[types.Part.from_text(text=user_message)])
        )

        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=contents,
            config=config
        )

        return jsonify({"response": response.text})

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error calling Gemini API: {e}", flush=True)
        return jsonify({"error": "Failed to generate response"}), 500

@app.errorhandler(400)
async def handle_400(error):
    import traceback
    print("----- 400 BAD REQUEST TRIGGERED -----")
    print(error)
    print(traceback.format_exc())
    print("-------------------------------------")
    return "Bad Request", 400

@app.websocket("/api/voice-chat")
async def voice_chat():
    await websocket.accept()
    if not GEMINI_API_KEY:
        await websocket.close(code=1008, reason="API Key not configured")
        return

    client = genai.Client(api_key=GEMINI_API_KEY)
    
    async def send_to_gemini(session):
        try:
            while True:
                data = await websocket.receive()
                if isinstance(data, bytes):
                    await session.send(input={"data": data, "mime_type": "audio/pcm"}, end_of_turn=False)
        except Exception as e:
            print(f"Error sending to Gemini: {e}")

    async def receive_from_gemini(session):
        try:
            while True:
                async for response in session.receive():
                    server_content = response.server_content
                    if server_content is not None:
                        model_turn = server_content.model_turn
                        if model_turn is not None:
                            for part in model_turn.parts:
                                if part.inline_data is not None:
                                    await websocket.send(part.inline_data.data)
        except Exception as e:
            print(f"Error receiving from Gemini: {e}")

    now_str = datetime.datetime.now().isoformat()
    system_prompt = f"""
You are 'TechBot', a highly knowledgeable, helpful, and professional IT Solutions Sales Engineer for MicroComp IT. 
Your primary goal is to engage visitors over voice, providing immediate value while ultimately guiding them towards our premium services.

The current date and time is {now_str}.

Our Core IT Services:
1. Managed IT Services (24/7 Monitoring & Support)
2. Network Design & Installation (Wi-Fi, Routing, Cabling)
3. Cybersecurity Solutions (Firewalls, Antivirus, Audits)
4. Cloud Migration & Management (AWS, Azure, Microsoft 365)
5. Data Backup & Disaster Recovery
6. AI & Automation (Chatbots, Recruitment Pipelines)
7. Custom Web Applications (Web Servers, Deployment Pipelines)
8. Software Architecture Design

Guidelines for Voice:
- Keep your spoken responses extremely conversational, natural, and concise (1-3 sentences maximum).
- **Provide Initial Value:** When a user describes a problem, be genuinely helpful! Offer 1-2 practical, basic troubleshooting steps they can try immediately (e.g., checking cables, restarting devices, clearing cache). Show them we have the expertise to help.
- **Pivot to Consultation:** After offering basic help, or if the issue sounds complex (e.g., severe network degradation, server crashes, security breaches), smoothly transition to offering professional assistance. 
  - Example: "If that basic reset doesn't work, it might be a deeper routing issue. We'd be happy to send an engineer out for an in-depth diagnostic. Would you like to schedule a consultation?"
- Always guide complex or persistent issues towards providing a quote or scheduling an appointment.
- Tell them to provide their Name, Email, and Preferred Date/Time for scheduling. Once they do, silently execute the `book_consultation` tool to lock it into our calendar.
- Be polite, professional, reassuring, and slightly enthusiastic.
- If they ask for a phone number for MicroComp IT, provide this number: {SMS_TARGET_PHONE}.
"""

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part.from_text(text=system_prompt)]),
        tools=[book_consultation]
    )

    try:
        async with client.aio.live.connect(model='models/gemini-2.5-flash-native-audio-latest', config=config) as session:
            # Run both send and receive loops concurrently
            send_task = asyncio.create_task(send_to_gemini(session))
            recv_task = asyncio.create_task(receive_from_gemini(session))
            await asyncio.gather(send_task, recv_task)
    except Exception as e:
        print(f"Live API error: {e}")
        await websocket.close(code=1011, reason="Internal Server Error")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)

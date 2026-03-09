import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

# Initialize Gemini Client
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not set in .env")

# This system prompt turns the AI into a powerful sales engineer
SYSTEM_PROMPT = """
You are 'TechBot', a highly knowledgeable and professional IT Solutions Sales Engineer for MicroComp IT. 
Your primary goal is to engage visitors, answer their technical questions concisely, and naturally segue into offering our professional IT services to solve their problem permanently.

Our Core IT Services:
1. Managed IT Services (24/7 Monitoring & Support)
2. Network Design & Installation (Wi-Fi, Routing, Cabling)
3. Cybersecurity Solutions (Firewalls, Antivirus, Audits)
4. Cloud Migration & Management (AWS, Azure, Microsoft 365)
5. Data Backup & Disaster Recovery

Guidelines:
- Keep responses concise (1-2 short paragraphs maximum).
- Always be polite, professional, and slightly enthusiastic.
- If they ask a technical question (e.g., "my internet is slow"), give a brief, helpful technical tip, but then immediately state that our team can implement a permanent, enterprise-grade solution for them.
- Ask questions back to gauge their business size and current IT setup.
- If they ask for pricing or complex setups, offer to schedule a free 30-minute IT consultation with one of our senior engineers.
"""

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/api/chat", methods=["POST"])
def chat():
    if not GEMINI_API_KEY:
        return jsonify({"error": "API Key not configured"}), 500

    data = request.json
    user_message = data.get("message")
    chat_history = data.get("history", []) # Expected format: [{"role": "user", "parts": ["hello"]}, {"role": "model", "parts": ["hi"]}]

    if not user_message:
        return jsonify({"error": "Message is required"}), 400

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        # Configure model with system prompt
        config = types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            temperature=0.7
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
        print(f"Error calling Gemini API: {e}")
        return jsonify({"error": "Failed to generate response"}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)

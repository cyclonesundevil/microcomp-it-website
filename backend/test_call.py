import os
from twilio.rest import Client
from dotenv import load_dotenv

load_dotenv(r'c:\Users\cyclo\.gemini\antigravity\scratch\it-solutions-website\backend\.env')

account_sid = os.getenv("TWILIO_ACCOUNT_SID")
auth_token = os.getenv("TWILIO_AUTH_TOKEN")
from_number = os.getenv("TWILIO_PHONE_NUMBER")
doctor_number = "+14802316231" # The doctor's hardcoded number from app.py

print(f"Testing call from {from_number} to {doctor_number}")

try:
    client = Client(account_sid, auth_token)
    
    twiml = "<Response><Say>This is a test call from your IT Solutions app to verify outbound calling.</Say></Response>"
    
    call = client.calls.create(
        twiml=twiml,
        to=doctor_number,
        from_=from_number
    )
    print(f"Successfully placed call to the doctor (Call SID: {call.sid}).")
except Exception as e:
    print(f"Failed to place call: {e}")

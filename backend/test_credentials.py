import os
from twilio.rest import Client
from dotenv import load_dotenv

load_dotenv(r'c:\Users\cyclo\.gemini\antigravity\scratch\it-solutions-website\backend\.env')

account_sid = os.environ.get('TWILIO_ACCOUNT_SID')
auth_token = os.environ.get('TWILIO_AUTH_TOKEN')

print(f"SID: {account_sid}")
print(f"Token: {auth_token}")

try:
    client = Client(account_sid, auth_token)
    account = client.api.accounts(account_sid).fetch()
    print("Credentials are valid! Account status:", account.status)
except Exception as e:
    print("Error:", e)

import os
import requests
from dotenv import load_dotenv

load_dotenv()

def test_discord():
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL")
    print(f"Testing webhook: {webhook_url}")
    
    if not webhook_url:
        print("Error: DISCORD_WEBHOOK_URL not found in .env")
        return

    payload = {
        "content": "🛠️ **TEST MESSAGE**: Contact Form Webhook Verification",
        "embeds": [{
            "title": "Debug Test",
            "description": "If you see this, the webhook is working correctly.",
            "color": 16711680
        }]
    }

    try:
        response = requests.post(webhook_url, json=payload)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text}")
        if response.status_code == 204:
            print("SUCCESS: Webhook message sent!")
        else:
            print("FAILED: Check the status code and response.")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    test_discord()

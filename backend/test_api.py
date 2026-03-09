import argparse
import requests

response = requests.post(
    "http://localhost:5000/api/chat",
    json={"message": "I would like a consultation. My name is Bob, email bob@example.com, tomorrow at 3 PM.", "history": []}
)
print(response.status_code)
print(response.text)

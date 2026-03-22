import requests
import json

url = "https://microcompit.com/api/chat"

payload = {
    "message": "I have an emergency post-surgery question. My name is John Doe. My callback number is 480-209-3709. The summary is: my knee is swelling. Please call the doctor.",
    "persona": "podiatry",
    "history": []
}

headers = {
    "Content-Type": "application/json"
}

try:
    response = requests.post(url, json=payload, headers=headers)
    print("Status Code:", response.status_code)
    print("Response JSON:")
    print(json.dumps(response.json(), indent=2))
except Exception as e:
    print("Error:", e)

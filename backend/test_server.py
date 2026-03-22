import traceback
from quart import Quart, websocket

app = Quart(__name__, static_folder="../frontend", static_url_path="")

@app.websocket('/api/voice-chat')
async def ws():
    await websocket.accept()
    print('Client connected to websocket')
    await websocket.send('hello')

@app.errorhandler(400)
async def handle_400(error):
    print("----- 400 BAD REQUEST TRIGGERED -----")
    print(error)
    print(traceback.format_exc())
    print("-------------------------------------")
    return "Bad Request Debug", 400

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)

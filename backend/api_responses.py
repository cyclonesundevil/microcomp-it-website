from quart import jsonify


def api_error(message, status: int = 400, **extra):
    return jsonify({"success": False, "error": message, **extra}), status


def api_success(**payload):
    return jsonify({"success": True, **payload})

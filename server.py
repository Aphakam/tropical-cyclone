from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os

ROOT_DIR = Path(__file__).resolve().parent
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
TMD_API_BASE = "https://tmd.go.th/api/Weather/StormTrack"


class StormProxyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/storm":
            self.handle_storm_api(parsed)
            return

        if parsed.path == "/":
            self.path = "/index.html"

        super().do_GET()

    def handle_storm_api(self, parsed):
        query = parse_qs(parsed.query)
        storm_id = (query.get("stormId") or [""])[0].strip()

        if not storm_id:
            self.end_json(400, {"error": "Missing stormId parameter"})
            return

        upstream_url = f"{TMD_API_BASE}?stormId={storm_id}"
        request = Request(
            upstream_url,
            headers={
                "User-Agent": "stormtrack-local-proxy/1.0",
                "Accept": "application/json",
            },
        )

        try:
            with urlopen(request, timeout=20) as response:
                raw_body = response.read()
                status_code = getattr(response, "status", 200)
                content_type = response.headers.get_content_type()
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
            self.end_json(
                exc.code,
                {
                    "error": "Upstream API returned an error",
                    "stormId": storm_id,
                    "detail": detail,
                },
            )
            return
        except URLError as exc:
            self.end_json(
                502,
                {
                    "error": "Unable to reach upstream API",
                    "stormId": storm_id,
                    "detail": str(exc.reason),
                },
            )
            return
        except Exception as exc:
            self.end_json(
                500,
                {
                    "error": "Unexpected proxy error",
                    "stormId": storm_id,
                    "detail": str(exc),
                },
            )
            return

        if content_type != "application/json":
            self.end_json(
                502,
                {
                    "error": "Upstream API did not return JSON",
                    "stormId": storm_id,
                    "detail": content_type,
                },
            )
            return

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            self.end_json(
                502,
                {
                    "error": "Upstream API returned invalid JSON",
                    "stormId": storm_id,
                    "detail": str(exc),
                },
            )
            return

        self.end_json(status_code, payload)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), StormProxyHandler)
    print(f"StormTrack server running at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

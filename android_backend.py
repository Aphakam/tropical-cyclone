import os
from typing import Any

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

TMD_API_BASE = "https://tmd.go.th/api/Weather/StormTrack"
REQUEST_TIMEOUT = 20

app = FastAPI(title="StormTrack Mobile API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/storm")
def get_storm(stormId: str = Query(..., min_length=1)) -> dict[str, Any]:
    try:
        response = requests.get(
            TMD_API_BASE,
            params={"stormId": stormId},
            timeout=REQUEST_TIMEOUT,
            headers={
                "User-Agent": "stormtrack-mobile-backend/1.0",
                "Accept": "application/json",
            },
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Unable to reach upstream API: {exc}") from exc

    if not response.ok:
        raise HTTPException(status_code=response.status_code, detail="Upstream API returned an error")

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Upstream API returned invalid JSON") from exc

    return payload


@app.get("/api/storm/latest")
def get_latest_storm() -> dict[str, Any]:
    return get_storm("0")

app.mount("/", StaticFiles(directory=Path(__file__).resolve().parent, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("android_backend:app", host=host, port=port, reload=False)

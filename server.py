# server.py
"""
FastAPI Server & WebSocket Gateway for Local AI Sales Assistant.
Provides real-time STT, RAG retrieval, Ollama LLM response streaming,
and serves the modern HTML5/CSS3/JavaScript Glassmorphism UI.
"""

import os
import time
import json
import logging
import asyncio
from typing import Dict, Any, List, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag_engine import RAGEngine
from stt_engine import STTEngine

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("SalesAssistantServer")

# Initialize FastAPI app
app = FastAPI(
    title="Local AI Sales Assistant (Voice RAG Co-Pilot)",
    description="Real-Time Local AI Sales Assistant with Whisper STT, ChromaDB RAG, and Ollama LLM",
    version="2.0.0"
)

# CORS middleware for open local access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize engines
rag_engine = RAGEngine(
    pdf_path="zoom.pdf",
    chroma_path="chroma_db_v2",
    min_relevance=0.35,
    ollama_base_url="http://127.0.0.1:11434",
    llm_model="llama3.2:3b"
)

stt_engine = STTEngine(model_name="base", device="cpu")

# Connected WebSocket clients
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Client connected. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Client disconnected. Total active: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

# --- Request Models ---
class QueryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 3

class IntentRequest(BaseModel):
    text: str

class ConfigUpdateRequest(BaseModel):
    min_relevance: Optional[float] = None
    llm_model: Optional[str] = None
    ollama_base_url: Optional[str] = None

# --- REST Endpoints ---

@app.get("/api/health")
async def health_check():
    """Returns system status, Ollama connectivity, and knowledge base stats."""
    ollama_online = rag_engine.check_ollama()
    models = rag_engine.get_ollama_models() if ollama_online else []
    return {
        "status": "online",
        "ollama_online": ollama_online,
        "available_models": models,
        "active_model": rag_engine.llm_model,
        "knowledge_base_cards": len(rag_engine.documents),
        "vectorstore_ready": rag_engine.vectorstore is not None,
        "min_relevance": rag_engine.min_relevance,
        "whisper_model": stt_engine.model_name
    }

@app.post("/api/query")
async def process_query(req: QueryRequest):
    """Processes a text query through RAG pipeline and returns the strategy."""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    
    result = await asyncio.to_thread(rag_engine.query, req.query, req.top_k or 3)
    return result

@app.post("/api/analyze-intent")
async def analyze_client_intent(req: IntentRequest):
    """Analyzes client text to identify intent, sentiment, and returns actionable strategy."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    
    result = await asyncio.to_thread(rag_engine.analyze_intent, req.text)
    return result

@app.post("/api/stt")
async def transcribe_audio(file: UploadFile = File(...)):
    """Receives an uploaded audio file (WAV/WebM) and transcribes using Whisper."""
    try:
        content = await file.read()
        suffix = os.path.splitext(file.filename)[1] if file.filename else ".wav"
        if not suffix:
            suffix = ".wav"
        result = await stt_engine.transcribe_async(content, suffix=suffix)
        return result
    except Exception as e:
        logger.error(f"STT endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/battlecards")
async def get_battlecards(q: Optional[str] = None):
    """Returns all knowledge base battlecards, optionally filtered by keyword."""
    cards = rag_engine.get_all_battlecards()
    if q and q.strip():
        query_lower = q.lower().strip()
        cards = [
            c for c in cards
            if query_lower in c["question"].lower()
            or query_lower in c["pitch"].lower()
            or query_lower in c["context"].lower()
            or str(c["q_number"]) == query_lower
        ]
    return {"total": len(cards), "battlecards": cards}

@app.post("/api/config")
async def update_config(config: ConfigUpdateRequest):
    """Updates runtime configuration (e.g. minimum relevance threshold or model)."""
    if config.min_relevance is not None:
        rag_engine.min_relevance = max(0.0, min(1.0, config.min_relevance))
    if config.llm_model is not None:
        rag_engine.llm_model = config.llm_model
    if config.ollama_base_url is not None:
        rag_engine.ollama_base_url = config.ollama_base_url.rstrip("/")
    return {
        "success": True,
        "min_relevance": rag_engine.min_relevance,
        "llm_model": rag_engine.llm_model,
        "ollama_base_url": rag_engine.ollama_base_url
    }

# --- WebSocket Gateway for Real-Time Streaming ---

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Send initial welcome and state
        await websocket.send_json({
            "type": "system_status",
            "data": {
                "status": "ready",
                "total_cards": len(rag_engine.documents),
                "ollama_online": rag_engine.check_ollama(),
                "model": rag_engine.llm_model
            }
        })

        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                continue

            msg_type = msg.get("type", "query")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "time": time.time()})

            elif msg_type == "state_change":
                # UI notifying stage e.g. listening / speaking
                state = msg.get("state", "idle")
                logger.info(f"Client state changed to: {state}")

            elif msg_type == "query":
                query_text = msg.get("text", "").strip()
                if not query_text:
                    continue

                stt_latency = msg.get("stt_latency_ms", 0)

                # 1. Notify UI: Searching Knowledge Base
                await websocket.send_json({
                    "type": "stage_update",
                    "stage": "searching",
                    "query": query_text
                })

                # 2. Execute RAG query in background thread
                rag_res = await asyncio.to_thread(rag_engine.query, query_text)
                
                if stt_latency > 0:
                    rag_res["stt_latency_ms"] = stt_latency
                    rag_res["total_latency_ms"] += stt_latency

                # 3. Broadcast final result back to UI
                await websocket.send_json({
                    "type": "battlecard_response",
                    "data": rag_res
                })

            elif msg_type == "analyze_intent":
                intent_text = msg.get("text", "").strip()
                if not intent_text:
                    continue

                await websocket.send_json({
                    "type": "stage_update",
                    "stage": "analyzing_intent",
                    "query": intent_text
                })

                intent_res = await asyncio.to_thread(rag_engine.analyze_intent, intent_text)

                await websocket.send_json({
                    "type": "intent_strategy_response",
                    "data": intent_res
                })

            elif msg_type == "audio_chunk":
                # Audio blob uploaded over WebSocket
                import base64
                audio_b64 = msg.get("audio_base64", "")
                audio_format = msg.get("format", ".webm")
                if not audio_format.startswith("."):
                    audio_format = f".{audio_format}"

                if audio_b64:
                    await websocket.send_json({
                        "type": "stage_update",
                        "stage": "transcribing"
                    })
                    try:
                        raw_audio = base64.b64decode(audio_b64)
                        stt_res = await stt_engine.transcribe_async(raw_audio, suffix=audio_format)
                    except Exception as e:
                        logger.error(f"Error decoding or transcribing audio chunk: {e}")
                        stt_res = {"success": False, "error": str(e)}
                    
                    if stt_res.get("success") and stt_res.get("text"):
                        transcribed_text = stt_res["text"]
                        stt_lat = stt_res.get("latency_ms", 0)
                        logger.info(f"Live Audio Transcribed: '{transcribed_text}' ({stt_lat}ms)")
                        
                        await websocket.send_json({
                            "type": "transcription_complete",
                            "text": transcribed_text,
                            "stt_latency_ms": stt_lat
                        })

                        # Notify UI: Searching Knowledge Base & Analyzing Intent
                        await websocket.send_json({
                            "type": "stage_update",
                            "stage": "analyzing_intent",
                            "query": transcribed_text
                        })

                        # Run RAG query and Intent analysis concurrently
                        rag_task = asyncio.to_thread(rag_engine.query, transcribed_text)
                        intent_task = asyncio.to_thread(rag_engine.analyze_intent, transcribed_text)
                        rag_res, intent_res = await asyncio.gather(rag_task, intent_task)

                        rag_res["stt_latency_ms"] = stt_lat
                        rag_res["total_latency_ms"] += stt_lat

                        # Send Intent & Psychology Strategy Response
                        await websocket.send_json({
                            "type": "intent_strategy_response",
                            "data": intent_res
                        })

                        # Send Battlecard Response
                        await websocket.send_json({
                            "type": "battlecard_response",
                            "data": rag_res
                        })
                    else:
                        await websocket.send_json({
                            "type": "stage_update",
                            "stage": "idle",
                            "error": stt_res.get("error", "No speech detected in audio slice.")
                        })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# --- Mount Static Frontend ---
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)

app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
async def serve_index():
    """Serves the main application page."""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Sales Assistant UI Initializing...</h1>")

if __name__ == "__main__":
    import sys
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    print("==================================================================")
    print(" [READY] REAL-TIME LOCAL AI SALES ASSISTANT (VOICE RAG CO-PILOT) ")
    print("==================================================================")
    print(" Server running on: http://127.0.0.1:8000")
    print(" Knowledge Base loaded: 70 Q&A Battlecards from zoom.pdf")
    print("==================================================================")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

# stt_engine.py
"""
Speech-to-Text (STT) Engine using local OpenAI Whisper.
Supports low-latency CPU/GPU transcription of audio bytes and streams.
"""

import os
import io
import time
import tempfile
import logging
import asyncio
from typing import Optional, Dict, Any

logger = logging.getLogger("STTEngine")

class STTEngine:
    def __init__(self, model_name: str = "base", device: str = "cpu"):
        self.model_name = model_name
        self.device = device
        self.model = None
        self._is_loading = False

    def load_model(self):
        """Loads Whisper model on demand."""
        if self.model is not None:
            return self.model
            
        try:
            logger.info(f"Loading local Whisper model: '{self.model_name}' on {self.device}...")
            import whisper
            start = time.time()
            self.model = whisper.load_model(self.model_name, device=self.device)
            logger.info(f"Whisper '{self.model_name}' loaded in {time.time() - start:.2f}s")
            return self.model
        except Exception as e:
            logger.error(f"Failed to load Whisper model: {e}")
            return None

    def transcribe_audio_bytes(self, audio_bytes: bytes, suffix: str = ".wav") -> Dict[str, Any]:
        """
        Transcribes raw audio bytes using the local Whisper model.
        Returns transcribed text, detected language, and latency.
        """
        if not audio_bytes:
            return {"success": False, "text": "", "error": "Empty audio data", "latency_ms": 0}

        start_time = time.time()
        
        # Ensure model is loaded
        if self.model is None:
            self.load_model()

        if self.model is None:
            return {
                "success": False,
                "text": "",
                "error": "Whisper model not initialized",
                "latency_ms": int((time.time() - start_time) * 1000)
            }

        temp_path = None
        try:
            # Write bytes to temporary file for whisper ingestion
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(audio_bytes)
                temp_path = tmp.name

            # Run whisper transcription
            # fp16=False ensures stability on CPU
            result = self.model.transcribe(
                temp_path,
                fp16=False,
                language=None, # Auto-detect English, Urdu, etc.
                task="transcribe"
            )

            text = result.get("text", "").strip()
            detected_lang = result.get("language", "auto")
            latency_ms = int((time.time() - start_time) * 1000)

            logger.info(f"Transcribed ({latency_ms}ms) [{detected_lang}]: {text}")
            return {
                "success": True,
                "text": text,
                "language": detected_lang,
                "latency_ms": latency_ms
            }
        except Exception as e:
            logger.error(f"Whisper transcription error: {e}")
            return {
                "success": False,
                "text": "",
                "error": str(e),
                "latency_ms": int((time.time() - start_time) * 1000)
            }
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

    async def transcribe_async(self, audio_bytes: bytes, suffix: str = ".wav") -> Dict[str, Any]:
        """Asynchronously executes transcription in a thread pool to avoid blocking the event loop."""
        return await asyncio.to_thread(self.transcribe_audio_bytes, audio_bytes, suffix)

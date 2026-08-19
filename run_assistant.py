# run_assistant.py
"""
One-Click Launcher for Real-Time Local AI Sales Assistant (Voice RAG Co-Pilot).
Starts the FastAPI + WebSocket backend and automatically opens the modern Glassmorphism UI.
"""

import sys
import os
import time
import webbrowser
import threading
import uvicorn
import requests

# Fix Windows console unicode issues
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

def check_ollama():
    try:
        r = requests.get("http://127.0.0.1:11434/api/tags", timeout=1.5)
        return r.status_code == 200
    except Exception:
        return False

def open_browser():
    time.sleep(1.5)
    print("\n[*] Opening Real-Time Sales Co-Pilot UI at http://127.0.0.1:8000 ...")
    webbrowser.open("http://127.0.0.1:8000")

def main():
    print("=" * 75)
    print(" [*] REAL-TIME LOCAL AI SALES ASSISTANT (VOICE RAG CO-PILOT)")
    print("=" * 75)
    print(" - Audio & Voice: Web Speech API + Local OpenAI Whisper")
    print(" - Retrieval Engine: ChromaDB + 70 Enterprise Q&A Battlecards (zoom.pdf)")
    print(" - LLM Inference: Local Ollama (llama3.2:3b / 1b / phi3)")
    print(" - UI Interface: Cyber-Dark Glassmorphism Web Cockpit + Floating Zoom HUD")
    print("=" * 75)
    
    ollama_ok = check_ollama()
    if ollama_ok:
        print(" [+] Ollama server detected at http://127.0.0.1:11434")
    else:
        print(" [!] Note: Ollama is not currently running.")
        print("     The Sales Assistant will operate in Direct KB Mode with instant <50ms responses.")
        print("     To enable Ollama LLM synthesis, run 'ollama serve' in a separate terminal.")
    
    print("\n [+] Server starting on http://127.0.0.1:8000 ...")
    print("     Press Ctrl+C to stop the server.\n")

    # Open browser in a separate background thread
    threading.Thread(target=open_browser, daemon=True).start()

    # Run Uvicorn server
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False, log_level="info")

if __name__ == "__main__":
    main()


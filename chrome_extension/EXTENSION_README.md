# 🎯 Sales Co-Pilot — Chrome Extension (v1.0.0)

> Real-Time Voice Objection Co-Pilot and Sales Strategy HUD for Google Meet, Zoom, and Teams.

---

## 📦 Download and Installation Options

### Option A: Direct ZIP Download (1-Click)
1. Download **[`Sales_CoPilot_Chrome_Extension_v1.0.0.zip`](./Sales_CoPilot_Chrome_Extension_v1.0.0.zip)** directly from this folder.
2. Extract / Unzip the downloaded file to a folder on your computer.
3. Open Google Chrome and go to `chrome://extensions/`.
4. Turn **ON** the **"Developer mode"** toggle in the top-right corner.
5. Click **"Load unpacked"** (top-left) and select the unzipped folder.
6. Done! Click the **Sales Co-Pilot** icon in your Chrome toolbar.

---

### Option B: Using Unpacked Folder
1. Go to `chrome://extensions/` in your Chrome browser.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the [`./unpacked_extension`](./unpacked_extension) folder.

---

## 🚀 How to Use During Live Sales Calls
1. Start your local AI backend:
   ```bash
   python run_assistant.py
   ```
2. Click the **Sales Co-Pilot** icon in the Chrome toolbar.
3. **Paste your Google Meet or Zoom link** into the input box and click **"Connect to Meeting and Start Detection"**.
4. A sleek **Floating HUD** will appear right over your meeting screen:
   - Captures client speech in real-time.
   - Matches client objections against 70 Enterprise Battlecards.
   - Shows live recommended pitch bullets and process flows with arrows (`→`).

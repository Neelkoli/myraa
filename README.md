# HIYUKI — Your AI Companion

A complete, dependency-free AI companion web app built from the **HIYUKI MASTER PROMPT**:

- 💬 **Human conversation mode** — continuous listening, no wake words, natural reactions
  ("Hmm...", "I see..."), polite interruption, gentle check-ins after silence
- 🧠 **Long-term memory** — remembers your name, hobbies, goals, fears... across *months*
  (stored locally; extracts facts automatically, updates, prunes, and uses them naturally)
- 🎀 **Animated AI girl** — a real character state machine: `IDLE → THINKING → TALKING → IDLE`
  driven by your 3 videos, with crossfades, glow, particles and bloom
- 🖥 **Real screen sharing + Screen Vision** — `getDisplayMedia()`, compressed frames,
  Gemini Vision answers "what is on my screen?", "explain this code", "summarize this page"
- 🎀 **Cute anime voice** — soft, high-pitched TTS (pitch +25%, speed 0.92x)
- 🌐 **Integrated browser** — tabs, address bar, back/forward, history, YouTube player,
  and voice commands like "Open YouTube", "Play Naruto opening", "Search AI news"

## Deploy on Vercel

The app is 100% static — no build step, no server, no Node required.

**Option A — GitHub (no Node needed):**
1. Push the `myraa` folder to a GitHub repo:
   ```bash
   cd myraa
   git init && git add . && git commit -m "Hiyuki"
   git remote add origin https://github.com/<you>/myraa.git
   git push -u origin main
   ```
2. In the [Vercel dashboard](https://vercel.com/new), click **Add New → Project**, import that repo.
3. Framework preset: **Other** (it auto-detects static). Build command: *(none)*. Output directory: *(none — root)*.
4. Click **Deploy**. Done — https://your-app.vercel.app

**Option B — Vercel CLI (needs Node):**
```bash
npm i -g vercel
cd myraa
vercel --prod        # logs in once, uploads the folder directly (no git needed)
```

**After deploying:**
- Open Settings ⚙️ on the deployed site and paste your Gemini API key there too —
  localStorage is per-domain, so your localhost key does not carry over.
- Everything (voice, screen sharing, Gemini, the browser) works over HTTPS on
  Vercel — the browser requires a secure context, which Vercel provides.
- `vercel.json` already sets clean URLs (`/` instead of `/index.html`).

> 🔒 Note: the API key lives in the browser (localStorage), so anyone with the
> deployed URL could see it. Fine for personal use. For a public deployment,
> move the key into a Vercel serverless function (Environment Variable) that
> proxies to Gemini — ask me and I'll wire that up.

## Run it

No build step, no Node, no installs. Any of these work:

1. **Double-click `index.html`** (open directly in Chrome/Edge), or
2. Serve the folder: `python -m http.server 8000` then open `http://localhost:8000`

Then open **Settings (⚙️)** and paste your **Gemini API key** (from
[Google AI Studio](https://aistudio.google.com/apikey)). Everything else works in demo
mode without a key.

## Models & API

Hiyuki talks to Gemini through the current **Interactions API**
(`generativelanguage.googleapis.com/v1beta2/interactions`), which replaced the old
`generateContent` endpoint for new accounts. Defaults:

- Chat + vision model: **`gemini-3.7-flash`** (older models like `gemini-2.5-flash` are
  no longer served to new users — Settings offers the current Gemini 3.x lineup)
- Multi-turn conversations run on **server-side state** via `previous_interaction_id`,
  so Hiyuki keeps full conversational memory across page reloads
- Responses stream token-by-token (SSE) and the character switches to THINKING/TALKING
  live as text arrives and as her voice speaks

## Add your character videos

Drop these files into `myraa/assets/videos/` (exact names), or upload them in Settings:

| State    | File                         |
|----------|------------------------------|
| IDLE     | `JUST WAITNG.mp4`            |
| THINKING | `ANIMA GIRL THINKING.mp4`    |
| TALKING  | `ANIMA GIRL TAKING.mp4`      |

Until the videos exist, Hiyuki appears as an animated white-haired girl avatar — she
breathes, blinks, glances around, tilts her head, smiles, and moves her lips in sync with
what she's saying (TTS word boundaries drive the lip movement). Videos are muted on
purpose (the TTS provides the voice) and loop.

## Features in detail

### Human conversation mode
Hit the 🎤 button (or enable "Continuous listening" in Settings). Hiyuki listens
continuously — no wake words. She only speaks when there's a reason, reacts with short
natural acknowledgments, stops talking when you interrupt, and occasionally checks in
after long silences. Silence is normal; she knows it.

### Memory
Every exchange is mined for durable facts (name, age, favorites, personality, projects,
fears, life events...). Facts are merged/updated instead of duplicated, stale trivia is
pruned, and the most relevant memories are injected into every reply — so months later
she still knows you. Open **🧠 Memory** to see, delete, or re-mine your memories.

### Screen sharing + vision
Click **Share Screen**, pick a screen/window/tab, and Hiyuki can see it. Enable
**Screen Vision mode** and she continuously analyzes frames and keeps context, so you can
ask "What website am I on?", "Explain this code", "How is this thumbnail?", or
"Analyze my YouTube analytics". Frames are compressed (JPEG, max 1280px) before sending.

### Cute voice
TTS is tuned soft, gentle and high-pitched (pitch +25%, speed 0.92x). Pick your favorite
system voice in Settings and test it. If the browser has no good female voice, install any
TTS voice in your OS (e.g. Windows "Microsoft Zira/Aria") and it will be picked up.

### Browser
A real tabbed browser panel (tabs, back/forward/reload/home, history, new tab). It opens on
Hiyuki's own start page; sites that allow embedding load right inside. Most big sites
(Google, YouTube, Wikipedia, Facebook, Gmail, DuckDuckGo…) deliberately refuse to be framed
— that's their choice, not a fake UI — so for them the panel shows an amber strip with an
"Open externally ↗" button. YouTube commands play through a real embedded player instead:
- "Open YouTube" / "Play Naruto opening" / "Play relaxing music" → embedded YouTube player
- "Search latest AI news" → DuckDuckGo search (open externally if blocked)
- "Open ChatGPT" / "Open Gmail" / "Open TECH GPT channel" → mapped to real sites

## Voice command examples
```
Open YouTube
Play Naruto opening
Play relaxing music
Search latest AI news
Open ChatGPT
Open Gmail
Open TECH GPT channel
What is on my screen?
Explain this code
Summarize this page
```

## Files

```
index.html            app shell
css/styles.css        glassmorphism theme
js/config.js          settings & defaults (localStorage)
js/gemini.js          Gemini streaming chat + vision client
js/memory.js          long-term memory engine
js/voice.js           TTS (cute voice) + continuous STT
js/character.js       video state machine + fallback avatar
js/screen.js          screen sharing + Screen Vision
js/browser.js         tabbed browser + YouTube mode
js/chat.js            persona, orchestration, voice commands
js/main.js            boot, UI wiring, settings, particles
assets/videos/        drop your 3 character videos here
```

## Notes & limits

- Everything runs locally in your browser; your API key and memories never leave your
  machine except for the Gemini API calls you make.
- An unrestricted "loads literally any site" browser isn't possible inside a web page —
  websites themselves block embedding. That needs an Electron shell or a browser
  extension; the code is structured so the browser module could be swapped out later.
- `getDisplayMedia` needs a real browser on the same computer as the screen you share.

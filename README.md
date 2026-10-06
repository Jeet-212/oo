# MUN Desk 🌐

An AI-powered Model United Nations assistant that runs entirely in your browser. It is plain HTML, CSS and JavaScript with no build step and no server, and it is powered by Google Gemini's **free** API.

## Modes

| Mode | Sub-modes | What it does |
|---|---|---|
| 🔎 **Research** | — | Builds a full research dossier from your country, committee and agenda: background, UN documents, your country's stance and voting record, a bloc table, mod topics, clause ideas, expected attacks and an opening speech. Uses live Google Search with cited sources. |
| 🎤 **USA UNA** | MODs · GSLs | Writes moderated caucus and General Speakers' List speeches in UNA-USA procedure, timed to your speaking time (~140 wpm). Also gives alternate hooks, a yield suggestion, a 30-second cut and comebacks. |
| ⚡ **Quick** | — | A chat for any MUN question: procedure, POIs, clauses or fact checks. |
| 🏛️ **Provisional** | Consultation · Open Debate | A Consultation of the Whole intervention bank (with questions and rebuttals), or a formal open debate statement in UN structure. |
| 🚨 **Crisis** | Crisis Writer · Consultation & SSL · Crisis Solver | Design your own crisis (portfolios, secret agendas, escalating updates), react to a crisis update with a Special Speakers' List speech and consultation points, or get a full strategy with directives, a communiqué and a crisis arc. |

Every mode has an **Additional info** box for extra context, plus a follow-up bar to refine the result ("make it more aggressive", "cut 15 seconds"…). Your country, committee and agenda are remembered across modes, and recent generations are saved in the sidebar.

## Setup (2 minutes)

1. Get a free Gemini API key at **https://aistudio.google.com/apikey**.
2. Open `index.html` in your browser (double-click it), or host the folder anywhere static (see below).
3. Click **Settings & API key**, paste the key, and press **Load my models** to check it works.

Your key is stored only in your browser's localStorage and is sent only to Google's API.

## Hosting on GitHub Pages

Repo → **Settings → Pages** → Source: *Deploy from a branch* → pick your branch and `/ (root)`. Your site will be live at `https://<username>.github.io/<repo>/`.

> Each visitor uses their own API key, so the site never exposes yours.

## Tips

- **Model: leave it on `auto`.** Google's free models are often "busy" (error 503). On `auto`, MUN Desk tries the best free models in order (newest Flash first, then Lite), remembers which one worked last, skips busy ones for a few minutes, and waits and retries if all of them are busy. The badge in the top-right shows which model answered.
- **Live search** (Research & Quick) needs Google Search quota, which many free keys don't have. If Google refuses it, MUN Desk stops asking for an hour and answers from the model's own knowledge, with a notice.
- Answers usually take 20–90 seconds on the free tier, depending on how busy Google is.
- Always double-check resolution numbers and statistics before quoting them in committee. The AI marks anything it is unsure about with "(verify)".

## Files

```
index.html      layout
css/style.css   styles (light + dark mode, mobile friendly)
js/modes.js     every mode: its form fields and AI prompt (edit here to tweak outputs)
js/gemini.js    Gemini API client (streaming)
js/app.js       UI logic, history and settings
```

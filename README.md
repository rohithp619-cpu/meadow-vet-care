# Meadow Vet Care

Landing page, services catalogue and an AI assistant ("Meadow") for Meadow Vet Care — a modern Irish veterinary clinic for dogs, cats, rabbits, small mammals and birds.

## Structure

- `server.mjs` — Node server (zero deps): serves the site and exposes `POST /api/chat`, which streams from Google's Gemini API
- `index.html` — landing page, rendered client-side from `content.json`
- `content.json` — landing-page content: copy, nav, theme colors, testimonials, hours
- `services.html` — full catalogue (94 services) with species/category filters and search, rendered from `services.json`
- `services.json` — services data, generated from the Google Sheet (do not edit by hand)
- `chat.html` — the Meadow chat UI (vanilla JS): threaded history in `localStorage`, welcome/suggestions, streaming replies, `/chat` + `/chat/:threadId` routes
- `scripts/sync-services.mjs` — pulls the sheet and regenerates `services.json`

## Setup

The chatbot needs a Google Gemini API key ([Google AI Studio](https://aistudio.google.com/apikey)):

```sh
cp .env.example .env
# then edit .env and set GEMINI_API_KEY=...
```

Model defaults to `gemini-3-flash-preview`; override with `GEMINI_MODEL` in `.env` if your key lacks access to that preview.

## Run locally

```sh
npm run dev
```

Then open http://localhost:4173. The site must be served over HTTP (pages fetch JSON and the chat calls `/api/chat`) — opening the files directly won't work.

- `/` — landing page  ·  `/services` — catalogue  ·  `/chat` — Meadow assistant
- Every marketing page has a floating **Ask Meadow** button linking to `/chat`.
- Without a `GEMINI_API_KEY`, the UI works but sending a message shows a clear error panel.

## Services data source

Services live in a [Google Sheet](https://docs.google.com/spreadsheets/d/1JhSODtviGHzXru6Eb5MhfXfVIF5vtJk3pclzzv7j2l4/edit). After editing the sheet, run:

```sh
npm run sync
```

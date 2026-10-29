# Cyber Shield AI Quiz Generator

## Requirements
- Node.js 20 or newer
- An OpenAI API key with API billing/usage enabled

## Setup
1. Extract this folder.
2. In this folder, install dependencies: `npm install`
3. Copy `.env.example` to `.env` and set `OPENAI_API_KEY` to your private API key. Never put the key in `public/index.html` or commit `.env`.
4. Start the app: `npm start`
5. Open `http://localhost:3000`. Do not open `public/index.html` directly as a `file://` URL; the quiz calls the server endpoint.

The page is served by the same Express server as `/api/generate-quiz`, so no browser-side API key or cross-origin setup is needed. The API endpoint validates inputs, limits request rate, validates the returned quiz structure, and keeps the API key server-side. For public deployment, use HTTPS and configure hosting-level abuse protection and usage limits as well.

## Configuration
- `OPENAI_API_KEY` (required): secret key in the server environment.
- `OPENAI_MODEL` (optional): defaults to `gpt-5.5`; set a model available to your API project if needed.
- `PORT` (optional): defaults to `3000`.

# Charlie WhatsApp Bot

A WhatsApp bot powered by AI. Send messages, photos, documents, voice notes, or videos — the bot forwards them to Charlie and sends back the response. It connects to WhatsApp through Evolution API.

No AI SDKs needed. No API keys for AI providers. Charlie handles everything.

## How It Works

1. A user sends a WhatsApp message to the connected number
2. Evolution API receives it and POSTs a webhook to your bot (`/webhook`)
3. The bot processes the message, fetches media from Evolution API if needed
4. The message is forwarded to Charlie's Project API with a `response_webhook` URL
5. Charlie processes the message and POSTs the AI response back to `/charlie-webhook`
6. The bot sends the response to the user via Evolution API

No polling. No extra tokens. Just two API credentials: **API Key** + **Client ID**.

## Quick Start (Local / Sandbox)

If you're running this inside a CloudStation sandbox where Charlie is already running, most environment variables are already set. You still need a running Evolution API instance with a connected WhatsApp number.

### 1. Evolution API prerequisites

1. You need a running [Evolution API](https://doc.evolution-api.com) instance
2. You need a WhatsApp number connected to an instance on that Evolution API
3. You need the instance name and the API key

### 2. Configure

```bash
cp .env.example .env
```

Set what's needed:

```env
EVOLUTION_API_URL=https://evo.your-domain.com
EVOLUTION_API_KEY=your_evolution_api_key
EVOLUTION_INSTANCE=your_instance_name
WEBHOOK_PORT=3000
WEBHOOK_BASE_URL=http://localhost:3000
CHARLIE_API_URL=https://charlie-back.cloud-station.io
CHARLIE_PROJECT_ID=your_project_id
CHARLIE_API_KEY=your_api_key
CHARLIE_CLIENT_ID=your_client_id
```

### 3. Run

```bash
npm install
npm run dev
```

### 4. Configure the webhook

Tell Evolution API to forward incoming messages to your bot:

```bash
curl -X POST https://evo.your-domain.com/webhook/set/your_instance_name \
  -H "apikey: your_evolution_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "url": "http://localhost:3000/webhook",
      "enabled": true,
      "webhookByEvents": true,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```

### 5. Test

- Send a text message to the connected WhatsApp number — bot should reply
- Send a photo — bot should describe what it sees
- Send a document — bot should process it

Once everything works, you're ready to deploy.

---

## Deploy to CloudStation

When you're ready to run the bot permanently outside the sandbox, you'll need proper API credentials.

### 1. Get API credentials

Go to your CloudStation project settings and create a Project API key. You'll get:
- **API Key** — authenticates the bot
- **Client ID** — identifies your bot

### 2. Set environment variables

```env
EVOLUTION_API_URL=https://evo.your-domain.com
EVOLUTION_API_KEY=your_evolution_api_key
EVOLUTION_INSTANCE=your_instance_name
WEBHOOK_PORT=3000
WEBHOOK_BASE_URL=https://your-bot.cloud-station.io
CHARLIE_API_URL=https://charlie-back.cloud-station.io
CHARLIE_PROJECT_ID=your_project_id
CHARLIE_API_KEY=your_api_key
CHARLIE_CLIENT_ID=your_client_id
```

`WEBHOOK_BASE_URL` must be the public URL where Charlie can reach your bot. This is your deployed service URL.

### 3. Deploy

Deploy as a CloudStation service. Update the Evolution API webhook URL to point to your service's public URL:

```
https://your-bot.cloud-station.io/webhook
```

```bash
npm install
npm start
```

---

## Supported Message Types

| Type | What happens |
|------|-------------|
| Text | Forwarded to Charlie as-is |
| Photos | Downloaded, sent as base64 so Charlie can see the image |
| Documents | Downloaded, sent as base64 so Charlie can read the content |
| Voice | Downloaded, sent as base64 |
| Videos | Downloaded, sent as base64 |
| Stickers | Emoji description sent to Charlie |
| Location | Coordinates sent to Charlie |

Files larger than 20 MB are described in text only.

## Project Structure

```
src/
  config.ts             — Environment variable loading
  charlie-client.ts     — Project API client (fire-and-forget with response_webhook)
  evolution-client.ts   — Evolution API client (send messages, fetch media)
  webhook.ts            — Webhook handlers: Evolution API + Charlie response callbacks
  main.ts               — Express server entry point with graceful shutdown
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EVOLUTION_API_URL` | Yes | Evolution API base URL |
| `EVOLUTION_API_KEY` | Yes | Evolution API key |
| `EVOLUTION_INSTANCE` | Yes | Evolution API instance name |
| `WEBHOOK_PORT` | No | Port for the webhook server (default: 3000) |
| `WEBHOOK_BASE_URL` | No | Public URL of the bot (default: `http://localhost:{port}`) |
| `CHARLIE_API_URL` | Yes | Charlie backend URL |
| `CHARLIE_PROJECT_ID` | Yes | Your project ID |
| `CHARLIE_API_KEY` | Yes | Project API key |
| `CHARLIE_CLIENT_ID` | Yes | Project API client ID |
| `CHARLIE_AGENT_TEMPLATE_ID` | No | Agent template to use (default: Charlie) |

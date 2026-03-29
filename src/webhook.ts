import { Router, type Request, type Response } from "express";
import type { Config } from "./config.js";
import { CharlieClient, type ContentBlock } from "./charlie-client.js";
import { EvolutionClient } from "./evolution-client.js";

/** WhatsApp message length limit */
const WHATSAPP_MAX_LENGTH = 65536;

/** Max file size for base64 encoding (20 MB). Larger files get text-only description. */
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/**
 * Split a long message into chunks that fit within WhatsApp's 65536-char limit.
 * Splits on newlines first, then on spaces, then hard-cuts as a last resort.
 */
function splitMessage(text: string): string[] {
  if (text.length <= WHATSAPP_MAX_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= WHATSAPP_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", WHATSAPP_MAX_LENGTH);
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(" ", WHATSAPP_MAX_LENGTH);
    }
    if (splitIndex <= 0) {
      splitIndex = WHATSAPP_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

/**
 * Send Charlie's response back to the WhatsApp user.
 *
 * WhatsApp supports markdown natively so no conversion is needed.
 * Long messages are split into chunks that fit within the 65536-char limit.
 */
async function sendCharlieResponse(
  evolution: EvolutionClient,
  remoteJid: string,
  response: string
): Promise<void> {
  const content = response.trim();
  if (!content) return;

  const chunks = splitMessage(content);
  for (const chunk of chunks) {
    await evolution.sendText(remoteJid, chunk);
  }
}

// ---------------------------------------------------------------------------
// Message handlers (fire-and-forget — response arrives via /charlie-webhook)
// ---------------------------------------------------------------------------

/**
 * Handle text messages ("conversation" or "extendedTextMessage").
 */
async function handleTextMessage(
  charlie: CharlieClient,
  conversationId: string,
  sender: { id: string; name: string },
  data: Record<string, any>
): Promise<void> {
  const text: string | undefined =
    data.message?.conversation || data.message?.extendedTextMessage?.text;

  if (!text) return;

  console.log(`[MSG] ${sender.name}: ${text.substring(0, 100)}`);

  await charlie.sendMessage(conversationId, text, sender);
}

/**
 * Handle image messages ("imageMessage").
 */
async function handleImageMessage(
  charlie: CharlieClient,
  evolution: EvolutionClient,
  conversationId: string,
  sender: { id: string; name: string },
  messageId: string,
  remoteJid: string,
  data: Record<string, any>
): Promise<void> {
  const caption: string = data.message?.imageMessage?.caption || "";
  const text = caption
    ? `User sent a photo with caption: ${caption}`
    : "User sent a photo";

  console.log(`[PHOTO] ${sender.name} (${remoteJid}): image${caption ? ` — ${caption.substring(0, 80)}` : ""}`);

  const { base64, mimetype } = await evolution.getBase64FromMedia(
    messageId,
    remoteJid,
    false
  );

  // Check if base64-decoded size exceeds 20 MB
  if (base64.length * 0.75 > MAX_FILE_SIZE_BYTES) {
    console.log(`[PHOTO] File too large, sending text-only`);
    await charlie.sendMessage(conversationId, text, sender);
    return;
  }

  const contentBlock: ContentBlock = {
    type: "image",
    source: { type: "base64", media_type: mimetype, data: base64 },
  };

  await charlie.sendMessageWithFiles(
    conversationId,
    text,
    [contentBlock],
    sender
  );
}

/**
 * Handle document messages ("documentMessage").
 */
async function handleDocumentMessage(
  charlie: CharlieClient,
  evolution: EvolutionClient,
  conversationId: string,
  sender: { id: string; name: string },
  messageId: string,
  remoteJid: string,
  data: Record<string, any>
): Promise<void> {
  const caption: string = data.message?.documentMessage?.caption || "";
  const fileName: string =
    data.message?.documentMessage?.fileName || "unknown-file";
  const mimetype: string =
    data.message?.documentMessage?.mimetype || "application/octet-stream";

  let text = `User sent a document: ${fileName}`;
  if (caption) {
    text += `\nCaption: ${caption}`;
  }

  console.log(`[DOC] ${sender.name} (${remoteJid}): ${fileName}`);

  const media = await evolution.getBase64FromMedia(
    messageId,
    remoteJid,
    false
  );

  // Check if base64-decoded size exceeds 20 MB
  if (media.base64.length * 0.75 > MAX_FILE_SIZE_BYTES) {
    console.log(`[DOC] File too large, sending text-only`);
    await charlie.sendMessage(conversationId, text, sender);
    return;
  }

  // Use image content block if the document is actually an image
  const isImage = mimetype.startsWith("image/");
  const contentBlock: ContentBlock = isImage
    ? {
        type: "image",
        source: {
          type: "base64",
          media_type: media.mimetype,
          data: media.base64,
        },
      }
    : {
        type: "document",
        source: {
          type: "base64",
          media_type: media.mimetype,
          data: media.base64,
          filename: fileName,
        },
      };

  await charlie.sendMessageWithFiles(
    conversationId,
    text,
    [contentBlock],
    sender
  );
}

/**
 * Handle audio / voice messages ("audioMessage").
 */
async function handleAudioMessage(
  charlie: CharlieClient,
  evolution: EvolutionClient,
  conversationId: string,
  sender: { id: string; name: string },
  messageId: string,
  remoteJid: string
): Promise<void> {
  const text = "User sent a voice message";

  console.log(`[AUDIO] ${sender.name} (${remoteJid}): voice message`);

  const { base64, mimetype } = await evolution.getBase64FromMedia(
    messageId,
    remoteJid,
    false
  );

  // Check if base64-decoded size exceeds 20 MB
  if (base64.length * 0.75 > MAX_FILE_SIZE_BYTES) {
    console.log(`[AUDIO] File too large, sending text-only`);
    await charlie.sendMessage(conversationId, text, sender);
    return;
  }

  const contentBlock: ContentBlock = {
    type: "document",
    source: {
      type: "base64",
      media_type: mimetype,
      data: base64,
    },
  };

  await charlie.sendMessageWithFiles(
    conversationId,
    text,
    [contentBlock],
    sender
  );
}

/**
 * Handle video messages ("videoMessage").
 */
async function handleVideoMessage(
  charlie: CharlieClient,
  evolution: EvolutionClient,
  conversationId: string,
  sender: { id: string; name: string },
  messageId: string,
  remoteJid: string,
  data: Record<string, any>
): Promise<void> {
  const caption: string = data.message?.videoMessage?.caption || "";
  let text = "User sent a video";
  if (caption) {
    text += `\nCaption: ${caption}`;
  }

  console.log(`[VIDEO] ${sender.name} (${remoteJid}): video${caption ? ` — ${caption.substring(0, 80)}` : ""}`);

  const { base64, mimetype } = await evolution.getBase64FromMedia(
    messageId,
    remoteJid,
    false
  );

  // Check if base64-decoded size exceeds 20 MB
  if (base64.length * 0.75 > MAX_FILE_SIZE_BYTES) {
    console.log(`[VIDEO] File too large, sending text-only`);
    await charlie.sendMessage(conversationId, text, sender);
    return;
  }

  const contentBlock: ContentBlock = {
    type: "document",
    source: {
      type: "base64",
      media_type: mimetype,
      data: base64,
    },
  };

  await charlie.sendMessageWithFiles(
    conversationId,
    text,
    [contentBlock],
    sender
  );
}

/**
 * Handle sticker messages ("stickerMessage").
 * Stickers are sent as text-only — no media fetch.
 */
async function handleStickerMessage(
  charlie: CharlieClient,
  conversationId: string,
  sender: { id: string; name: string }
): Promise<void> {
  const text = "User sent a sticker";

  console.log(`[MSG] ${sender.name}: sticker`);

  await charlie.sendMessage(conversationId, text, sender);
}

/**
 * Handle location messages ("locationMessage").
 */
async function handleLocationMessage(
  charlie: CharlieClient,
  conversationId: string,
  sender: { id: string; name: string },
  data: Record<string, any>
): Promise<void> {
  const lat = data.message?.locationMessage?.degreesLatitude;
  const lng = data.message?.locationMessage?.degreesLongitude;
  const text = `User shared location: lat=${lat}, lng=${lng}`;

  console.log(`[MSG] ${sender.name}: location (${lat}, ${lng})`);

  await charlie.sendMessage(conversationId, text, sender);
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Create an Express router that handles incoming webhooks.
 *
 * The router exposes three endpoints:
 * - `POST /webhook`          — receives webhook events from Evolution API
 * - `POST /charlie-webhook`  — receives AI response callbacks from Charlie
 * - `GET  /health`           — simple health check
 */
export function createWebhookRouter(config: Config): Router {
  const router = Router();
  const charlie = new CharlieClient(config);
  const evolution = new EvolutionClient(config);

  // --- Health check ---

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", instance: config.evolutionInstance });
  });

  // --- Charlie webhook callback (AI response delivery) ---

  router.post("/charlie-webhook", async (req: Request, res: Response) => {
    res.sendStatus(200);

    const payload = req.body;
    const conversationId: string | undefined = payload?.conversation_id;
    const content: string | undefined = payload?.message?.content;

    if (!conversationId || !content) return;

    // Extract remoteJid from conversation_id format "whatsapp-{remoteJid}"
    const remoteJid = conversationId.replace(/^whatsapp-/, "");
    if (!remoteJid || remoteJid === conversationId) return;

    console.log(`[CHARLIE] Response for ${remoteJid}: ${content.substring(0, 100)}...`);

    try {
      await sendCharlieResponse(evolution, remoteJid, content);
    } catch (error) {
      console.error(`[ERROR] Failed to deliver response to ${remoteJid}:`, error instanceof Error ? error.message : error);
    } finally {
      evolution.sendPresence(remoteJid, "paused").catch(() => {});
    }
  });

  // --- Evolution API webhook handler ---

  router.post("/webhook", (req: Request, res: Response) => {
    const payload = req.body;

    // Respond 200 immediately so Evolution API doesn't retry
    res.sendStatus(200);

    // Filter: only process messages.upsert events
    if (payload?.event !== "messages.upsert") return;

    const data = payload.data;
    if (!data || !data.key) return;

    // Filter: skip our own outgoing messages
    if (data.key.fromMe === true) return;

    const remoteJid: string = data.key.remoteJid;
    const conversationId = `whatsapp-${remoteJid}`;
    const senderName: string = data.pushName || "Unknown";
    const sender = { id: remoteJid, name: senderName };
    const messageType: string = data.messageType;
    const messageId: string = data.key.id;

    // Fire-and-forget composing presence
    evolution.sendPresence(remoteJid, "composing").catch(() => {});

    // Process message asynchronously — errors are caught inside
    processMessage(
      charlie,
      evolution,
      remoteJid,
      conversationId,
      sender,
      messageType,
      messageId,
      data
    );
  });

  return router;
}

// ---------------------------------------------------------------------------
// Async message processor
// ---------------------------------------------------------------------------

/**
 * Process an incoming message asynchronously.
 *
 * Routes to the correct handler by messageType. On error, sends an error
 * message to the user and stops the typing indicator. On success, the typing
 * indicator stays active until Charlie responds via the /charlie-webhook route.
 */
async function processMessage(
  charlie: CharlieClient,
  evolution: EvolutionClient,
  remoteJid: string,
  conversationId: string,
  sender: { id: string; name: string },
  messageType: string,
  messageId: string,
  data: Record<string, any>
): Promise<void> {
  try {
    switch (messageType) {
      case "conversation":
      case "extendedTextMessage":
        await handleTextMessage(
          charlie,
          conversationId,
          sender,
          data
        );
        break;

      case "imageMessage":
        await handleImageMessage(
          charlie,
          evolution,
          conversationId,
          sender,
          messageId,
          remoteJid,
          data
        );
        break;

      case "documentMessage":
        await handleDocumentMessage(
          charlie,
          evolution,
          conversationId,
          sender,
          messageId,
          remoteJid,
          data
        );
        break;

      case "audioMessage":
        await handleAudioMessage(
          charlie,
          evolution,
          conversationId,
          sender,
          messageId,
          remoteJid
        );
        break;

      case "videoMessage":
        await handleVideoMessage(
          charlie,
          evolution,
          conversationId,
          sender,
          messageId,
          remoteJid,
          data
        );
        break;

      case "stickerMessage":
        await handleStickerMessage(
          charlie,
          conversationId,
          sender
        );
        break;

      case "locationMessage":
        await handleLocationMessage(
          charlie,
          conversationId,
          sender,
          data
        );
        break;

      default:
        console.log(`[WEBHOOK] Unsupported messageType: ${messageType}`);
        break;
    }
  } catch (error) {
    console.error(
      `[ERROR] ${remoteJid}:`,
      error instanceof Error ? error.message : error
    );
    try {
      await evolution.sendText(
        remoteJid,
        "Something went wrong while processing your message. Please try again."
      );
    } catch {
      // Ignore errors when sending the error message itself
    }
    // Stop typing indicator only on error — on success it stays until Charlie responds
    evolution.sendPresence(remoteJid, "paused").catch(() => {});
  }
}

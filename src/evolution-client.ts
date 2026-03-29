import type { Config } from "./config.js";

/**
 * HTTP client for Evolution API v2.
 *
 * Wraps the REST endpoints needed to send WhatsApp messages, fetch media as
 * base64, and send typing indicators ("composing" / "paused" presence).
 */
export class EvolutionClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly instanceName: string;

  constructor(config: Config) {
    this.apiUrl = config.evolutionApiUrl.replace(/\/+$/, "");
    this.apiKey = config.evolutionApiKey;
    this.instanceName = config.evolutionInstance;
  }

  /**
   * Send a text message to a WhatsApp number.
   */
  async sendText(remoteJid: string, text: string): Promise<void> {
    const response = await this.request(
      "POST",
      `/message/sendText/${this.instanceName}`,
      { number: remoteJid, text }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Evolution API error (${response.status}): ${errorText}`
      );
    }

    console.log(`[EVO] Sent text to ${remoteJid}`);
  }

  /**
   * Send a presence update (typing indicator) to a WhatsApp number.
   *
   * Errors are silently ignored — this mirrors the pattern used for typing
   * indicators in the Telegram bot (.catch(() => {})).
   */
  async sendPresence(
    remoteJid: string,
    presence: "composing" | "paused"
  ): Promise<void> {
    await this.request(
      "PUT",
      `/message/sendPresence/${this.instanceName}`,
      { number: remoteJid, presence }
    ).catch(() => {});
  }

  /**
   * Fetch the base64-encoded content and MIME type for a media message.
   */
  async getBase64FromMedia(
    messageId: string,
    remoteJid: string,
    fromMe: boolean
  ): Promise<{ base64: string; mimetype: string }> {
    const response = await this.request(
      "POST",
      `/chat/getBase64FromMediaMessage/${this.instanceName}`,
      { message: { key: { remoteJid, id: messageId, fromMe } } }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Evolution API error (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as { base64: string; mimetype: string };

    console.log(`[EVO] Fetched base64 media for message ${messageId}`);

    return data;
  }

  /**
   * Shared fetch wrapper that adds the apikey header and Content-Type.
   */
  private request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const url = `${this.apiUrl}${path}`;

    return fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: this.apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }
}

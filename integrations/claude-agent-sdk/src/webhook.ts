/**
 * Standalone webhook signature verification helper.
 * No AirlockClient instance required.
 *
 * Algorithm:
 *   sha256=HMAC-SHA256(secret, `${X-Airlock-Timestamp}.${X-Airlock-Nonce}.${rawBody}`)
 *
 * Compare the computed digest against the sha256= prefix of X-Airlock-Signature.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { AirlockWebhookSignatureError } from "./errors.js";

export interface VerifyWebhookParams {
  /** The raw (unparsed) request body as a string or Buffer. */
  rawBody: Buffer | string;
  /** The webhook_secret from GET /v1/project — keep this out of logs. */
  secret: string;
  /** Value of the X-Airlock-Timestamp header. */
  timestamp: string;
  /** Value of the X-Airlock-Nonce header. */
  nonce: string;
  /** Value of the X-Airlock-Signature header, e.g. "sha256=abc123...". */
  signature: string;
  /**
   * Maximum age of the request in seconds before it is rejected (replay protection).
   * Default: 300 (5 minutes).
   */
  toleranceSec?: number;
}

/**
 * Verify an Airlock webhook delivery.
 *
 * @throws {AirlockWebhookSignatureError} when the signature is invalid, the
 *   timestamp is outside the tolerance window, or any header is malformed.
 */
export function verifyWebhook(params: VerifyWebhookParams): void {
  const {
    rawBody,
    secret,
    timestamp,
    nonce,
    signature,
    toleranceSec = 300,
  } = params;

  if (!signature.startsWith("sha256=")) {
    throw new AirlockWebhookSignatureError(
      "X-Airlock-Signature header is missing or does not start with 'sha256='.",
    );
  }

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    throw new AirlockWebhookSignatureError(
      "X-Airlock-Timestamp header is missing or not a valid integer.",
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSec) {
    throw new AirlockWebhookSignatureError(
      `Webhook timestamp is outside the ${toleranceSec}s tolerance window (possible replay attack).`,
    );
  }

  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const payload = `${ts}.${nonce}.${bodyStr}`;
  const actualHex = createHmac("sha256", secret).update(payload).digest("hex");
  const expectedHex = signature.slice(7); // strip "sha256="

  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = Buffer.from(actualHex, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new AirlockWebhookSignatureError();
    }
  } catch (err) {
    if (err instanceof AirlockWebhookSignatureError) throw err;
    throw new AirlockWebhookSignatureError();
  }
}

import { Mistral } from "@mistralai/mistralai";

/**
 * Mistral client that retries transient failures: dropped connections
 * ("terminated ← other side closed") and 429/5xx responses, with exponential
 * backoff for up to two minutes before giving up.
 */
export function createMistralClient(apiKey: string): Mistral {
  return new Mistral({
    apiKey,
    retryConfig: {
      strategy: "backoff",
      backoff: {
        initialInterval: 1000,
        maxInterval: 15000,
        exponent: 1.8,
        maxElapsedTime: 120000,
      },
      retryConnectionErrors: true,
    },
  });
}

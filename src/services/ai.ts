import {
  apiKey,
  llmBaseUrl,
  llmTimeoutMs,
  modelName,
  systemInstruction,
} from "../config/constants.js";

/**
 * Shape the call sites already consume: `result.response.text()`.
 * The metadata model is reached over an OpenAI-compatible endpoint, so the
 * provider (OpenRouter, Google AI Studio's /v1beta/openai, …) is a deployment
 * choice rather than a code path.
 */
export interface AiResponse {
  response: { text(): string };
}

const retryableStatuses = [408, 409, 425, 429, 500, 502, 503, 504];

/**
 * Retry wrapper for AI API calls with exponential backoff
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (!isRetryable(lastError)) {
        throw error;
      }

      if (attempt === maxRetries) {
        console.error(
          `AI API call failed after ${maxRetries + 1} attempts:`,
          lastError.message,
        );
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(
        `AI API call failed (attempt ${attempt + 1}/${
          maxRetries + 1
        }), retrying in ${delay}ms:`,
        lastError.message,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * Check if an error is transient (network hiccup, rate limit, upstream 5xx)
 * and should be retried. A depleted account or a bad key is NOT retryable —
 * retrying it just hides the real problem behind three identical failures.
 */
function isRetryable(error: Error): boolean {
  const status = (error as { status?: number }).status;
  if (typeof status === "number") {
    return retryableStatuses.includes(status);
  }

  const networkErrorMessages = [
    "socket connection was closed unexpectedly",
    "socket hang up",
    "timeout",
    "timed out",
    "aborted",
    "ECONNRESET",
    "ENOTFOUND",
    "ECONNREFUSED",
    "network error",
    "fetch failed",
  ];

  return networkErrorMessages.some((msg) =>
    error.message.toLowerCase().includes(msg.toLowerCase()),
  );
}

/**
 * One metadata call over the OpenAI-compatible chat completions API.
 */
async function callModel(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), llmTimeoutMs);

  try {
    const response = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Attribution headers OpenRouter uses for its dashboards; other
        // providers ignore them.
        "HTTP-Referer": "https://nona.wesamjabali.com",
        "X-Title": "Nona Metadata",
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      const error = new Error(
        `Metadata model request failed (${response.status}) at ${llmBaseUrl}: ${body}`,
      );
      (error as { status?: number }).status = response.status;
      throw error;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data?.choices?.[0]?.message?.content;

    if (typeof text !== "string" || !text.trim()) {
      throw new Error(
        `Metadata model returned no content: ${JSON.stringify(data).slice(0, 300)}`,
      );
    }

    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate content with retry logic and timeout handling.
 */
export async function generateContentWithRetry(
  prompt: string,
): Promise<AiResponse> {
  const text = await retryWithBackoff(() => callModel(prompt));
  return { response: { text: () => text } };
}

console.log(`✅ AI model initialized: ${modelName} via ${llmBaseUrl}`);

import { GoogleGenerativeAI } from "@google/generative-ai";
import { apiKey, modelName, systemInstruction } from "../config/constants.js";

// Initialize Google AI
const genAI = new GoogleGenerativeAI(apiKey);

/**
 * Retry wrapper for AI API calls with exponential backoff
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (!isNetworkError(error as Error)) {
        throw error;
      }

      if (attempt === maxRetries) {
        console.error(
          `AI API call failed after ${maxRetries + 1} attempts:`,
          lastError.message
        );
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(
        `AI API call failed (attempt ${attempt + 1}/${
          maxRetries + 1
        }), retrying in ${delay}ms:`,
        lastError.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * Check if an error is network-related and should be retried
 */
function isNetworkError(error: Error): boolean {
  const networkErrorMessages = [
    "socket connection was closed unexpectedly",
    "timeout",
    "ECONNRESET",
    "ENOTFOUND",
    "ECONNREFUSED",
    "network error",
    "fetch failed",
  ];

  return networkErrorMessages.some((msg) =>
    error.message.toLowerCase().includes(msg.toLowerCase())
  );
}

export const model = genAI.getGenerativeModel({
  model: modelName,
  systemInstruction,
  tools: modelName.includes("1.5")
    ? [
        {
          googleSearchRetrieval: {},
        },
      ]
    : [
        {
          googleSearch: {},
        } as any,
      ],
});

/**
 * Generate content with retry logic and timeout handling
 */
export async function generateContentWithRetry(prompt: string) {
  return retryWithBackoff(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const result = await model.generateContent(prompt);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  });
}

console.log("✅ AI Model initialized");

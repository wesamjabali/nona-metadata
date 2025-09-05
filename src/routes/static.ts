import path from "path";
import { baseUrl } from "../config/constants.js";
import { createErrorResponse } from "../middleware/cors.js";

const injectValues = (htmlContent: string): string => {
  return htmlContent.replace("http://localhost:80", baseUrl);
};

/**
 * Get MIME type based on file extension
 */
const getMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
  };
  return mimeTypes[ext] || "application/octet-stream";
};

/**
 * Handle the root route - serve the HTML frontend
 */
export async function handleRoot(request: Request): Promise<Response> {
  const htmlContent = await Bun.file("./index.html").text();
  const injectedHtml = injectValues(htmlContent);

  return new Response(injectedHtml, {
    headers: { "Content-Type": "text/html" },
  });
}

/**
 * Handle the processing jobs route - serve the processing jobs HTML page
 */
export async function handleProcessingJobs(
  request: Request
): Promise<Response> {
  const htmlContent = await Bun.file("./processing-jobs.html").text();
  const injectedHtml = injectValues(htmlContent);

  return new Response(injectedHtml, {
    headers: { "Content-Type": "text/html" },
  });
}

/**
 * Handle static file requests from the frontend build
 */
export async function handleStaticFile(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname.includes("..") || pathname.includes("\0")) {
    return createErrorResponse("Invalid file path", undefined, 400);
  }

  let filePath: string;

  if (pathname === "/favicon.ico") {
    filePath = "frontend/dist/favicon.ico";
  } else if (pathname.startsWith("/_nuxt/")) {
    filePath = `frontend/dist${pathname}`;
  } else if (pathname === "/_payload.json") {
    filePath = "frontend/dist/_payload.json";
  } else if (
    pathname.startsWith("/cache/") &&
    pathname.endsWith("/_payload.json")
  ) {
    filePath = `frontend/dist${pathname}`;
  } else if (
    pathname.startsWith("/jobs/") &&
    pathname.endsWith("/_payload.json")
  ) {
    filePath = `frontend/dist${pathname}`;
  } else {
    return createErrorResponse("File not found", undefined, 404);
  }

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return createErrorResponse("File not found", undefined, 404);
    }

    const mimeType = getMimeType(filePath);
    const fileContent = await file.arrayBuffer();

    return new Response(fileContent, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": pathname.startsWith("/_nuxt/")
          ? "public, max-age=31536000"
          : "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error serving static file:", error);
    return createErrorResponse("Error reading file", undefined, 500);
  }
}

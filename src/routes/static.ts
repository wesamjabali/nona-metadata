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
 * Check if we're in production (Docker environment)
 */
const isProduction = async (): Promise<boolean> => {
  // Check if we have the production files in the current directory
  const indexExists = await Bun.file("index.html").exists();
  return indexExists;
};

/**
 * Get the HTML file path based on environment
 */
const getHtmlPath = async (path: string): Promise<string> => {
  const production = await isProduction();
  const basePath = production ? "." : "frontend/.output/public";
  const fileName = "index.html";

  return `${basePath}${path}/${fileName}`;
};

/**
 * Get the appropriate file path based on environment
 */
const getFilePath = async (pathname: string): Promise<string> => {
  const production = await isProduction();

  if (pathname === "/favicon.ico") {
    return production ? "favicon.ico" : "frontend/.output/public/favicon.ico";
  } else if (pathname.startsWith("/_nuxt/")) {
    return production ? `.${pathname}` : `frontend/.output/public${pathname}`;
  } else if (pathname === "/_payload.json") {
    return production
      ? "_payload.json"
      : "frontend/.output/public/_payload.json";
  } else if (
    pathname.startsWith("/cache/") &&
    pathname.endsWith("/_payload.json")
  ) {
    return production ? `.${pathname}` : `frontend/.output/public${pathname}`;
  } else if (
    pathname.startsWith("/jobs/") &&
    pathname.endsWith("/_payload.json")
  ) {
    return production ? `.${pathname}` : `frontend/.output/public${pathname}`;
  }

  return "";
};

/**
 * Handle any Vue route - serve the same HTML and let Vue Router handle client-side routing
 */
export async function handleVueRoute(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const htmlPath = await getHtmlPath(pathname);
  let htmlContent = "";
  try {
    htmlContent = await Bun.file(htmlPath).text();
  } catch {
    const notFoundPage = await Bun.file(
      "frontend/.output/public/404.html"
    ).text();
    return new Response(notFoundPage, {
      headers: { "Content-Type": "text/html" },
      status: 404,
    });
  }
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

  const filePath = await getFilePath(pathname);

  if (!filePath) {
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

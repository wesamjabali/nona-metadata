/**
 * CORS headers for all responses
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Handle preflight OPTIONS requests
 */
export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Create a JSON response with CORS headers
 */
export function createJsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

/**
 * Create an error response with CORS headers
 */
export function createErrorResponse(
  error: string,
  details?: string,
  status: number = 500
): Response {
  return createJsonResponse(
    {
      error,
      ...(details && { details }),
    },
    status
  );
}

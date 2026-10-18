import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { verifyApiToken } from "@/lib/api-tokens";
import { buildMcpServer } from "@/lib/mcp/server";

// AluminX MCP endpoint (Streamable HTTP, stateless). Every request carries a
// personal access token from the profile page: Authorization: Bearer alx_...
// The server is built per request and acts as that token's owner.

export const maxDuration = 60; // AI search and note drafting call Gemini

function unauthorized(message: string) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message }, id: null },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="aluminx", error="invalid_token"' } },
  );
}

async function handle(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return unauthorized("Missing token. Create one on your AluminX profile and send it as 'Authorization: Bearer <token>'.");

  let auth: Awaited<ReturnType<typeof verifyApiToken>>;
  try {
    auth = await verifyApiToken(token);
  } catch (e) {
    console.error("MCP token check failed:", e);
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "AluminX can't check tokens right now. Is the 6_api_tokens migration applied?" }, id: null },
      { status: 503 },
    );
  }
  if (!auth) return unauthorized("Invalid or revoked token.");

  // Stateless: no session ids, plain JSON responses, a fresh server per request.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = await buildMcpServer(auth.profileId);
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, {
      authInfo: { token, clientId: auth.tokenId, scopes: [], extra: { profileId: auth.profileId } },
    });
  } finally {
    // the response body is fully built in JSON mode, so the server can close now
    void server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };

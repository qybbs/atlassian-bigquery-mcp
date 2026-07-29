# BigQuery MCP Server

This project implements a stateless, federated Model Context Protocol (MCP) server for Google BigQuery, designed to integrate with Atlassian Rovo and other external MCP clients.

## Features

- **Stateless Architecture**: Zero database dependency. Uses JWE/JWS for state management via a single `MASTER_SECRET_KEY`.
- **Dynamic Client Registration (RFC 7591)**: Supports dynamic registration of MCP clients (e.g., Atlassian Rovo).
- **OAuth 2.1 Authorization Code Flow**: Implements a secure authorization flow with PKCE, currently utilizing a mock identity layer but architected to be SSO-ready.
- **BigQuery Integration**: Provides tools for listing datasets, listing tables, getting table schemas, and executing read-only queries safely.
- **Policy Engine**: Built-in AST-based parsing (simulated with robust regex/denylists) to strictly enforce read-only operations and limit data exfiltration (e.g., `LIMIT 1000`, `maximumBytesBilled`).
- **HTTP Transport**: Uses modern SSE/HTTP transport for remote MCP communication.

## Prerequisites

- Node.js (v18+)
- Google Cloud Project with BigQuery API enabled.
- A Google Cloud Service Account with BigQuery Data Viewer and BigQuery Job User roles.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd bigquery-mcp
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Environment Variables:**
    Create a `.env` file in the root directory and populate it with the following:

    ```env
    PORT=3000
    # Generate a random 32-byte base64 string for this
    MASTER_SECRET_KEY="your-secure-base64-encoded-32-byte-key-here"
    
    # Path to your Google Cloud Service Account JSON key file
    GOOGLE_APPLICATION_CREDENTIALS="./your-service-account-key.json"
    
    # Your Google Cloud Project ID
    GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
    ```
    *Note: Do not commit your service account key file.*

4.  **Build the project:**
    ```bash
    npm run build
    ```

## Running the Server

**Development Mode (with auto-reload):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

## Exposing Locally (for testing with external clients)

To test the OAuth flow with external clients like Atlassian Rovo, you need to expose your local server to the internet. You can use tools like ngrok or Cloudflare Tunnels:

```bash
# Using ngrok
ngrok http 3000
```

Update your client configuration to point to the generated ngrok/Cloudflare URL.

## TypeScript Version Compatibility Note
If you encounter `TypeError: Cannot read properties of undefined (reading 'fileExists')` when running `npm run dev` with `ts-node-dev`, it is likely due to compatibility issues with newer or beta TypeScript versions.
To fix this, ensure you use stable versions in `package.json` (such as TypeScript `5.7.3` and `@types/node` matched to your Node environment, e.g., `@types/node@20`):
```bash
npm install -D typescript@5.7.3 @types/node@20 ts-node-dev
```

## Local Testing (Simulation Workflow)
Before connecting to Atlassian Rovo, you can test the entire registration, OAuth 2.1 authentication (mock login), and JSON-RPC tool calling locally.

### 1. Dynamic Client Registration (DCR)
Register a mock client (using `https://httpbin.org/get` as a redirect URI helper to inspect redirected parameters):
```bash
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '\''{
    "client_name": "Local Test Client",
    "redirect_uris": ["https://httpbin.org/get"]
  }'\''
```
*Save the `client_id` returned in the JSON response.*

### 2. Authorization Code (PKCE Sim)
Construct the authorization URL, replacing `<CLIENT_ID>` with the one from Step 1:
```text
http://localhost:3000/oauth/authorize?client_id=<CLIENT_ID>&redirect_uri=https://httpbin.org/get&code_challenge=test_verifier_123&code_challenge_method=plain&state=test_state
```
1. Open the URL in your browser.
2. Log in using `user@astrapay.com` and password `ap-secret-password`.
3. The page will redirect you to `httpbin.org`.
4. Copy the `code` query parameter value from the browser's address bar or the JSON response.

### 3. Token Exchange
Exchange the authorization code for a JWT Access Token:
```bash
curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/json" \
  -d '\''{
    "grant_type": "authorization_code",
    "client_id": "<CLIENT_ID>",
    "code": "<AUTHORIZATION_CODE>",
    "redirect_uri": "https://httpbin.org/get",
    "code_verifier": "test_verifier_123"
  }'\''
```
*Save the `access_token` returned in the JSON response.*

### 4. Calling MCP Tools
Use the `access_token` as a Bearer token to communicate with the `/mcp` transport:

* **List Tools:**
  ```bash
  curl -X POST http://localhost:3000/mcp \
    -H "Authorization: Bearer <ACCESS_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '\''{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}'\''
  ```

* **List Allowed Tables:**
  ```bash
  curl -X POST http://localhost:3000/mcp \
    -H "Authorization: Bearer <ACCESS_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '\''{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "list_allowed_tables", "arguments": {}}, "id": 2}'\''
  ```

* **Execute Readonly Query:**
  ```bash
  curl -X POST http://localhost:3000/mcp \
    -H "Authorization: Bearer <ACCESS_TOKEN>" \
    -H "Content-Type: application/json" \
    -d '\''{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "execute_readonly_query", "arguments": {"sql": "SELECT COUNT(1) FROM `bigquery-public-data.chicago_taxi_trips.taxi_trips`"}}, "id": 3}'\''
  ```

## License
MIT

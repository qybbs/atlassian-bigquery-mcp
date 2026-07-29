# BigQuery MCP Server

This project implements a stateless, federated Model Context Protocol (MCP) server for Google BigQuery, designed to integrate with Atlassian Rovo and other external MCP clients.

## Features

- **Stateless Architecture**: Zero database dependency. Uses JWE/JWS for state management via a single `MASTER_SECRET_KEY`.
- **Dynamic Client Registration (RFC 7591)**: Supports dynamic registration of MCP clients (e.g., Atlassian Rovo).
- **OAuth 2.1 Authorization Code Flow**: Implements a secure authorization flow with PKCE, currently utilizing a mock identity layer but architected to be SSO-ready.
- **BigQuery Integration**: Provides tools for listing datasets, listing tables, getting table schemas, and executing read-only queries safely.
- **Policy Engine**: Built-in AST-based parsing (simulated with robust regex/denylists) to strictly enforce read-only operations and limit data exfiltration (e.g., `LIMIT 1000`, `maximumBytesBilled`).
- **HTTP Transport**: Uses modern SSE/HTTP transport for remote MCP communication.

## Repository Layout

```
bigquery-mcp/
├── src/                    # TypeScript Source Code
│   ├── server.ts           # Express Application Entry Point
│   ├── oauth.ts            # DCR, OAuth 2.1, and OIDC Flow Handlers
│   ├── mcp.ts              # MCP JSON-RPC Server Router & Policy Engine
│   └── bigquery.ts         # Google BigQuery API Integration & Tools
├── docs/                   # Documentation files
│   └── custom-mcp-solutioning.md  # Architectural Decision & Details
├── .github/                # GitHub Configurations
│   └── CODEOWNERS          # Code owners definition
├── Dockerfile              # Docker container configuration
├── docker-compose.yaml     # Local container setup (Service + Key binding)
├── cloudbuild.yaml         # GCP Cloud Build deployment pipeline
├── LICENSE                 # Open-source MIT License file
├── .env                    # Local environment config (secrets) - NOT committed
└── .env.example            # Environment variables example template
```

## Prerequisites

- Node.js (v18+)
- Google Cloud Project with BigQuery API enabled.
- **Google Cloud Service Account (GCP IAM)**:
  - `roles/bigquery.dataViewer` (Required to read table schemas and rows).
  - `roles/bigquery.jobUser` (Required to run queries and dry-runs).

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
    
    # Authentication Mode: MOCK or OIDC
    AUTH_PROVIDER=OIDC
    OIDC_CLIENT_ID=your-oidc-client-id
    OIDC_CLIENT_SECRET=your-oidc-client-secret
    OIDC_AUTHORIZATION_ENDPOINT=https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
    OIDC_TOKEN_ENDPOINT=https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
    OIDC_REDIRECT_URI=https://your-tunnel-domain.trycloudflare.com/oauth/callback
    ```
    *Note: Do not commit your service account key file or OIDC secrets.*

4.  **Build the project:**
    ```bash
    npm run build
    ```

## Enterprise Integration Setup

### 1. Microsoft Entra ID (SSO) Integration
To enable OAuth 2.1 authorization for internal employees:
1. Go to **Azure Portal > Microsoft Entra ID > App Registrations**.
2. Create a new registration.
3. Under Authentication, add a **Web** platform and set the Redirect URI to `https://<your-mcp-domain>/oauth/callback`.
4. Generate a Client Secret.
5. Configure your `.env` file with `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and endpoints corresponding to your tenant.

### 2. Atlassian Rovo Integration
To connect this MCP server to your Atlassian workspace:
1. Go to **Atlassian Administration > Settings > External MCP Servers**.
2. Click **Add MCP Server**.
3. In the setup wizard, input the Dynamic Client Registration (DCR) endpoint of your server: `https://<your-mcp-domain>/register`.
4. Rovo will automatically register itself and exchange credentials.
5. In **Atlassian Studio**, create or edit your Rovo Agent and map the available tools (`search_allowed_tables`, `execute_readonly_query`, etc.) and provide Custom Instructions guiding the agent to use them.

## Production Deployment (Google Cloud Run)

This repository is designed to be deployed to Google Cloud Run as a stateless container.

### Docker Containerization
A standard `Dockerfile` (Node.js 18+ base) should be used to build the image:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Deployment Commands
Use Google Cloud Build and Artifact Registry:
```bash
# Build and push to Artifact Registry
gcloud builds submit --tag asia-southeast1-docker.pkg.dev/<GCP_PROJECT>/<REPO_NAME>/bigquery-mcp:latest

# Deploy to Cloud Run (Unauthenticated is NOT allowed, authentication is handled by application layer)
gcloud run deploy bigquery-mcp \
  --image asia-southeast1-docker.pkg.dev/<GCP_PROJECT>/<REPO_NAME>/bigquery-mcp:latest \
  --region asia-southeast1 \
  --no-allow-unauthenticated \
  --set-env-vars="MASTER_SECRET_KEY=...,AUTH_PROVIDER=OIDC,..."
```

## Health Checking & Monitoring

The service exposes the following endpoints for liveness and readiness probes in Cloud Run or Kubernetes:
- `GET /` and `GET /health`
  Returns `{"status": "ok", "service": "Atlassian BigQuery MCP Server"}` (HTTP 200).

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
Register a mock client (using `https://httpbin.io/get` as a redirect URI helper to inspect redirected parameters):
```bash
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Local Test Client",
    "redirect_uris": ["https://httpbin.io/get"]
  }'
```
*Save the `client_id` returned in the JSON response.*

### 2. Authorization Code (PKCE Sim)
Construct the authorization URL, replacing `<CLIENT_ID>` with the one from Step 1:
```text
http://localhost:3000/oauth/authorize?client_id=<CLIENT_ID>&redirect_uri=https://httpbin.io/get&code_challenge=test_verifier_123&code_challenge_method=plain&state=test_state
```
1. Open the URL in your browser.
2. Log in using `user@example.com` and password `secret-password`.
3. The page will redirect you to `httpbin.io`.
4. Copy the `code` query parameter value from the browser's address bar or the JSON response.

### 3. Token Exchange
Exchange the authorization code for a JWT Access Token:
```bash
curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "client_id": "<CLIENT_ID>",
    "code": "<AUTHORIZATION_CODE>",
    "redirect_uri": "https://httpbin.io/get",
    "code_verifier": "test_verifier_123"
  }'
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
    -d '{"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "execute_readonly_query", "arguments": {"sql": "SELECT COUNT(1) FROM `bigquery-public-data.chicago_taxi_trips.taxi_trips`"}}, "id": 3}'
  ```

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `401 Unauthorized` | Invalid or expired JWT Bearer Token. Ensure the token exchange in Step 3 succeeded and that the correct token is copied. |
| `Rejected: Query mengandung keyword terlarang` | The query contains non-SELECT operations (e.g. `INSERT`, `UPDATE`, `DROP`) or denied keywords. The Policy Engine enforces strictly read-only execution. |
| `Rejected: Tabel "..." tidak terdaftar` | You are attempting to query a table not configured in the `ALLOWLIST_TABLES` environment variable. |
| `maximumBytesBilled limit exceeded` | The query scans more bytes than allowed by `MAX_BYTES_BILLED` in `.env` (default 1GB). Optimize your query using partition filters or increase limits in `.env`. |
| `DCR Endpoint error (400 Bad Request)` | Client registration failed. Ensure the request payload conforms to RFC 7591 (e.g. valid `redirect_uris`). |
| `TypeScript fileExists error` | Compatibility issue with newer/beta TypeScript version. Run `npm install -D typescript@5.7.3 @types/node@20 ts-node-dev` as detailed in the TypeScript compatibility note. |

## Security Notes

- **Secrets Management**: The `.env` file and your Google Service Account key file contain highly sensitive credentials and **must never be committed** to git. Keep them listed in `.gitignore`.
- **Key Rotation**: Rotate the `MASTER_SECRET_KEY` periodically. Note that rotating this key will invalidate all existing active sessions/tokens generated with the previous key.
- **TLS/HTTPS Requirement**: In a production environment (such as Google Cloud Run), ensure the server is configured to run behind HTTPS/TLS 1.2+ to secure all OAuth endpoints and tool-calling transactions in transit.
- **IAM Minimization**: The GCP Service Account used by this MCP server should strictly be granted only `roles/bigquery.dataViewer` and `roles/bigquery.jobUser` roles to prevent unauthorized access to other GCP resources.
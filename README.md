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

## Documentation

- [Custom MCP Solutioning](./docs/custom-mcp-solutioning.md): Detailed architectural decisions and identity flow design.

## License
MIT

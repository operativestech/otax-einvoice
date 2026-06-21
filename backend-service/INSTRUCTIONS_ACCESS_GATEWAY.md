# Shared Signing Gateway - Setup Instructions

The **Shared Signing Gateway** allows a single "Master PC" (with the USB Token) to handle signing requests for the entire company.

## 🚀 How to Start the Agent (Master PC)

1.  Open a terminal in this directory (`backend-service`).
2.  Run the agent script:
    ```bash
    npx ts-node agent/agent.ts
    ```
3.  You should see:
    ```
    [Agent] Connecting to Cloud...
    [Agent] Connected!
    ```
    *Note: A file `agent/agent_config.json` will be created to remember this PC's unique Node ID.*

## 🌐 How to Register the Certificate

1.  Keep the Agent running.
2.  Open the OTax Web Application.
3.  Go to **Token Signature Settings**.
4.  The "Shared Signing Gateway" status should be **Live (Green)**.
5.  Click **"Read Certificates"**.
6.  Select your USB Token certificate and enter the PIN.
7.  Click **"Use Selected Certificate"**.
8.  **Success!** The certificate is now registered in the Cloud and shared with all users.

## 🛠️ Troubleshooting

*   **"Company is locked to another Signing PC"**:
    *   If you moved to a new computer, go to the Web Dashboard and click **"Reset Node"**.
*   **"Agent not connected"**:
    *   Ensure the terminal running `agent.ts` is still open and wasn't closed.
*   **"C# Signer failed"**:
    *   Ensure `EInvoicingSigner.exe` is in the `EInvoicingSigner` folder inside `backend-service`.

## 📂 Architecture Files

*   `agent/agent.ts`: The local Node.js script that bridges Cloud <-> USB Token.
*   `server/server.ts`: The Backend which manages the WebSocket Hub (`activeAgents`) and database (`signing_nodes`).
*   `EInvoicingSigner/`: The C# Tool used by the agent to perform the actual cryptographic signing.

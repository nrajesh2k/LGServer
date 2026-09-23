// Node 18+ required (uses the built-in global fetch).
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com",
  PORT = 8080,
} = process.env;

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error(
    "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET. Copy .env.example to .env and fill them in."
  );
  process.exit(1);
}

// Authoritative product catalog — never trust a price sent from the browser.
const CATALOG = {
  "wireless-keyboard-01": { name: "Wireless Keyboard", price: "49.99" },
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ------------------------------------------------------------------ *
 * OAuth: exchange client id/secret for a server-side access token
 * ------------------------------------------------------------------ */

async function getAccessToken() {
  const credentials = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OAuth token request failed: ${detail}`);
  }

  const data = await response.json();
  return data.access_token;
}

/* ------------------------------------------------------------------ *
 * Public config — only the client ID is ever sent to the browser
 * ------------------------------------------------------------------ */

app.get("/api/config", (req, res) => {
  res.json({ clientId: PAYPAL_CLIENT_ID });
});

/* ------------------------------------------------------------------ *
 * Create order
 * ------------------------------------------------------------------ */

app.post("/paypal-api/checkout/orders/create", async (req, res) => {
  try {
    const { sku } = req.body || {};
    const product = CATALOG[sku];

    if (!product) {
      return res.status(400).json({ error: "Unknown SKU" });
    }

    const accessToken = await getAccessToken();

    const orderResponse = await fetch(
      `${PAYPAL_API_BASE}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: {
                currency_code: "USD",
                value: product.price,
              },
              description: product.name,
            },
          ],
        }),
      }
    );

    const orderData = await orderResponse.json();

    if (!orderResponse.ok) {
      console.error("Create order failed:", orderData);
      return res.status(orderResponse.status).json(orderData);
    }

    res.json(orderData); // Client reads `data.id` as orderId
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

/* ------------------------------------------------------------------ *
 * Capture order
 * ------------------------------------------------------------------ */

app.post("/paypal-api/checkout/orders/:orderId/capture", async (req, res) => {
  try {
    const { orderId } = req.params;
    const accessToken = await getAccessToken();

    const captureResponse = await fetch(
      `${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const captureData = await captureResponse.json();

    if (!captureResponse.ok) {
      console.error("Capture failed:", captureData);
      return res.status(captureResponse.status).json(captureData);
    }

    res.json(captureData);
  } catch (error) {
    console.error("Capture order error:", error);
    res.status(500).json({ error: "Failed to capture order" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

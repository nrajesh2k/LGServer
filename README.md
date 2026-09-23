# PayPal JS SDK v6 — Custom Modal Checkout

A demo checkout that opens a custom (non-native) modal containing PayPal's
smart payment buttons — **PayPal**, **Pay Later**, and **Debit/Credit Card** —
rendered with the PayPal JS SDK v6. Clicking any button closes the modal and
opens the payment session in a real browser **popup**.

## How it works

- **Frontend** (`public/`): plain HTML/CSS/JS. `app.js` initializes the SDK
  with `window.paypal.createInstance()`, checks eligibility with
  `findEligibleMethods()`, and reveals only the buttons the buyer qualifies
  for. Each button gets its own payment session
  (`createPayPalOneTimePaymentSession`, `createPayLaterOneTimePaymentSession`,
  `createPayPalGuestOneTimePaymentSession`) started with
  `{ presentationMode: "popup" }`.
- **Backend** (`server.js`): an Express server that keeps your client secret
  off the browser. It exchanges credentials for an access token, creates
  orders against the authoritative server-side price (never trusting a
  client-supplied amount), and captures orders after approval.

## Setup

```bash
npm install
cp .env.example .env
# then edit .env with your PayPal sandbox client ID and secret
npm start
```

Open http://localhost:8080.

## Endpoints

| Method | Path                                        | Purpose                        |
|--------|---------------------------------------------|---------------------------------|
| GET    | `/api/config`                                | Returns the public client ID   |
| POST   | `/paypal-api/checkout/orders/create`         | Creates a PayPal order         |
| POST   | `/paypal-api/checkout/orders/:orderId/capture` | Captures an approved order    |

## Going to production

- Switch the SDK script tag in `public/index.html` from
  `https://www.sandbox.paypal.com/web-sdk/v6/core` to
  `https://www.paypal.com/web-sdk/v6/core`.
- Set `PAYPAL_API_BASE=https://api-m.paypal.com` and use live credentials.
- Popups can be blocked by browsers if `session.start()` isn't called
  synchronously within the click handler — keep the click listener structure
  in `app.js` as-is (no `await` before calling `.start()`).

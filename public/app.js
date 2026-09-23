/**
 * Client-side integration for PayPal JS SDK v6.
 *
 * Flow:
 *  1. Wait for the SDK script to load AND fetch the public client ID from our server.
 *  2. Initialize the SDK with createInstance() and check payment eligibility.
 *  3. Reveal only the eligible buttons inside the custom modal.
 *  4. On button click: close the modal, then start the payment session in a
 *     real browser popup (presentationMode: "popup").
 */

const CURRENCY_CODE = "USD";

const modal = document.getElementById("payment-modal");
const openModalBtn = document.getElementById("open-modal-btn");
const closeModalBtn = document.getElementById("modal-close-btn");
const statusLine = document.getElementById("eligibility-status");
const errorBox = document.getElementById("payment-error");

let sdkInstance = null;
let sdkReadyPromise = null;

/* ---------------------------------------------------------------- *
 * Modal controls
 * ---------------------------------------------------------------- */

function openModal() {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
}

closeModalBtn.addEventListener("click", closeModal);

// Close on backdrop click (but not when clicking inside the modal card)
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});

// Close on Escape
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) closeModal();
});

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

/* ---------------------------------------------------------------- *
 * Server calls
 * ---------------------------------------------------------------- */

async function fetchClientConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error("Unable to load payment configuration");
  return response.json(); // { clientId }
}

async function createOrder() {
  const response = await fetch("/paypal-api/checkout/orders/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Only a product identifier goes to the server — the server looks up
    // the authoritative price itself rather than trusting a client-sent amount.
    body: JSON.stringify({ sku: "wireless-keyboard-01" }),
  });

  if (!response.ok) throw new Error("Failed to create order");
  const data = await response.json();
  return { orderId: data.id }; // Required shape for v6
}

async function captureOrder(orderId) {
  const response = await fetch(
    `/paypal-api/checkout/orders/${orderId}/capture`,
    { method: "POST" }
  );
  if (!response.ok) throw new Error("Failed to capture order");
  return response.json();
}

/* ---------------------------------------------------------------- *
 * SDK bootstrap
 * ---------------------------------------------------------------- */

function waitForSdkScript() {
  return new Promise((resolve) => {
    if (window.paypal) return resolve();
    window.addEventListener("paypal-sdk-loaded", () => resolve(), { once: true });
  });
}

async function initializeSdk() {
  const [, config] = await Promise.all([waitForSdkScript(), fetchClientConfig()]);

  sdkInstance = await window.paypal.createInstance({
    clientId: config.clientId,
    components: ["paypal-payments", "venmo-payments", "paypal-guest-payments"],
    pageType: "checkout",
  });

  return sdkInstance;
}

// Kick off SDK init as soon as the page loads (don't block the UI on it).
sdkReadyPromise = initializeSdk().catch((error) => {
  console.error("SDK initialization error:", error);
  return null;
});

/* ---------------------------------------------------------------- *
 * Shared payment session callbacks
 * ---------------------------------------------------------------- */

function buildSessionOptions(buttonEl) {
  return {
    async onApprove(data) {
      try {
        const orderData = await captureOrder(data.orderId);
        console.log("Payment captured:", orderData);
        window.location.href = `/order-confirmation.html?orderId=${data.orderId}`;
      } catch (error) {
        console.error("Capture failed:", error);
        showError("We couldn't complete your payment. Please try again.");
      }
    },
    onCancel(data) {
      console.log("Payment cancelled:", data);
      if (buttonEl) buttonEl.disabled = false;
    },
    onError(error) {
      console.error("Payment error:", error);
      showError("Something went wrong during checkout. Please try again.");
    },
  };
}

/* ---------------------------------------------------------------- *
 * Button setup — each button gets its own payment session
 * ---------------------------------------------------------------- */

async function setupPayPalButton(instance) {
  const buttonEl = document.getElementById("paypal-button");
  const session = instance.createPayPalOneTimePaymentSession(
    buildSessionOptions(buttonEl)
  );

  buttonEl.hidden = false;

  buttonEl.addEventListener("click", async () => {
    clearError();
    closeModal(); // Close the custom modal right away…
    try {
      // …then open the real PayPal payment session in a new popup window.
      await session.start({ presentationMode: "popup" }, createOrder());
    } catch (error) {
      console.error("PayPal session start error:", error);
      showError("Couldn't open PayPal. Check your popup blocker and try again.");
    }
  });
}

async function setupPayLaterButton(instance, details) {
  const buttonEl = document.getElementById("paypal-paylater-button");
  const session = instance.createPayLaterOneTimePaymentSession(
    buildSessionOptions(buttonEl)
  );

  buttonEl.productCode = details.productCode;
  buttonEl.countryCode = details.countryCode;
  buttonEl.hidden = false;

  buttonEl.addEventListener("click", async () => {
    clearError();
    closeModal();
    try {
      await session.start({ presentationMode: "popup" }, createOrder());
    } catch (error) {
      console.error("Pay Later session start error:", error);
      showError("Couldn't open Pay Later. Check your popup blocker and try again.");
    }
  });
}

async function setupCardButton(instance) {
  const buttonEl = document.getElementById("paypal-card-button");
  const session = await instance.createPayPalGuestOneTimePaymentSession(
    buildSessionOptions(buttonEl)
  );

  buttonEl.hidden = false;

  buttonEl.addEventListener("click", async () => {
    clearError();
    closeModal();
    try {
      await session.start({ presentationMode: "popup" }, createOrder());
    } catch (error) {
      console.error("Card session start error:", error);
      showError("Couldn't open the card checkout. Please try again.");
    }
  });
}

/* ---------------------------------------------------------------- *
 * Eligibility check — only wire up buttons that are actually eligible
 * ---------------------------------------------------------------- */

async function renderEligibleButtons() {
  const instance = await sdkReadyPromise;
  if (!instance) {
    statusLine.textContent = "";
    showError("Payment methods are unavailable right now.");
    return;
  }

  const paymentMethods = await instance.findEligibleMethods({
    currencyCode: CURRENCY_CODE,
  });

  const setups = [];
  if (paymentMethods.isEligible("paypal")) {
    setups.push(setupPayPalButton(instance));
  }
  if (paymentMethods.isEligible("paylater")) {
    setups.push(
      setupPayLaterButton(instance, paymentMethods.getDetails("paylater"))
    );
  }
  if (paymentMethods.isEligible("card")) {
    setups.push(setupCardButton(instance));
  }

  await Promise.all(setups);
  statusLine.textContent = setups.length
    ? "Select a payment method below."
    : "";

  if (!setups.length) {
    showError("No payment methods are available for this checkout.");
  }
}

let buttonsRendered = false;

openModalBtn.addEventListener("click", async () => {
  openModal();
  clearError();
  if (!buttonsRendered) {
    buttonsRendered = true;
    await renderEligibleButtons();
  }
});

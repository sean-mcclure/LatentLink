# LatentLink Webhook Server

This is a standalone webhook server for handling Stripe credit-pack purchases and account-protection events for LatentLink v2.

## Setup

1. **Update credentials in `index.js`**:
   - Replace the placeholder Back4App credentials with your actual App ID, JavaScript Key, and Master Key
   - The Stripe keys are already configured

2. **Add metadata to your Stripe products and prices**:
   - Go to Stripe Dashboard → Products → each LatentLink credit pack
   - Add product metadata: `app` = `latentlink`
   - Add price metadata: `pack_tier` and `credits`
   - The webhook reads these values to create the `CreditBatch`

3. **Deploy to Back4App Web Deployment**:
   - Create a new Web Deployment in Back4App
   - Connect this repository or upload these files
   - Back4App will use the Dockerfile to build and deploy

4. **Update Stripe webhook URL**:
   - Go to Stripe Dashboard → Webhooks
   - Update the endpoint URL to your Back4App Web Deployment URL + `/webhook`
   - Example: `https://your-deployment.back4app.io/webhook`

## Testing Locally

```bash
npm install
node index.js
```

Then use Stripe CLI to forward webhooks:
```bash
stripe listen --forward-to localhost:3000/webhook
```

## How It Works

1. Stripe sends `checkout.session.completed` when a credit pack is purchased
2. Webhook verifies the Stripe signature
3. Reads product metadata to determine which app (latentlink)
4. Creates a `StripeEvent` record for idempotency
5. Creates a `CreditBatch` with a 12-month expiration date
6. Updates user with:
   - `stripeCustomerId`
   - `credits_balance`

It also handles `charge.refunded` and `charge.dispute.created` so refunded or disputed purchases can freeze or adjust credit access.

# LatentLink Setup Guide

Complete setup instructions for deploying LatentLink with Back4App and Stripe.

## Prerequisites

1. **Back4App Account**: Sign up at [https://www.back4app.com/](https://www.back4app.com/)
2. **Stripe Account**: Sign up at [https://stripe.com/](https://stripe.com/)
3. **OpenAI API Key**: Get from [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

## Step 1: Back4App Setup

### 1.1 Create a New App

1. Log in to Back4App Dashboard
2. Click "Build new app"
3. Name it "LatentLink"
4. Choose a region close to your users

### 1.2 Get Your Credentials

1. Go to **App Settings** → **Security & Keys**
2. Copy these values:
   - **Application ID**
   - **JavaScript Key**
   - **Master Key** (keep this secret!)

### 1.3 Configure App Settings

1. Go to **App Settings** → **Server Settings**
2. Set **App Name**: `LatentLink`
3. Enable **Email Verification** (optional but recommended)

### 1.4 Deploy Cloud Code

1. Go to **Cloud Code** → **Functions**
2. Copy the entire contents of `/cloud/main.js`
3. Paste into the Cloud Code editor
4. Click **Deploy**

### 1.5 Set Environment Variables

1. Go to **App Settings** → **Server Settings** → **Environment Variables**
2. Add these variables:

```
STRIPE_SECRET_KEY=sk_test_... (your Stripe secret key)
STRIPE_WEBHOOK_SECRET=whsec_... (from Stripe webhook setup)
OPENAI_API_KEY=sk-... (your OpenAI API key)
APP_URL=https://yourdomain.com (your app URL)
STRIPE_STARTER_PRICE_ID=price_... (5-credit pack)
STRIPE_RESEARCHER_PRICE_ID=price_... (20-credit pack)
STRIPE_LAB_PRICE_ID=price_... (75-credit pack)
STRIPE_RESEARCHER_COUPON_ID=coupon_... (20% researcher discount)
```

### 1.6 Create Back4App Classes

Back4App can auto-create classes the first time the app writes to them, but for this v2 you should create the schema intentionally so field types, ACL expectations, and any indexes are correct.

Create these classes in **Database Browser**:

#### `_User` additions

Add these fields to the built-in user class:

- `credits_balance` — Number
- `free_credits_used` — Boolean
- `is_verified_researcher` — Boolean
- `verification_method` — String
- `institutional_email` — String
- `orcid_id` — String
- `researcher_verified_at` — Date
- `stripeCustomerId` — String
- `purchase_frozen` — Boolean
- `purchase_hold_reason` — String

Recommended defaults for new users:

- `credits_balance = 0`
- `free_credits_used = false`
- `is_verified_researcher = false`
- `purchase_frozen = false`

#### `CreditBatch`

Create a class named `CreditBatch` with these fields:

- `user` — Pointer `_User`
- `credits_initial` — Number
- `credits_remaining` — Number
- `expires_at` — Date
- `stripe_session_id` — String
- `stripe_payment_intent_id` — String
- `pack_tier` — String
- `amount_paid_cents` — Number
- `researcher_discount_applied` — Boolean

Recommended index:

- Composite lookup path for credit consumption: `user`, `expires_at`, `credits_remaining`

#### `Analysis`

Create a class named `Analysis` with these fields:

- `user` — Pointer `_User`
- `manuscript_title` — String
- `title` — String
- `manuscript` — Object
- `manuscript_text` — String
- `manuscript_hash` — String
- `fingerprint` — Object
- `correspondences` — Array
- `field_rendering` — Object
- `renderings` — Array
- `candidates` — Array
- `verification_summary` — Object
- `verificationSummary` — Object
- `pipeline` — Array
- `field` — String
- `credits_charged` — Number
- `note` — String
- `parent_analysis` — Pointer `Analysis`

Recommended index:

- `user`, `updatedAt`
- `user`, `manuscript_hash`

#### `Pin`

Create a class named `Pin` with these fields:

- `user` — Pointer `_User`
- `analysis` — Pointer `Analysis`
- `correspondence_id` — String
- `annotation` — String
- `is_relevant` — Boolean

Recommended index:

- `user`, `analysis`, `correspondence_id`

#### `StripeEvent`

Create a class named `StripeEvent` with these fields:

- `event_id` — String
- `event_type` — String
- `processed_at` — Date
- `payload` — Object

Recommended index:

- Unique on `event_id`

#### Permissions

Recommended CLP posture:

- `Analysis`: no public read/write, authenticated create allowed, object ACL enforced
- `Pin`: no public read/write, authenticated create allowed, object ACL enforced
- `CreditBatch`: no public create/update/delete from client, server-side only
- `StripeEvent`: server-side only

The current client code writes `Analysis` and `Pin` directly through Parse, so those two classes must allow authenticated client writes unless you move those saves into Cloud Code.

---

## Step 2: Stripe Setup

### 2.1 Create Credit-Pack Products

1. Log in to Stripe Dashboard
2. Create three one-time products: Starter, Researcher, Lab
3. Add one one-time price to each product
4. Add price metadata:
   - `pack_tier`: `starter` | `researcher` | `lab`
   - `credits`: `5` | `20` | `75`
5. Add product metadata: `app=latentlink`
6. Copy each **Price ID** into the corresponding environment variable above
7. Optionally create a 20% off coupon and store its ID in `STRIPE_RESEARCHER_COUPON_ID`

Use these exact products/prices:

- Starter Pack: 5 credits, `$19`
- Researcher Pack: 20 credits, `$59`
- Lab Pack: 75 credits, `$179`

If you use the coupon flow in the current code, do not create separate discounted prices. The verified-researcher discount is applied by `STRIPE_RESEARCHER_COUPON_ID` at checkout.

### 2.2 Set Up Webhook

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: your deployed webhook receiver + `/webhook`
4. Select these events:
   - `checkout.session.completed`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_...`)
7. Add this to Back4App environment variables as `STRIPE_WEBHOOK_SECRET`

### 2.3 Get API Keys

1. Go to **Developers** → **API keys**
2. Copy:
   - **Publishable key** (starts with `pk_test_...`)
   - **Secret key** (starts with `sk_test_...`)

---

## Step 3: Configure Frontend

### 3.1 Update Back4App Config

Edit `app/scripts/back4app-config.js`:

```javascript
const BACK4APP_CONFIG = {
    applicationId: 'YOUR_APPLICATION_ID', // From Back4App
    javascriptKey: 'YOUR_JAVASCRIPT_KEY', // From Back4App
    serverURL: 'https://parseapi.back4app.com'
};

const STRIPE_CONFIG = {
   publishableKey: 'pk_test_...' // From Stripe
};
```

### 3.2 Test Locally

```bash
python3 -m http.server 8888 --directory app
```

Open `http://localhost:8888/`

---

## Step 4: Deploy to Production

### Option A: Deploy to Back4App Hosting

1. Go to **Web Hosting** in Back4App Dashboard
2. Upload your `app/` folder
3. Set custom domain (optional)

### Option B: Deploy to Vercel/Netlify

1. Push code to GitHub
2. Connect to Vercel/Netlify
3. Set build directory to `app/`
4. Deploy

### Option C: Deploy to Your Own Server

1. Upload `app/` folder to your web server
2. Configure HTTPS (required for Stripe)
3. Point domain to server

---

## Step 5: Testing

### 5.1 Test Signup Flow

1. Create a new account
2. Verify email (if enabled)
3. Should see the main workspace if the free analysis is unused
4. If free analysis is already used and no paid credits exist, the pricing page should appear

### 5.2 Test Stripe Checkout

Use Stripe test cards:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Any future expiry date and CVC

### 5.3 Test Discovery Flow

1. Run the first analysis without a paid credit
2. Confirm `_User.free_credits_used` flips to `true`
3. Buy a test credit pack in Stripe Checkout
4. Confirm a `CreditBatch` row is created by the webhook
5. Confirm `_User.credits_balance` increases
6. Run another fresh analysis and confirm balance decrements by `1`

---

## Step 6: Go Live

### 6.1 Switch to Production Keys

1. **Stripe**: Switch from test to live keys
2. **OpenAI**: Ensure production API key is set
3. Update `STRIPE_WEBHOOK_SECRET` with live webhook secret

### 6.2 Update Environment Variables

In Back4App, update all environment variables to production values.

### 6.3 Test Production

1. Create real account
2. Make a real credit-pack purchase
3. Test full analysis flow
4. Verify webhooks create `CreditBatch` rows and increment `credits_balance`

---

## Monitoring & Maintenance

### Usage Tracking

Monitor in Back4App Dashboard:
- **Database Browser** → **User** class
- Check `credits_balance`, `free_credits_used`, and researcher verification fields
- Check `CreditBatch`, `Analysis`, `Pin`, and `StripeEvent` rows

### Stripe Dashboard

Monitor:
- Completed checkouts
- Failed payments
- Refunds and disputes

### OpenAI Usage

Monitor API costs:
- [OpenAI Usage Dashboard](https://platform.openai.com/usage)
- Set up billing alerts

---

## Troubleshooting

### "Must be logged in" Error
- Check Back4App credentials in config
- Verify Parse SDK is loaded
- Check browser console for errors

### "No credits available" Error
- Check `_User.free_credits_used`
- Check `_User.credits_balance`
- Confirm a non-expired `CreditBatch` exists
- Ensure webhook secret and price metadata are correct

### Stripe Webhook Not Working
- Verify endpoint URL is correct
- Check webhook signing secret
- Test webhook in Stripe Dashboard

---

## Cost Estimates

### Per User Per Month

**Revenue**: $9.99

**Costs**:
- OpenAI API: ~$0.65 (100 discoveries)
- Stripe fees: ~$0.59 (2.9% + $0.30)
- Back4App: Free tier (up to 25k requests/month)

**Net Profit**: ~$8.75 per user (88% margin)

### Scaling

- 100 users: $875/month profit
- 1,000 users: $8,750/month profit
- 10,000 users: $87,500/month profit

**Note**: Back4App paid plans start at $5/month for higher limits.

---

## Support

For issues:
1. Check Back4App logs: **Core** → **Logs**
2. Check Stripe events: **Developers** → **Events**
3. Check browser console for frontend errors

---

## Security Checklist

- [ ] OpenAI API key stored in Back4App environment variables (not in frontend)
- [ ] Stripe secret key stored in Back4App environment variables
- [ ] Master Key never exposed to frontend
- [ ] HTTPS enabled on production domain
- [ ] Webhook signing secret configured
- [ ] Email verification enabled (optional)
- [ ] Rate limiting configured (optional)

---

## Next Steps

1. Customize pricing/features
2. Add more payment options
3. Implement team accounts
4. Add usage analytics
5. Create admin dashboard
6. Add email notifications
7. Implement referral program

---

**Questions?** Open an issue on GitHub or contact support.

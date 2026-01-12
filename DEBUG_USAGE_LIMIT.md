# Debug: Usage Limit Error

## Issue
Users get "usage limit" error despite OpenAI dashboard showing usage is nowhere near the limit.

## Root Cause
The error is NOT from OpenAI - it's from your **local application usage tracking system** in `scripts/notebooks.js`.

### The Problem:
1. In `canGenerateMore()` (notebooks.js:227), the code checks: `if (subscriptionStatus === 'active')`
2. If subscription status is NOT `'active'`, it treats the user as a free user
3. Free users can only generate once per type per notebook
4. **The user's subscription status is likely not being set to 'active' in the Parse database, even though they have a valid Stripe subscription**

## Why This Happens

### Possible Causes:
1. **Stripe webhook not firing or failing**: The `checkout.session.completed` event in Back4App's Cloud Code isn't being triggered
2. **Subscription not syncing properly**: The webhook runs but doesn't set `subscriptionStatus = 'active'`
3. **Time lag**: The subscription was just created and hasn't synced yet
4. **Environment variable issues**: `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` are incorrect

## How to Fix

### Step 1: Check Your Subscription Status in Parse Dashboard
1. Go to https://dashboard.back4app.com/
2. Find the User class
3. Select your user and check these fields:
   - `subscriptionStatus` - should be `'active'` if you have a valid subscription
   - `stripeSubscriptionId` - should have a value like `sub_xxx...`
   - `stripeCustomerId` - should have a value like `cus_xxx...`

### Step 2: If subscriptionStatus is NOT 'active', try these fixes:

#### Option A: Manually Set the Status (Quick Fix)
1. In Parse Dashboard, find your user
2. Edit the `subscriptionStatus` field and set it to `'active'`
3. This will immediately fix the error

#### Option B: Check Stripe Webhook Configuration
1. Go to https://dashboard.stripe.com/webhooks
2. Verify your webhook endpoint is set to your Back4App URL: `https://yourapp.back4app.io/webhook`
3. Check the webhook logs to see if `checkout.session.completed` events are being sent
4. If events aren't appearing, your webhook URL might be wrong

#### Option C: Verify Back4App Environment Variables
1. Go to https://dashboard.back4app.com/ → Settings → Cloud Code → Environment Variables
2. Verify these are set correctly:
   - `STRIPE_SECRET_KEY` - from https://dashboard.stripe.com/apikeys
   - `STRIPE_WEBHOOK_SECRET` - from https://dashboard.stripe.com/webhooks (endpoint details)
   - `OPENAI_API_KEY` - your OpenAI API key
   - `APP_URL` - your app's public URL

### Step 3: If You Want to Verify It's Actually Working

Open your browser console (F12) and run:
```javascript
const user = Parse.User.current();
await user.fetch();
console.log('Subscription Status:', user.get('subscriptionStatus'));
console.log('Stripe Subscription ID:', user.get('stripeSubscriptionId'));
console.log('Stripe Customer ID:', user.get('stripeCustomerId'));
```

If these values are empty or show `undefined`, your webhook isn't working.

## The Code Flow

```
User purchases → Stripe generates checkout.session.completed → 
Stripe calls webhook → Back4App receives event → 
Cloud Code runs → Updates User.subscriptionStatus to 'active' → 
User can now generate unlimited analogies
```

If any step fails, `subscriptionStatus` stays blank/inactive.

## Error Message Explained

When you see "Monthly limit reached" or can't generate more:
- It's checking: `if (subscriptionStatus === 'active')`
- Your status is something like `undefined` or `'inactive'`
- So it treats you as a free user
- Free users: 1 generation per type per notebook
- You hit that limit, so you get the error

---

## Quick Test: Enable Debug Logging

Add this to `scripts/notebooks.js` in the `canGenerateMore()` function (around line 225):

```javascript
async canGenerateMore(type) {
    const user = Parse.User.current();
    if (!user) return { allowed: false, reason: 'Not logged in' };

    await user.fetch();
    const subscriptionStatus = user.get('subscriptionStatus');
    
    // DEBUG: Log subscription info
    console.log('DEBUG canGenerateMore:', {
        type,
        subscriptionStatus,
        stripeSubscriptionId: user.get('stripeSubscriptionId'),
        stripeCustomerId: user.get('stripeCustomerId'),
        isPaid: subscriptionStatus === 'active'
    });
    
    // ... rest of function
```

Then check the browser console when you try to generate analogies. You'll see what the actual subscription status is.

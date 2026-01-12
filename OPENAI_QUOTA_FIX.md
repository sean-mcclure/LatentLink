# Fixing the OpenAI Quota Error

## The Real Problem

Your error is NOT a usage limit issue - it's **OpenAI API quota/billing**:

```
You exceeded your current quota, please check your plan and billing details
```

This happens when:
1. ❌ Free trial expired (no payment method)
2. ❌ Monthly quota reached
3. ❌ Account doesn't have billing enabled
4. ❌ Using an old API key from a non-billing account

## Step-by-Step Fix

### Step 1: Verify Your OpenAI Account Status

1. Go to https://platform.openai.com/account/billing/overview
2. **Check the "Overview" tab:**
   - You should see your usage (in USD)
   - If it says "Free trial - expired" → **You need to add billing**

3. **Add Payment Method:**
   - Click "Billing" → "Payment methods"
   - Add a credit card
   - Set usage limits if you want (recommended)

### Step 2: Check Your API Key Permissions

1. Go to https://platform.openai.com/api-keys
2. **Find your API key** (it starts with `sk-`)
3. **Click on it** to see permissions
4. Verify it's connected to your org/account with billing

### Step 3: Verify Usage is Actually Low

1. Go to https://platform.openai.com/usage
2. Check:
   - Tokens used today/this month
   - Cost in USD
   - If this looks wrong, you might be hitting a monthly limit

### Step 4: If You Have Organization Limits

1. Go to https://platform.openai.com/account/billing/limits
2. Check your spending limits:
   - Monthly budget: How much you're willing to spend
   - Hard limit: API won't work if exceeded
3. Make sure your limit isn't too low

## For Your Back4App Setup

Your OpenAI API key is stored in Back4App environment variables:

```
OPENAI_API_KEY=sk-...
```

Make sure:
1. The key is valid and not rotated/deleted
2. The key's organization has active billing
3. The key has permission for `gpt-4o` model (make sure your account supports it)

## Testing the API Key

You can test if your API key works by running this in the browser console:

```javascript
const testKey = 'sk-YOUR_KEY_HERE';  // Replace with your actual key

fetch('https://api.openai.com/v1/models', {
    headers: {
        'Authorization': `Bearer ${testKey}`
    }
})
.then(r => r.json())
.then(data => {
    if (data.error) {
        console.error('❌ API Error:', data.error.message);
    } else {
        console.log('✅ API Key Valid! Models available:', data.data.length);
    }
})
.catch(e => console.error('❌ Network error:', e));
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| "Quota exceeded" | Add payment method or increase monthly limit |
| "Invalid API key" | Check OPENAI_API_KEY environment variable |
| "Invalid organization" | Make sure API key is from correct OpenAI org |
| "Model not found" | Your account might not have gpt-4o access |

## For Development

If you want to test without spending money:
1. Request a higher free trial credit (if eligible)
2. Set usage limits very low (e.g., $1/month) to test safely
3. Use cheaper models (gpt-3.5-turbo) for development

## Current Status in Your App

Your app is showing:
- ✅ Papers loaded successfully
- ✅ Notebook saving works
- ❌ **OpenAI API isn't authorized for billing**
- ⚠️ User subscription isn't set up in Parse (separate issue)

Fix #1: Get OpenAI billing working
Fix #2: Set up Stripe webhook to populate subscription status in Parse

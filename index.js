const express = require('express');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Parse = require('parse/node');
const app = express();

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

const PARSE_CONFIGS = {
  latentlink: {
    appId: process.env.BACK4APP_APP_ID,
    jsKey: process.env.BACK4APP_JS_KEY,
    masterKey: process.env.BACK4APP_MASTER_KEY,
    serverURL: 'https://parseapi.back4app.com',
  }
};

function initializeParse(config) {
  Parse.initialize(config.appId, config.jsKey, config.masterKey);
  Parse.serverURL = config.serverURL;
}

async function hasProcessedEvent(eventId) {
  const StripeEvent = Parse.Object.extend('StripeEvent');
  const query = new Parse.Query(StripeEvent);
  query.equalTo('event_id', eventId);
  return query.first({ useMasterKey: true });
}

async function recordEvent(event) {
  const StripeEvent = Parse.Object.extend('StripeEvent');
  const stripeEvent = new StripeEvent();
  stripeEvent.set('event_id', event.id);
  stripeEvent.set('event_type', event.type);
  stripeEvent.set('processed_at', new Date());
  stripeEvent.set('payload', event);
  await stripeEvent.save(null, { useMasterKey: true });
}

async function getUserById(userId) {
  const query = new Parse.Query(Parse.User);
  return query.get(userId, { useMasterKey: true });
}

async function applyCheckoutCredits(session) {
  const userId = session.metadata?.user_id || session.metadata?.userId || session.client_reference_id;
  if (!userId) {
    throw new Error('Missing user metadata on checkout session');
  }

  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
  const price = lineItems.data?.[0]?.price;
  const credits = Number.parseInt(price?.metadata?.credits || '', 10);
  const packTier = price?.metadata?.pack_tier || session.metadata?.pack_tier || 'starter';
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new Error('Stripe price metadata missing credits');
  }

  const user = await getUserById(userId);
  const CreditBatch = Parse.Object.extend('CreditBatch');
  const batch = new CreditBatch();
  batch.set('user', user);
  batch.set('credits_initial', credits);
  batch.set('credits_remaining', credits);
  batch.set('expires_at', new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
  batch.set('stripe_session_id', session.id);
  batch.set('stripe_payment_intent_id', session.payment_intent || null);
  batch.set('pack_tier', packTier);
  batch.set('amount_paid_cents', session.amount_total || 0);
  batch.set('researcher_discount_applied', (session.total_details?.amount_discount || 0) > 0);
  await batch.save(null, { useMasterKey: true });

  user.increment('credits_balance', credits);
  if (session.customer) {
    user.set('stripeCustomerId', session.customer);
  }
  await user.save(null, { useMasterKey: true });
}

async function handleRefund(charge) {
  const CreditBatch = Parse.Object.extend('CreditBatch');
  const batchQuery = new Parse.Query(CreditBatch);
  batchQuery.equalTo('stripe_payment_intent_id', charge.payment_intent || '');
  const batch = await batchQuery.first({ useMasterKey: true });
  if (!batch) {
    return;
  }

  const user = batch.get('user');
  await user.fetch({ useMasterKey: true });
  const creditsInitial = batch.get('credits_initial') || 0;
  const amountPaidCents = batch.get('amount_paid_cents') || charge.amount || 0;
  const refundRatio = amountPaidCents ? Math.min(1, (charge.amount_refunded || 0) / amountPaidCents) : 0;
  const creditsToReverse = Math.round(creditsInitial * refundRatio);
  const refundableUnusedCredits = Math.min(batch.get('credits_remaining') || 0, creditsToReverse);

  if (refundableUnusedCredits > 0) {
    batch.increment('credits_remaining', -refundableUnusedCredits);
    user.increment('credits_balance', -refundableUnusedCredits);
  }

  if (creditsToReverse > refundableUnusedCredits) {
    user.set('purchase_frozen', true);
    user.set('purchase_hold_reason', 'refunded_used_credits');
  }

  await batch.save(null, { useMasterKey: true });
  await user.save(null, { useMasterKey: true });
}

async function handleDispute(dispute) {
  const paymentIntentId = dispute.payment_intent || dispute.charge?.payment_intent || '';
  const CreditBatch = Parse.Object.extend('CreditBatch');
  const batchQuery = new Parse.Query(CreditBatch);
  batchQuery.equalTo('stripe_payment_intent_id', paymentIntentId);
  const batch = await batchQuery.first({ useMasterKey: true });
  if (!batch) {
    return;
  }

  const user = batch.get('user');
  await user.fetch({ useMasterKey: true });
  user.set('purchase_frozen', true);
  user.set('purchase_hold_reason', 'charge_dispute');
  await user.save(null, { useMasterKey: true });
}

// Stripe webhook route (use raw body)
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('✅ Stripe event received:', event.type);
  } catch (err) {
    console.error('❌ Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    try {
      const session = event.data.object;
      console.log('📦 Session data:', session);

      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
      console.log('🧾 Line items:', lineItems);

      const productId = lineItems.data[0]?.price?.product;
      const product = await stripe.products.retrieve(productId);
      const appTag = product?.metadata?.app;

      console.log('🏷️ App metadata:', appTag);
      const config = PARSE_CONFIGS[appTag];

      if (!config) {
        console.log(`🚫 No config found for app: ${appTag}`);
        return res.status(200).send("Ignored: unknown app");
      }

      // Initialize correct Parse app
      initializeParse(config);

      const existing = await hasProcessedEvent(event.id);
      if (existing) {
        console.log(`ℹ️ Duplicate event ignored: ${event.id}`);
        return res.status(200).send('Duplicate event ignored');
      }

      await applyCheckoutCredits(session);
      await recordEvent(event);

      console.log(`✅ Credited checkout session ${session.id} in app ${appTag}`);
      return res.status(200).send('Credits applied');

    } catch (error) {
      console.error("❌ ERROR IN WEBHOOK HANDLER:", error.message);
      console.error(error.stack);
      return res.status(500).send("Internal error");
    }
  }

  if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    try {
      const config = PARSE_CONFIGS.latentlink;
      initializeParse(config);

      const existing = await hasProcessedEvent(event.id);
      if (existing) {
        return res.status(200).send('Duplicate event ignored');
      }

      if (event.type === 'charge.refunded') {
        await handleRefund(event.data.object);
      } else {
        await handleDispute(event.data.object);
      }

      await recordEvent(event);
    } catch (error) {
      console.error('❌ Error processing account protection event:', error.message);
      return res.status(500).send('Internal error');
    }
  }

  res.status(200).send('Webhook received');
});

// Health check route for Back4App
app.get('/', (req, res) => {
  res.status(200).send('LatentLink Webhook Server is up');
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

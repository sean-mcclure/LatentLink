const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const OPENAI_MODELS = {
    extract: 'gpt-4.1-mini',
    fingerprint: 'gpt-4.1',
    correspondences: 'gpt-4.1',
    verify: 'gpt-4.1-mini',
    render: 'gpt-4.1'
};

const CREDIT_PACKS = {
    starter: {
        priceEnv: 'STRIPE_STARTER_PRICE_ID',
        label: 'Starter',
        credits: 5,
        priceCents: 1900,
        researcherPriceCents: 1500
    },
    researcher: {
        priceEnv: 'STRIPE_RESEARCHER_PRICE_ID',
        label: 'Researcher',
        credits: 20,
        priceCents: 5900,
        researcherPriceCents: 4700
    },
    lab: {
        priceEnv: 'STRIPE_LAB_PRICE_ID',
        label: 'Lab',
        credits: 75,
        priceCents: 17900,
        researcherPriceCents: 14300
    }
};

async function getFreshUser(userId) {
    const query = new Parse.Query(Parse.User);
    return query.get(userId, { useMasterKey: true });
}

function getPackDefinition(packTier) {
    const pack = CREDIT_PACKS[packTier];
    if (!pack) {
        throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Unknown credit pack');
    }
    return pack;
}

function getPriceIdForPack(packTier) {
    const pack = getPackDefinition(packTier);
    const priceId = process.env[pack.priceEnv];
    if (!priceId) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, `Missing Stripe price ID for ${packTier}`);
    }
    return priceId;
}

async function listActiveCreditBatches(user) {
    const CreditBatch = Parse.Object.extend('CreditBatch');
    const query = new Parse.Query(CreditBatch);
    query.equalTo('user', user);
    query.greaterThan('credits_remaining', 0);
    query.greaterThan('expires_at', new Date());
    query.ascending('expires_at');
    return query.find({ useMasterKey: true });
}

async function buildCreditStatus(user) {
    const freshUser = await getFreshUser(user.id);
    const batches = await listActiveCreditBatches(freshUser);

    return {
        creditsBalance: freshUser.get('credits_balance') || 0,
        freeCreditsUsed: Boolean(freshUser.get('free_credits_used')),
        freeAnalysisAvailable: !freshUser.get('free_credits_used'),
        isVerifiedResearcher: Boolean(freshUser.get('is_verified_researcher')),
        verificationMethod: freshUser.get('verification_method') || null,
        researcherVerifiedAt: freshUser.get('researcher_verified_at') || null,
        lowCredit: (freshUser.get('credits_balance') || 0) <= 2,
        creditBatches: batches.map((batch) => ({
            id: batch.id,
            packTier: batch.get('pack_tier'),
            creditsInitial: batch.get('credits_initial') || 0,
            creditsRemaining: batch.get('credits_remaining') || 0,
            expiresAt: batch.get('expires_at') || null,
            amountPaidCents: batch.get('amount_paid_cents') || 0,
            researcherDiscountApplied: Boolean(batch.get('researcher_discount_applied'))
        }))
    };
}

async function consumeCredit(user, action) {
    const freshUser = await getFreshUser(user.id);
    const actionType = action || 'analysis';

    if (actionType === 'analysis' && !freshUser.get('free_credits_used')) {
        freshUser.set('free_credits_used', true);
        await freshUser.save(null, { useMasterKey: true });

        return {
            charged: true,
            kind: 'free',
            creditsBalance: freshUser.get('credits_balance') || 0,
            freeCreditsUsed: true
        };
    }

    const batches = await listActiveCreditBatches(freshUser);
    const batch = batches[0];
    if (!batch) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'No credits available');
    }

    batch.increment('credits_remaining', -1);
    freshUser.increment('credits_balance', -1);
    await batch.save(null, { useMasterKey: true });
    await freshUser.save(null, { useMasterKey: true });

    return {
        charged: true,
        kind: 'paid',
        creditsBalance: Math.max(0, freshUser.get('credits_balance') || 0),
        freeCreditsUsed: Boolean(freshUser.get('free_credits_used')),
        batchId: batch.id,
        batchExpiresAt: batch.get('expires_at')
    };
}

async function hasProcessedStripeEvent(eventId) {
    const StripeEvent = Parse.Object.extend('StripeEvent');
    const query = new Parse.Query(StripeEvent);
    query.equalTo('event_id', eventId);
    return query.first({ useMasterKey: true });
}

async function recordStripeEvent(event) {
    const StripeEvent = Parse.Object.extend('StripeEvent');
    const stripeEvent = new StripeEvent();
    stripeEvent.set('event_id', event.id);
    stripeEvent.set('event_type', event.type);
    stripeEvent.set('processed_at', new Date());
    stripeEvent.set('payload', event);
    await stripeEvent.save(null, { useMasterKey: true });
}

async function applyCheckoutCredits(session) {
    const userId = session.metadata?.user_id || session.metadata?.userId || session.client_reference_id;
    if (!userId) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'Missing user_id in checkout session metadata');
    }

    const user = await getFreshUser(userId);
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
    const price = lineItems.data?.[0]?.price;
    const credits = Number.parseInt(price?.metadata?.credits || '', 10);
    const packTier = price?.metadata?.pack_tier || session.metadata?.pack_tier || 'starter';

    if (!Number.isFinite(credits) || credits <= 0) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'Stripe price metadata must include credits');
    }

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

    return {
        userId,
        credits,
        packTier
    };
}

function requireUser(request) {
    if (!request.user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Must be logged in');
    }
    return request.user;
}

function truncate(value, maxLength = 40000) {
    if (!value) {
        return '';
    }
    return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function stripCodeFences(value) {
    if (!value) {
        return '';
    }
    return value.replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
}

function parseModelJson(text) {
    const cleaned = stripCodeFences(text);
    try {
        return JSON.parse(cleaned);
    } catch (error) {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        }
        throw error;
    }
}

async function callOpenAIJson({ model, system, user, temperature = 0.3 }) {
    if (!OPENAI_API_KEY) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'OPENAI_API_KEY is not configured');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model,
            temperature,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
            ]
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'OpenAI request failed');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return parseModelJson(content);
}

async function searchOpenAlex(query, limit = 4) {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}`;
    const response = await fetch(url);
    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    return (data.results || []).map((paper) => ({
        source: 'OpenAlex',
        title: paper.display_name || 'Untitled',
        summary: paper.abstract_inverted_index ? flattenAbstract(paper.abstract_inverted_index) : 'No abstract available.',
        url: paper.primary_location?.landing_page_url || paper.id || '',
        year: paper.publication_year || null
    }));
}

function flattenAbstract(invertedIndex) {
    const words = [];
    Object.entries(invertedIndex).forEach(([word, positions]) => {
        positions.forEach((position) => {
            words[position] = word;
        });
    });
    return words.join(' ');
}

async function searchSemanticScholar(query, limit = 4) {
    const fields = 'title,abstract,year,url,venue';
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
    const response = await fetch(url);
    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    return (data.data || []).map((paper) => ({
        source: 'Semantic Scholar',
        title: paper.title || 'Untitled',
        summary: paper.abstract || 'No abstract available.',
        url: paper.url || '',
        year: paper.year || null
    }));
}

async function searchArxiv(query, limit = 4) {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'LatentLink/2.0' } });
    if (!response.ok) {
        return [];
    }

    const text = await response.text();
    const entries = text.split('<entry>').slice(1, limit + 1);
    return entries.map((entry) => ({
        source: 'arXiv',
        title: readXmlTag(entry, 'title'),
        summary: readXmlTag(entry, 'summary'),
        url: readXmlTag(entry, 'id'),
        year: (readXmlTag(entry, 'published') || '').slice(0, 4) || null
    }));
}

function readXmlTag(fragment, tag) {
    const match = fragment.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

async function gatherEvidenceForCorrespondence(correspondence) {
    const query = [
        correspondence.sourceRole?.name,
        correspondence.targetRole?.name,
        correspondence.analogDomain,
        correspondence.label
    ].filter(Boolean).join(' ');

    const [openAlex, semanticScholar, arxiv] = await Promise.all([
        searchOpenAlex(query, 3),
        searchSemanticScholar(query, 3),
        searchArxiv(query, 3)
    ]);

    return [...openAlex, ...semanticScholar, ...arxiv].slice(0, 7);
}

function verificationSummary(correspondences) {
    return correspondences.reduce((summary, correspondence) => {
        const status = correspondence.verification?.status || 'unverified';
        summary[status] += 1;
        return summary;
    }, { corroborated: 0, unverified: 0, contradicted: 0 });
}

function createBaseSystemPrompt() {
    return `You analyze scientific work to identify structural correspondences with other scientific domains.

Structural correspondence is not surface similarity. Two systems correspond when the entities, relationships, and dynamics that do organizing work in one system play parallel roles in another, even if the vocabulary and mechanisms differ.

Always distinguish structural correspondence from shallow analogy. Prefer explicit break-points and uncertainty over overclaiming. Return strict JSON only.`;
}

Parse.Cloud.define('createCheckoutSession', async (request) => {
    const user = requireUser(request);
    const { packTier } = request.params;

    try {
        const pack = getPackDefinition(packTier);
        const priceId = getPriceIdForPack(packTier);
        const couponId = user.get('is_verified_researcher') ? process.env.STRIPE_RESEARCHER_COUPON_ID : null;
        const session = await stripe.checkout.sessions.create({
            customer_email: user.get('email'),
            client_reference_id: user.id,
            payment_method_types: ['card', 'link'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'payment',
            success_url: `${process.env.APP_URL}/?success=true`,
            cancel_url: `${process.env.APP_URL}/`,
            metadata: {
                user_id: user.id,
                pack_tier: packTier,
                credits: String(pack.credits)
            },
            payment_intent_data: {
                metadata: {
                    user_id: user.id,
                    pack_tier: packTier,
                    credits: String(pack.credits)
                }
            },
            discounts: couponId ? [{ coupon: couponId }] : [],
            phone_number_collection: { enabled: false },
            allow_promotion_codes: !couponId
        });

        return { sessionId: session.id, url: session.url };
    } catch (error) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, error.message);
    }
});

Parse.Cloud.define('createPortalSession', async (request) => {
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'Billing portal is not used for one-time credit packs');
});

Parse.Cloud.define('getCreditStatus', async (request) => {
    const user = requireUser(request);
    return buildCreditStatus(user);
});

Parse.Cloud.define('consumeAnalysisCredit', async (request) => {
    const user = requireUser(request);
    const { action } = request.params;
    const result = await consumeCredit(user, action || 'analysis');
    const status = await buildCreditStatus(user);
    return {
        ...result,
        ...status
    };
});

Parse.Cloud.define('setResearcherVerification', async (request) => {
    const user = requireUser(request);
    const { method, value } = request.params;
    const normalizedMethod = method === 'orcid' ? 'orcid' : 'institutional_email';
    const trimmedValue = String(value || '').trim();

    if (!trimmedValue) {
        throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Verification value is required');
    }

    if (normalizedMethod === 'institutional_email') {
        const institutionalPattern = /\.(edu|ac\.[a-z]{2}|edu\.[a-z]{2}|gov)$/i;
        if (!institutionalPattern.test(trimmedValue)) {
            throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Use an institutional research email');
        }
    }

    if (normalizedMethod === 'orcid') {
        const orcidPattern = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i;
        if (!orcidPattern.test(trimmedValue)) {
            throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Use a valid ORCID iD');
        }
    }

    const freshUser = await getFreshUser(user.id);

    freshUser.set('is_verified_researcher', true);
    freshUser.set('verification_method', normalizedMethod);
    freshUser.set('researcher_verified_at', new Date());
    freshUser.set('institutional_email', normalizedMethod === 'institutional_email' ? trimmedValue : null);
    freshUser.set('orcid_id', normalizedMethod === 'orcid' ? trimmedValue : null);
    await freshUser.save(null, { useMasterKey: true });

    return buildCreditStatus(freshUser);
});

Parse.Cloud.define('handleStripeWebhook', async (request) => {
    const event = request.params.event;
    if (!event) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'No event provided');
    }

    const existing = await hasProcessedStripeEvent(event.id);
    if (existing) {
        return { received: true, duplicate: true };
    }

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            await applyCheckoutCredits(session);
            break;
        }
        case 'charge.refunded': {
            const charge = event.data.object;
            const CreditBatch = Parse.Object.extend('CreditBatch');
            const batchQuery = new Parse.Query(CreditBatch);
            batchQuery.equalTo('stripe_payment_intent_id', charge.payment_intent || '');
            const batch = await batchQuery.first({ useMasterKey: true });
            if (!batch) {
                break;
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
            break;
        }
        case 'charge.dispute.created': {
            const dispute = event.data.object;
            const paymentIntentId = dispute.payment_intent || dispute.charge?.payment_intent || '';
            const CreditBatch = Parse.Object.extend('CreditBatch');
            const batchQuery = new Parse.Query(CreditBatch);
            batchQuery.equalTo('stripe_payment_intent_id', paymentIntentId);
            const batch = await batchQuery.first({ useMasterKey: true });
            if (!batch) {
                break;
            }

            const user = batch.get('user');
            await user.fetch({ useMasterKey: true });
            user.set('purchase_frozen', true);
            user.set('purchase_hold_reason', 'charge_dispute');
            await user.save(null, { useMasterKey: true });
            break;
        }
        default:
            break;
    }

    await recordStripeEvent(event);

    return { received: true };
});

Parse.Cloud.define('callOpenAI', async (request) => {
    requireUser(request);
    const { messages, temperature } = request.params;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({ model: 'gpt-4.1', messages, temperature: temperature || 0.7 })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, error.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
    return { content: data.choices[0].message.content };
});

Parse.Cloud.define('getUsageStats', async (request) => {
    const user = requireUser(request);
    const creditStatus = await buildCreditStatus(user);
    return {
        usageCount: user.get('usageCount') || 0,
        usageLimit: user.get('usageLimit') || 100,
        subscriptionStatus: user.get('subscriptionStatus'),
        subscriptionExpiresAt: user.get('subscriptionExpiresAt'),
        creditsBalance: creditStatus.creditsBalance,
        freeCreditsUsed: creditStatus.freeCreditsUsed,
        creditBatches: creditStatus.creditBatches,
        isVerifiedResearcher: creditStatus.isVerifiedResearcher,
        verificationMethod: creditStatus.verificationMethod
    };
});

Parse.Cloud.define('extractManuscript', async (request) => {
    requireUser(request);
    const { rawText, fileName, fieldPreference, title, note } = request.params;
    if (!rawText) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'rawText is required');
    }

    const result = await callOpenAIJson({
        model: OPENAI_MODELS.extract,
        temperature: 0.2,
        system: `${createBaseSystemPrompt()} Normalize manuscript uploads into a concise working representation with title, summary, field inference, and key claims.`,
        user: `Document title hint: ${title || fileName || 'none'}
Field preference: ${fieldPreference || 'none'}
Optional note: ${note || 'none'}

Manuscript text:
${truncate(rawText, 30000)}

Return JSON with keys: title, summary, inferredField, keyClaims (array), sectionSignals (array), workingQuestion, sourceLength.`
    });

    return {
        ...result,
        fileName: fileName || null,
        rawText: truncate(rawText, 60000)
    };
});

Parse.Cloud.define('generateStructuralFingerprint', async (request) => {
    requireUser(request);
    const { manuscript, fieldPreference } = request.params;
    const result = await callOpenAIJson({
        model: OPENAI_MODELS.fingerprint,
        temperature: 0.25,
        system: `${createBaseSystemPrompt()} Extract the structural fingerprint of the user manuscript only. Do not do cross-domain work yet.`,
        user: `Field preference: ${fieldPreference || 'none'}
Manuscript summary: ${manuscript.summary}
Working question: ${manuscript.workingQuestion}
Key claims:
- ${(manuscript.keyClaims || []).join('\n- ')}

Return JSON with keys: summary, entities (array), dynamics (array), constraints (array), sensitiveZones (array), signature (string).`
    });
    return result;
});

Parse.Cloud.define('proposeCorrespondences', async (request) => {
    requireUser(request);
    const { manuscript, fingerprint, searchDepth, note } = request.params;
    const result = await callOpenAIJson({
        model: OPENAI_MODELS.correspondences,
        temperature: searchDepth === 'broad' ? 0.75 : 0.45,
        system: `${createBaseSystemPrompt()} Surface 2-4 candidate analog domains and 4-6 explicit structural correspondences with break-points.`,
        user: `Manuscript summary: ${manuscript.summary}
Working question: ${manuscript.workingQuestion}
Structural fingerprint summary: ${fingerprint.summary}
Entities: ${(fingerprint.entities || []).join('; ')}
Dynamics: ${(fingerprint.dynamics || []).join('; ')}
Constraints: ${(fingerprint.constraints || []).join('; ')}
Sensitive zones: ${(fingerprint.sensitiveZones || []).join('; ')}
Optional user note: ${note || 'none'}
Search depth: ${searchDepth || 'standard'}

Return JSON with keys:
- candidates: array of { domain, label, rationale, anchorTerms }
- correspondences: array of {
  id,
  label,
  analogDomain,
  summary,
  reasoning,
  confidence,
  sourceRole: { name, roleType },
  targetRole: { name, roleType },
  mappingExplanation,
  breakpoints: array
}`
    });

    return result;
});

Parse.Cloud.define('verifyCorrespondences', async (request) => {
    requireUser(request);
    const { manuscript, fingerprint, correspondences, searchDepth } = request.params;
    const verified = [];

    for (const correspondence of correspondences || []) {
        const evidence = await gatherEvidenceForCorrespondence(correspondence);
        const classification = await callOpenAIJson({
            model: OPENAI_MODELS.verify,
            temperature: 0.2,
            system: `${createBaseSystemPrompt()} You are classifying whether retrieved literature corroborates, contradicts, or leaves unverified a proposed correspondence.`,
            user: `Manuscript summary: ${manuscript.summary}
Fingerprint summary: ${fingerprint.summary}
Search depth: ${searchDepth || 'standard'}
Proposed correspondence:
${JSON.stringify(correspondence, null, 2)}

Evidence set:
${JSON.stringify(evidence, null, 2)}

Return JSON with keys: status (corroborated|unverified|contradicted), rationale, evidence (array of up to 3 items, each with source, title, summary, quote).`
        });

        verified.push({
            ...correspondence,
            verification: {
                status: classification.status,
                rationale: classification.rationale,
                evidence: classification.evidence || []
            }
        });
    }

    const summary = verificationSummary(verified);
    return {
        correspondences: verified,
        summary,
        summaryLine: `${summary.corroborated} corroborated, ${summary.unverified} unverified, ${summary.contradicted} contradicted`
    };
});

Parse.Cloud.define('renderCorrespondences', async (request) => {
    requireUser(request);
    const { manuscript, fingerprint, correspondences, fieldPreference } = request.params;
    const result = [];

    for (const correspondence of correspondences || []) {
        const rendering = await callOpenAIJson({
            model: OPENAI_MODELS.render,
            temperature: 0.3,
            system: `${createBaseSystemPrompt()} Render each correspondence in the user field's own vernacular. Physics prefers equations, biology prefers pathway/topology language, and computer science prefers algorithmic or pseudocode descriptions.`,
            user: `Field preference: ${fieldPreference || 'generic'}
Manuscript summary: ${manuscript.summary}
Fingerprint summary: ${fingerprint.summary}
Correspondence:
${JSON.stringify(correspondence, null, 2)}

Return JSON with keys: summary, artifact, notes (array).`
        });

        result.push({
            ...correspondence,
            rendering
        });
    }

    return { correspondences: result };
});
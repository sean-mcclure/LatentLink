const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const OPENAI_MODELS = {
    extract: 'gpt-4.1-mini',
    fingerprint: 'gpt-4.1',
    correspondences: 'gpt-4.1',
    verify: 'gpt-4.1-mini',
    render: 'gpt-4.1'
};

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
    const { userId, email, priceId } = request.params;

    try {
        const session = await stripe.checkout.sessions.create({
            customer_email: email,
            client_reference_id: userId,
            payment_method_types: ['card', 'link'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            success_url: `${process.env.APP_URL}/?success=true`,
            cancel_url: `${process.env.APP_URL}/`,
            metadata: { userId },
            phone_number_collection: { enabled: false }
        });

        return { sessionId: session.id, url: session.url };
    } catch (error) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, error.message);
    }
});

Parse.Cloud.define('createPortalSession', async (request) => {
    const { userId } = request.params;

    try {
        const query = new Parse.Query(Parse.User);
        const user = await query.get(userId, { useMasterKey: true });
        const customerId = user.get('stripeCustomerId');
        if (!customerId) {
            throw new Error('No Stripe customer ID found');
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: process.env.APP_URL
        });

        return { url: session.url };
    } catch (error) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, error.message);
    }
});

Parse.Cloud.define('handleStripeWebhook', async (request) => {
    const event = request.params.event;
    if (!event) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'No event provided');
    }

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const customerEmail = session.customer_details?.email || session.customer_email;
            if (!customerEmail) {
                break;
            }

            const query = new Parse.Query(Parse.User);
            query.equalTo('email', customerEmail);
            const user = await query.first({ useMasterKey: true });
            if (!user) {
                break;
            }

            user.set('stripeCustomerId', session.customer);
            user.set('stripeSubscriptionId', session.subscription);
            user.set('subscriptionStatus', 'active');
            user.set('subscriptionExpiresAt', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
            user.set('usageCount', 0);
            await user.save(null, { useMasterKey: true });
            break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'invoice.payment_succeeded':
        case 'invoice.payment_failed': {
            const subscription = event.data.object;
            const subscriptionId = subscription.id || subscription.subscription;
            const query = new Parse.Query(Parse.User);
            query.equalTo('stripeSubscriptionId', subscriptionId);
            const user = await query.first({ useMasterKey: true });
            if (!user) {
                break;
            }

            if (event.type === 'customer.subscription.deleted') {
                user.set('subscriptionStatus', 'canceled');
            } else if (event.type === 'invoice.payment_failed') {
                user.set('subscriptionStatus', 'past_due');
            } else {
                user.set('subscriptionStatus', 'active');
            }

            const periodEnd = subscription.current_period_end || subscription.period_end;
            if (periodEnd) {
                user.set('subscriptionExpiresAt', new Date(periodEnd * 1000));
            }
            if (event.type === 'invoice.payment_succeeded') {
                user.set('usageCount', 0);
            }

            await user.save(null, { useMasterKey: true });
            break;
        }
        default:
            break;
    }

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
    return {
        usageCount: user.get('usageCount') || 0,
        usageLimit: user.get('usageLimit') || 100,
        subscriptionStatus: user.get('subscriptionStatus'),
        subscriptionExpiresAt: user.get('subscriptionExpiresAt')
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
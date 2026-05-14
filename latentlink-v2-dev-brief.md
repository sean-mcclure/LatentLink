## 1. Goal

Ship a credit-based payment flow for LatentLink v2 alongside the post-analysis exploration features that make a credit feel like a research artifact, not a disposable report.

Two intertwined pieces:

1. **Payment.** One free analysis, three credit packs, researcher discount (institutional email or ORCID), Stripe + webhook integration.
2. **Post-analysis depth.** Persistent analysis library, deep drill on correspondences, pin/annotate, reading list export, cross-analysis diff. Most of this is free client-side work on data the original credit already paid for.

The principle behind the pricing: **one credit = one persistent, explorable research workspace tied to a manuscript.** Not a transaction. An artifact.

---

## 2. Pricing Model

### Free tier
- **1 full analysis** on signup. Whole experience including verification and field rendering.
- Tracked via `free_credits_used` flag on the User object (not via the credit balance — keeps audit clean).
- No card required for free analysis.

### Credit packs (one-time purchases)

| Pack | Credits | Price | Per-analysis | Researcher price |
|------|---------|-------|--------------|------------------|
| Starter | 5 | $19 | $3.80 | $15 |
| Researcher | 20 | $59 | $2.95 | $47 |
| Lab | 75 | $179 | $2.39 | $143 |

### Researcher discount
- 20% off any pack.
- Available to anyone verified as an active researcher via **institutional email** OR **ORCID with ≥1 published work**. Independent and industry researchers qualify on the same terms as those at universities.
- Applied as a Stripe Coupon at checkout, not as a separate price tier (cleaner Stripe Dashboard, easier to A/B test the discount %).

### Credit expiration
- **12 months from purchase date.** Tracked per-purchase-batch, not per-credit (keeps logic simple).
- Surface expiration date in the UI on the credits page.

---

## 3. Data Model

### `User` (extend existing Parse User class)
- `credits_balance: Number` — current spendable credits
- `free_credits_used: Boolean` — has the user consumed their free analysis
- `is_verified_researcher: Boolean` — qualifies for researcher discount
- `verification_method: String` — "institutional_email" | "orcid" | null
- `institutional_email: String` — verified .edu / .ac.uk / etc. (may differ from primary email)
- `orcid_id: String` — verified ORCID iD (e.g., "0000-0002-1825-0097")
- `researcher_verified_at: Date`

### `CreditBatch` (new class)
- `user: Pointer<User>`
- `credits_initial: Number` — pack size at purchase
- `credits_remaining: Number` — decremented as used
- `expires_at: Date` — purchase + 12 months
- `stripe_session_id: String`
- `pack_tier: String` — "starter" | "researcher" | "lab"
- `amount_paid_cents: Number`
- `researcher_discount_applied: Boolean`

When consuming a credit, decrement the oldest non-expired `CreditBatch` first (FIFO). Keeps users from hoarding cheap credits.

### `Analysis` (new class)
- `user: Pointer<User>`
- `manuscript_title: String`
- `manuscript_text: String` (or pointer to file)
- `manuscript_hash: String` — to detect re-runs of identical input
- `fingerprint: Object` — extracted structural fingerprint
- `correspondences: Array<Object>` — the matched domains with verification data
- `field_rendering: Object` — keyed by field, holds rendered views
- `credits_charged: Number` — 1 for new, 0 for re-open
- `parent_analysis: Pointer<Analysis>` — for revision diffs
- `created_at: Date`
- ACLs: user read/write only

### `Pin` (new class)
- `user: Pointer<User>`
- `analysis: Pointer<Analysis>`
- `correspondence_id: String` — references entry in Analysis.correspondences
- `annotation: String` — user note
- `is_relevant: Boolean` — flagged as matters / doesn't matter
- `created_at: Date`

### `StripeEvent` (new class — for idempotency)
- `event_id: String` (unique index)
- `event_type: String`
- `processed_at: Date`
- `payload: Object`

---

## 4. Stripe Setup

### Products and Prices

Create **3 Products** in Stripe, each with **2 Prices** (regular + researcher):

- Product: "LatentLink Starter Pack"
  - Price: $19 (regular)
  - Price: $15 (researcher)
- Product: "LatentLink Researcher Pack"
  - Price: $59 / $47
- Product: "LatentLink Lab Pack"
  - Price: $179 / $143

Alternative: 3 Products, 1 Price each, and apply a 20% Coupon for verified researchers. Slightly cleaner if discount % might change.

Add metadata to each Price:
```json
{
  "pack_tier": "starter",
  "credits": "5"
}
```

The webhook reads these to determine how many credits to add — never hardcode the mapping in the backend.

### Checkout flow

Use Stripe Checkout (hosted) rather than Payment Element for v2. Faster to ship, handles tax/SCA, less surface area.

```
1. User clicks "Buy Starter Pack" in app
2. Backend creates Checkout Session:
   - line_items: [{ price: PRICE_ID, quantity: 1 }]
   - mode: 'payment' (not subscription)
   - metadata: { user_id, pack_tier }
   - success_url, cancel_url
   - If verified researcher: use researcher price OR apply coupon
3. Redirect user to session.url
4. Stripe handles payment
5. User returns to success_url
6. Webhook fires checkout.session.completed → backend adds credits
```

### Webhook events to handle

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Primary credit-add trigger |
| `payment_intent.payment_failed` | Log for support; no user action needed |
| `charge.refunded` | Deduct credits (handle carefully — may have been used) |
| `charge.dispute.created` | Flag account, freeze further purchases |

### Webhook handler logic (pseudocode)

```python
def handle_webhook(event):
    # Idempotency check
    if StripeEvent.exists(event.id):
        return 200

    StripeEvent.create(event_id=event.id, type=event.type)

    if event.type == 'checkout.session.completed':
        session = event.data.object
        user_id = session.metadata.user_id
        # Get line items to find pack_tier + credits
        line_items = stripe.checkout.Session.list_line_items(session.id)
        price = line_items.data[0].price
        credits = int(price.metadata.credits)
        pack_tier = price.metadata.pack_tier

        # Create CreditBatch
        batch = CreditBatch.create(
            user=user_id,
            credits_initial=credits,
            credits_remaining=credits,
            expires_at=now() + 12_months,
            stripe_session_id=session.id,
            pack_tier=pack_tier,
            amount_paid_cents=session.amount_total,
            researcher_discount_applied=(session.discounts is not None)
        )

        # Update user balance
        user.increment('credits_balance', credits)
        user.save()

        # Send confirmation email
        send_purchase_confirmation(user, pack_tier, credits)

    return 200
```

**Idempotency is critical.** Stripe retries webhooks. Without the `StripeEvent` check, a retry double-credits the user.

---

## 5. Credit Consumption Rules

### What costs 1 credit

- **Fresh analysis** on a new manuscript (new `manuscript_hash`)
- **Re-analysis** on a revised draft (different `manuscript_hash`, even if title is the same)
- **Field-lens re-rendering** — re-rendering the analysis in a different discipline's language (requires real LLM work)
- **Follow-up Q&A** that goes beyond the static analysis result (optional feature, P2)

### What costs 0 credits (post-analysis exploration)

- Opening any past analysis from the library
- Drilling into any correspondence in an existing analysis
- Viewing verification evidence / source papers
- Pinning / annotating correspondences
- Exporting reading list / BibTeX
- Comparing two existing analyses (diff view)
- Sending to Manifest or Notes2Tree

### Free analysis logic

```python
def can_run_analysis(user):
    if not user.free_credits_used:
        return True, 'free'
    if user.credits_balance > 0:
        return True, 'paid'
    return False, None

def charge_for_analysis(user):
    if not user.free_credits_used:
        user.free_credits_used = True
        user.save()
        return
    # Deduct from oldest non-expired batch
    batch = CreditBatch.find(
        user=user,
        credits_remaining__gt=0,
        expires_at__gt=now()
    ).order_by('expires_at').first()
    batch.decrement('credits_remaining', 1)
    batch.save()
    user.decrement('credits_balance', 1)
    user.save()
```

### Pre-action confirmation

Every action that costs a credit must show a confirmation:

> This analysis will use 1 credit. You have 4 credits remaining.
> [Run Analysis] [Cancel]

Free actions must not show this dialog — users learn what's free vs paid quickly if it's consistent.

---

## 6. Analysis Library (P0)

A persistent list of every analysis the user has run, accessible from the main nav.

### Library view requirements
- List view: manuscript title, date, # correspondences, # pinned
- Click → opens the full analysis result (no credit charge)
- Sort by date / by title / by # pinned
- Search by manuscript title
- Delete (with confirmation — credits are not refunded on delete)
- Rename manuscript title (does not re-run analysis)

### Storage notes
- Analyses are stored in full — fingerprint, correspondences, verification data, all field renderings already generated. Don't lazy-load from a re-computation.
- Manuscripts can be large. Consider storing manuscript text in Parse File rather than the Analysis object directly if it bloats the row.

---

## 7. Post-Analysis Exploration Features

### P0 — ship with payment launch

**Deep drill on correspondences.** For each matched domain in the analysis, a dedicated view:
- The structural match (what about it parallels the manuscript)
- Verification evidence — the source papers, with abstracts and the specific results cited
- Where the parallel breaks (the DIVERGE content)
- Suggested methods/formalisms from that field

This is data the original credit paid to produce. Make it all accessible without further charges.

**Pin & annotate.** On any correspondence:
- "Pin" button → marks it as relevant
- "Mark as wrong" button → flags for the user's own filtering
- Free-text annotation field that persists
- Pinned correspondences float to the top of the analysis view on re-open

**Reading list export.** From any analysis:
- Generate a structured reading list of all source papers cited in verification, grouped by correspondence
- Export to BibTeX, RIS, plain text
- Filter to pinned-only

### P1 — within 30 days of launch

**Cross-analysis diff.** When a user runs an analysis on a revised draft of the same manuscript:
- Detect via `parent_analysis` pointer (set by user on upload: "this is a revision of X")
- Show side-by-side: new correspondences in green, removed in red, strengthened/weakened indicators
- This justifies the second credit purchase as much as the first

**Field-lens re-render.** Re-render an existing analysis in a different field's language. Costs 1 credit (real LLM work).

### P2 — based on usage data

- Follow-up Q&A on a specific analysis (chat-style, 1 credit per session)
- Save-and-alert: notify user when a new paper appears that strengthens/weakens a pinned correspondence
- Shareable view (read-only link for co-authors)

---

## 8. Researcher Verification

Two independent paths, same outcome: `is_verified_researcher = true`. User picks whichever fits them.

### Path A: Institutional Email
1. User enters institutional email (at signup or in profile settings)
2. Validate against TLD regex list — `.edu` (US), `.ac.uk`, `.edu.au`, `.ac.jp`, `.ac.nz`, `.edu.cn`, etc. Plus a curated list of recognized research-institution `.gov` domains (LANL, LBL, NIH, NASA, NIST, ORNL, ARS, etc.)
3. Backend sends verification email with one-time link
4. User clicks link → set `is_verified_researcher = true`, `verification_method = "institutional_email"`, `institutional_email = <address>`, `researcher_verified_at = now()`

### Path B: ORCID
For independent researchers, industry scientists, national-lab staff without recognized domains, anyone unaffiliated.

1. User clicks "Verify with ORCID" button
2. Redirect to ORCID OAuth:
   ```
   https://orcid.org/oauth/authorize
     ?client_id=YOUR_CLIENT_ID
     &response_type=code
     &scope=/read-public
     &redirect_uri=YOUR_CALLBACK
   ```
3. User authorizes
4. ORCID redirects back with code; backend exchanges for access token
5. Backend calls `https://pub.orcid.org/v3.0/{orcid_id}/works` to fetch works summary
6. **Gate: must have ≥1 published work.** Anyone can register an ORCID; only researchers have publications attached. This is the real filter.
7. If pass: set `is_verified_researcher = true`, `verification_method = "orcid"`, `orcid_id = <id>`, `researcher_verified_at = now()`
8. If fail (0 works): show message — "We didn't find any publications on your ORCID. Link your papers (including arXiv preprints) and try again."

### Re-verification
- Annual cron: for users where `researcher_verified_at` is > 365 days old, re-run verification
  - Institutional email: re-send verification email (passive; flag stays true unless user explicitly fails)
  - ORCID: re-fetch works count; if still ≥1, refresh `researcher_verified_at`; if it dropped to 0 (rare), flip flag to false
- Don't block checkout on re-verification — just queue it in the background

### Notes
- This is a soft filter, not security. Don't over-engineer. The point is a clean discount mechanism for active researchers, not preventing all gaming.
- Frame the choice neutrally in the UI. Neither path is "better." Independent researchers should feel as welcome as institutional ones — that aligns with Kedion's positioning.

---

## 9. UI Requirements

### Credit balance display
- Always visible in the top nav: "5 credits"
- Hover/click → dropdown showing credit batches with expiration dates
- Low-credit warning when balance ≤ 2

### Pricing page
- Three packs, side-by-side, equal visual weight
- "Most popular" badge on Researcher
- Researcher discount banner at top of page if user is verified — or a "Verify as researcher to save 20%" prompt with both paths (Institutional Email / ORCID) if not
- Clear "Credits expire 12 months after purchase" disclosure

### Post-free-analysis upsell
- Immediately after the user's first (free) analysis completes, show a non-blocking banner:
  > "Loved this? Get 5 more analyses for $19 ($15 with researcher verification)"
- Don't paywall the result. They need to fully experience the artifact to convert.

### Empty states
- New user with 0 paid credits but unused free credit: prompt to run their first analysis
- New user with 0 credits and used free: show pricing page directly

---

## 10. Ecosystem Hooks (P1/P2)

From any finished analysis:

- **"Send to Manifest"** button → exports identified gaps (where parallels break, what's missing) as a Manifest input for manuscript strengthening
- **"Send to Notes2Tree"** button → exports the correspondence structure as a Notes2Tree-compatible JSON for visual exploration

Defer the actual integration to P1 — but add the buttons (disabled/coming-soon) in P0 so users see the broader ecosystem early.
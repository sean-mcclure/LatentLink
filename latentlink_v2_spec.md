# LatentLink v2 — Engineering Spec

**Status:** Draft for review (revision incorporating manuscript-only entry, framework-conveying system prompt, redrawn line vs. Manifest)
**Owner:** Sean McClure
**Companion doc:** `latentlink_v2_research_notes.md` (theoretical insights surfaced during the build)

---

## 1. Summary

LatentLink v2 replaces the v1 engine. v1 surfaces analogies via LLM-driven similarity matching from generic dropdowns. v2 takes a different approach: the user uploads their own manuscript or notes, and the system surfaces deep structural correspondences with other scientific domains that are *implicit in their work* — including correspondences they may not have consciously articulated.

The architecture rests on a thesis the framework paper makes explicit: **LLMs trained on enough scientific data already encode predictive equivalence implicitly, in the geometry of their representation space.** Concepts that play the same predictive roles under the same conditions end up close in latent space because that's what next-token prediction selects for. The structural alignment we want isn't something we engineer externally with clustering and judges and graph algorithms — it's something the model already has, that we surface and verify.

The v2 pipeline is therefore much simpler than the original spec assumed:

1. **Manuscript ingestion.** User uploads their work.
2. **Structural surfacing.** A framework-grounded system prompt directs the LLM to surface the structural correspondences implicit in the user's work, expressed as per-domain structural fingerprints and proposed alignments.
3. **Targeted verification search.** The surfaced structure drives a precise literature search rather than an exhaustive one. Verification confirms or contradicts each correspondence.
4. **Domain-form rendering.** Verified correspondences render in the user's working vernacular — equations, pathway diagrams, pseudocode, dynamical-systems formalism.
5. **Visualization with drill-down.** Two parallel typed graphs with correspondence ribbons, every assertion drillable to its structural reasoning, verification status, and domain-form rendering.

What v1 did poorly — exhaustive corpus pulling, external reconstruction of the structure the LLM already encodes, hypothesis generation researchers don't trust — v2 either doesn't do or does very differently. The framework is honored, not bypassed; the costs are tractable; the product story is a single sentence: *point LatentLink at your work and see the cross-domain structural correspondences implicit in it, verified against the literature, in your own vernacular.*

---

## 2. Design Rationale

Most cross-domain AI tools treat analogy as embedding distance. That catches surface-level patterns — shared words, shared metaphors — but misses the analogies that actually drive scientific discovery.

A real cross-domain analogy is structural. Two systems are analogous when their internal organization corresponds, not when they share vocabulary. The classic examples (Hopfield networks / spin glasses, Darwin / Malthus, predictive coding / free energy) all involve domains where the *roles* concepts play in their respective systems mirror each other, even when surface terminology is unrelated.

The framework's central empirical claim — and the reason this architecture works — is that LLMs trained on scientific corpora learn this structural organization implicitly during training. Surface vocabulary is incidental; the structural roles concepts play in their predictive context are what gets encoded in the weights. This means the model already knows, in some implicit form, that energy minimization plays the same role in spin glasses as in Hopfield networks. We don't need to reconstruct that knowledge externally with our own clustering pipeline. We need to surface it, verify it, and render it usefully.

So: **the LLM is the engine, not a black-box claim-extractor with reconstruction work happening around it.** External infrastructure exists only to scaffold what the LLM already knows (the framework system prompt) and to verify what it produces (the literature grounding step). Everything else gets out of the way.

---

## 3. The Pipeline

### 3.1 Manuscript ingestion

**Input:** User uploads a manuscript (draft paper, preprint), a set of notes, or an outline. No other entry points — generic exploration via dropdowns is removed; user-stated analogies are removed (if the user already has the analogy articulated, the system's contribution is small).

**Output:** Cleaned text plus extracted metadata — title, abstract or summary if available, declared field of expertise (from user profile or inferred from the document), and a working representation of what the user is studying or claiming.

**Implementation:** Use PDF extraction. Markdown for notes, plus light LLM preprocessing to normalize formatting, identify section structure, and pull out the key claims being made. This preprocessing is one Opus call total per upload — doesn't scale with document size in any expensive way.

### 3.2 The framework system prompt

This is the single most important artifact in the v2 architecture. It conveys the framework's operational logic to the LLM in plain English — without depending on the framework's internal vocabulary (no "predictive equivalence classes," no "quotient spaces," no β-maps). The model already encodes the structure; the prompt's job is to direct it toward the right kind of output.

**Working draft of the system prompt** (will iterate; this is v0):

```
You are analyzing scientific work to identify deep structural correspondences
with other scientific domains.

A real cross-domain correspondence is NOT surface similarity. Two systems
correspond when their internal organization matches — when the things that
play causal, compositional, or constraining roles in one system play the
same roles in another, even if the surface vocabulary, equations, or
mechanisms look completely different.

EXAMPLES OF REAL STRUCTURAL CORRESPONDENCE:
- Hopfield networks and spin glasses: energy minimization plays the same
  organizing role in both, despite one being a neural network and the other
  a physical magnetic system.
- Predictive coding and Bayesian inference: error signals play the same role
  in updating internal models, despite the surface mechanisms being neural
  in one case and probabilistic in the other.
- Darwin's natural selection and Malthusian population dynamics: differential
  reproduction under resource constraint plays the same role in both,
  despite biology and demography having no shared vocabulary.

EXAMPLES OF SURFACE ANALOGY THAT IS NOT REAL CORRESPONDENCE:
- Bird wings and airplane wings: shared imagery (wings, lift) without
  shared structural roles. The mechanisms (flapping vs. fixed-wing thrust)
  play different causal roles.
- "The brain is like a computer": shared metaphor (information processing)
  without structural correspondence in how either system actually computes.
- Atoms and solar systems: visually similar but the roles of constituents
  (binding force, orbital mechanics) are completely different.

YOUR TASK, given the user's manuscript or notes:

1. Identify the abstractions in this work that play structural roles —
   the entities, relationships, and dynamics doing the actual organizing
   work in the system being studied.

2. Surface other scientific domains where the same structural roles are
   filled by different surface mechanisms. Be specific about WHAT plays
   WHICH role in each domain.

3. Distinguish carefully:
   - Surface analogy (shared vocabulary, shared imagery, shared metaphors):
     flag these and mark them as shallow.
   - Structural correspondence (shared roles in the system's organization):
     these are the real findings.

4. For each proposed correspondence, identify where it likely BREAKS — what
   structural features of one domain don't have analogs in the other. Real
   correspondences are almost always partial; the boundaries are informative.

5. Express uncertainty explicitly. Prefer "I'm uncertain about this
   correspondence because..." over confident generalities.

OUTPUT STRUCTURE:
- Per-domain structural fingerprint of the user's work
- Proposed analog domains with their structural fingerprints
- Specific correspondences (what plays what role, in each domain)
- Where each correspondence breaks
- Confidence per correspondence
```

This prompt does several things deliberately:

- **No framework jargon.** "Predictive equivalence" doesn't appear. The model isn't being asked to apply terminology it doesn't ground; it's being asked to do the operation the framework describes, in plain language.
- **Examples both ways.** Shows real correspondence and surface analogy, both labeled. The model learns the distinction by being shown what matters — roles, not vocabulary.
- **Demands break-point identification.** Real correspondences are partial. The prompt makes that explicit, so the output includes the structural fingerprint of where the analogy fails — which is where most of the interesting structural information lives.
- **Demands uncertainty.** Models hallucinate confidently when not asked otherwise. The prompt makes "I'm uncertain because..." an explicit acceptable output.

The prompt will iterate against the historical-analogy benchmark during MVP development. Treat it as a living artifact — every miss against the benchmark is potentially a prompt-tuning signal.

### 3.3 Structural surfacing

**Input:** User's manuscript text + the framework system prompt.
**Output:** Per-domain structural fingerprints (the user's domain + 2–4 candidate analog domains), proposed correspondences, break-points, confidence per correspondence.

**Implementation:** Two LLM calls.

**Call 1 — User's structural fingerprint.** Given the manuscript and the system prompt, ask the model to produce *just the structural fingerprint of the user's work itself* — what entities and relationships play structural roles, with no cross-domain analysis yet. This produces an artifact worth showing the user independently ("here is what your paper is structurally doing"), which is interesting in its own right and serves as the substrate for the alignment call.

**Call 2 — Cross-domain alignment.** Given the user's structural fingerprint plus the system prompt, ask the model to surface analog domains, their structural fingerprints, the specific correspondences, and the break-points. This is the headline call — large prompt, large structured output, Opus required.

Two calls instead of one because the per-domain fingerprint is independently valuable as a UI artifact and as a verifiable intermediate. If the structural fingerprint of the user's work is wrong, no downstream alignment can be right; surfacing it as its own step lets us catch and correct that early. If we collapsed both calls into one, we'd lose this checkpoint.

### 3.4 Targeted verification search

**Input:** Proposed correspondences from §3.3.
**Output:** Per-correspondence verification status (corroborated / contradicted / unverified) plus citation evidence.

**Implementation:** This is where the literature work happens, but it's *targeted* — we now know what to look for, so we don't pull a 60-paper corpus blindly. For each proposed correspondence:

1. Construct precise search queries. Use terms drawn from both domains' fingerprints, including specific named mechanisms ("Hopfield network energy function" + "spin glass Hamiltonian" + papers connecting them).
2. Search arXiv API + Semantic Scholar Graph API + OpenAlex.
3. For each retrieved paper, an LLM call asks: does this paper corroborate, contradict, or is it irrelevant to the proposed correspondence?
4. Aggregate per correspondence: how many corroborating papers, how many contradicting, how many irrelevant.

Three possible verification outcomes per correspondence:

- **Corroborated.** Existing literature explicitly notes this correspondence (or a fragment of it). The system has *grounded* the model's structural intuition. Highest confidence.
- **Unverified.** No prior literature explicitly notes this correspondence, but no contradicting evidence either. Could be novel insight, could be wrong. Flagged for the user as "potentially novel — verify carefully."
- **Contradicted.** Literature exists that contradicts the proposed correspondence (e.g., the systems were proposed to be analogous but the analogy was shown to break in a published critique). The model overreached; the system flags this as low-confidence and surfaces the contradicting work.

Per-correspondence search budgets: 5–10 papers retrieved per query; 5–10 verification calls per correspondence. With 5–10 correspondences proposed, total verification load is 50–100 calls — but they can route to Sonnet or Haiku since the question is a constrained classification ("corroborate / contradict / irrelevant"), not deep reasoning.

The "unverified" category is the most interesting one philosophically. A correspondence the model proposes that has no prior published acknowledgment is either genuine novel insight (the model has surfaced something real that nobody has written down) or hallucination. The system can't distinguish these on its own — but it can present them honestly to the user as "the model proposes this; literature is silent; treat with care." That's a useful output, not a failure mode.

### 3.5 Domain-form rendering

**Input:** Verified correspondences plus the user's declared field of expertise.
**Output:** Each correspondence rendered in the formal vernacular of the user's domain.

The structure is the same across domains; the surface vocabulary is whatever the user works in. The system asks the LLM, with the verification evidence as context, to render each correspondence in the user's working language:

- **Physicist:** equations. The energy function, the Hamiltonian, the phase-transition condition — written down in both domains side by side, with the structural correspondence made explicit at the level of the math. Hopfield/spin-glass isn't a real analogy to a physicist until the energy function appears in both contexts with the symbols mapped.
- **Chemist:** reaction networks and kinetic equations. A signaling-cascade analogy isn't real until the kinetic schema is written in both systems and the structural correspondence is shown at the level of rate equations and reaction topology.
- **Biologist:** pathway diagrams and topological structure. The signaling-cascade analogy renders as a topology comparison — same connectivity, same feedback loops, same conservation properties — across the two systems.
- **Computer scientist / theorist:** algorithms, data structures, pseudocode. A graph-traversal analogy isn't real until you can write pseudocode that runs in both domains.
- **Theoretical neuroscientist:** dynamical-systems formalism. Phase portraits, fixed points, basins of attraction — the structural correspondence rendered in the language of dynamics.

**Field detection.** The user declares their field at signup. For Entry-by-upload, the system also infers field from the document itself and prefers that inference if it conflicts with the declared field. The user can override at any time, including switching the rendering mid-session.

**Why this is the headline feature.** Other AI-for-science tools tell the researcher *that* two domains are connected. v2 tells them what that connection looks like *in their own working language*. Researchers can take a domain-form rendering and verify it against their own knowledge — and either trust the rest of the analogy or catch the system in a specific, articulable error. Either outcome stops the system from being a black box.

**Implementation:** One Opus call per correspondence, with the verification evidence in context. 5–10 correspondences typical; 5–10 calls.

### 3.6 Visualization & UI surface

**The visualization is the primary output of the pipeline.** The structural fingerprints, the correspondences, the verification status, and the domain-form rendering are all reachable through it.

**Headline view: parallel typed graphs with correspondence ribbons.** The user's domain on the left, candidate analog domain on the right. Ribbons span the middle showing the structural correspondences; ribbon thickness encodes confidence; ribbon color encodes verification status (corroborated / unverified / contradicted). Within each domain, edges between concepts are styled by the role they play (causal, compositional, constraining).

**Absence shown as forcefully as presence.** Unmapped concepts in either domain are visible and styled as gaps. Edges that should exist under the mapping but don't are dashed and labeled as break-points. The user sees what the analogy *fails to cover* with the same visual weight as what it covers.

**Drill-in side panel.** Click any node, edge, or ribbon to open a side panel with four layered views:

1. **Structural reasoning** — why the model proposed this concept plays this role, why the correspondence was identified, why the break-point exists where it does.
2. **Verification status** — corroborating papers (with citation spans), contradicting papers if any, or "unverified — no prior literature found."
3. **Citation evidence** — the specific source spans in the source papers, readable as text. The user can read the actual sentences justifying each claim.
4. **Domain-form rendering** — the correspondence translated into the user's working vernacular: equation, reaction schema, pathway topology, pseudocode, dynamical-systems formalism.

**Layer ordering by user field.** The default-visible layer matches the user's declared field. A physicist clicks a ribbon and sees the equation first; structural reasoning, verification, and citations are below. An audit-mode user can flip the default to "verification first." The layering is fixed; the entry layer is parameterized.

**Multi-domain candidates.** If §3.3 surfaced 3+ candidate analog domains, the visualization shows the user's domain in the center with rays out to each candidate. The user can promote any candidate to the headline parallel-graph view. Most analyses will produce one strong analog and 1–2 weaker ones; this UI handles that distribution naturally.

---

## 4. MVP Scope

**Goal:** ship a credibly-grounded engine in ~6 weeks. (Substantially shorter than original spec because the pipeline is simpler — no claim extraction, no equivalence partitioning, no relationship classification, no greedy alignment search.)

**In MVP:**

- All six pipeline stages with the system prompt as written
- Manuscript-only entry (PDF upload + Markdown notes)
- The connective-tissue visualization with full drill-in
- Domain-form rendering for at least three field profiles at launch: physics (equations), biology (pathway diagrams), and computer science / ML (pseudocode + algorithmic). Other fields fall back to a generic structural rendering until field-specific renderers are added.
- Targeted verification search with corroborate / contradicted / unverified classification

**Not in MVP:**

- Researcher-in-the-loop refinement of structural fingerprints (Phase 1)
- Larger verification corpora (Phase 1)
- Field profiles beyond the three launch fields — chemistry, neuroscience, etc. (Phase 1)
- Cross-tool integration with Manifest (Phase 3)
- Self-improving prompt tuning from researcher feedback (Phase 3)

**Explicitly dropped from earlier v1/v2 plans:**

- Generic domain dropdowns at the entry point — replaced by manuscript upload
- User-stated analogies as an entry point — the AI does the work
- Claim extraction as a discrete pipeline stage — folded into structural surfacing
- Equivalence partitioning, relationship classification, graph alignment as discrete stages — the LLM does this implicitly; we don't reconstruct it externally
- Hypothesis generation as a primary feature — researchers don't trust AI-generated ideas; they trust verification of their own
- Real novelty check + cross-domain implications as Manifest features — these moved to LatentLink (see §11)

---

## 5. Design Implications of Approximate Methods

The implementation rests on the LLM's implicit encoding of structural correspondence rather than reconstructing it externally. This has direct implications for how the system is designed and surfaced.

| Approximation | Design implication |
|---|---|
| The structural correspondence comes from the LLM's training, not from formal verification | Verification step (§3.4) is mandatory — every proposed correspondence either has literature backing or is flagged as unverified |
| The model can hallucinate structural correspondences that don't exist | The "unverified" category is explicit and styled differently in the UI; users see absence of corroboration as a real signal |
| The model can miss structural correspondences that do exist | The system surfaces top candidates; users can request "search harder" or upload a hint about a domain to consider |
| Domain-form rendering is LLM-generated, not symbolically derived | Render with verification evidence in context; flag low-confidence renderings; let the user mark a rendering as wrong |
| The system prompt may bias toward certain kinds of correspondence | Prompt is a living artifact; iterate against historical-analogy benchmark; document version history |
| Coverage is bounded by the LLM's training cutoff | UI states "model knowledge cutoff: [date]"; verification step compensates for some of this by pulling current literature |

These are engineering constraints. They shape the UX and the iteration roadmap. They are not weaknesses to apologize for — they are the reason the system has falsifiable outputs. Each is a target for tightening in later phases.

---

## 6. Iteration Evaluation

How we know each pipeline stage is working *during the build* — engineering feedback loops, not paper benchmarks.

- **Manuscript ingestion:** Upload 5 papers from various fields and inspect the extracted metadata + working representation. If the system reads them correctly, the stage works.
- **Structural surfacing (§3.3 Call 1):** For each test paper, ask: does the structural fingerprint match what a domain expert would say the paper is doing? This is the most important stage — if the fingerprint is wrong, nothing downstream can be right.
- **Structural surfacing (§3.3 Call 2):** Run on 2–3 historically validated analogies (Hopfield/spin glass is the obvious first case — upload a Hopfield-network paper and see whether the system surfaces the spin-glass correspondence). Does it find the known analog? Does it produce sensible break-points? If not, debug the system prompt.
- **Verification search:** For each proposed correspondence, manually check: did the search retrieve relevant papers? Did the corroborate / contradicted / irrelevant classification match human judgment on a sample of 5–10 retrievals?
- **Domain-form rendering:** For each field profile, run on 3–5 known cases and ask field experts: is the rendering correct? Does it preserve the structural correspondence? Are the symbols / mechanisms / topology mapped consistently?
- **Visualization:** Sit a working scientist in front of the visualization (or screen-share with one) and ask them to drill from a high-level analogy down to a citation. If they can do it without explanation, the UI works. If they get lost, the layering is wrong.
- **End-to-end:** After MVP works on validated cases, run on novel manuscripts from real researchers and ask: did the system surface a correspondence you hadn't consciously articulated? Was the verification useful? Could you take a domain-form rendering and use it in your work?

The serious benchmark — comparing v2 against v1, embedding baselines, and direct LLM prompts on a curated set of historical analogies — is a paper artifact for later. Don't build it during MVP. Use the lightweight checks above to keep momentum.

---

## 7. Technical Stack

- **Heavy reasoning LLM:** Claude Opus for manuscript preprocessing (§3.1), structural surfacing (§3.3, both calls), domain-form rendering (§3.5)
- **Light LLM for filtering:** Claude Haiku or GPT-4o-mini for verification classification (§3.4) — high-throughput, constrained classification, no need for Opus
- **Paper sources:** arXiv API, Semantic Scholar Graph API, OpenAlex
- **Embeddings:** OpenAI `text-embedding-3-large` only for query expansion in §3.4 (constructing search terms from structural fingerprints) — much narrower role than in the original spec
- **Backend:** Python (FastAPI). Pipeline is async; user uploads, gets a "processing" state, results push back as a notification or via polling.
- **Graph rendering (frontend):** D3 or Cytoscape.js for the parallel-graphs visualization. Reuse from the Notes2Tree visualization stack if there's overlap in primitives.
- **Math rendering:** KaTeX or MathJax for the physics-field renderer.
- **Diagram rendering:** Mermaid or vis.js for biology pathway diagrams; pseudocode and dynamical-systems formalisms render as styled text.
- **Storage:** Back4App for user accounts, manuscripts, generated structural fingerprints, and rendered outputs. Cache aggressively at the structural-fingerprint level — same manuscript shouldn't re-run §3.3.
- **Job queue:** Lightweight async — most queries complete in 60–120 seconds, not the 10–30 minutes of the original architecture.

---

## 8. API Call Budget per Query

For a typical manuscript upload:

| Stage | Calls | Model | Notes |
|---|---|---|---|
| 3.1 Preprocessing | 1 | Opus | Normalize + extract metadata |
| 3.3 Call 1: User's fingerprint | 1 | Opus | Large prompt + system prompt |
| 3.3 Call 2: Cross-domain alignment | 1 | Opus | Large prompt + large structured output |
| 3.4 Verification classification | 30–80 | Haiku/Sonnet | One per retrieved paper across all correspondences |
| 3.4 Search query construction | 5–10 | Sonnet | One per correspondence |
| 3.5 Domain-form rendering | 5–10 | Opus | One per verified correspondence |

**Total: 43–102 calls per query**, with 8–12 of those being Opus and the rest routing to cheaper models. Realistic cost per query: **$0.50–$2.00**. Cached queries (same manuscript, re-rendered for different field) cost only the rendering pass: ~$0.20.

That makes a free tier viable. Reasonable structure:

- **Free:** 5 queries / month, single field renderer, cached results unlimited. Cost to us: ~$0.50/free user/month worst case.
- **Pro:** 50 queries / month, all field renderers, verification on richer corpora. Pricing target $20–30/month.
- **Institutional:** unlimited, custom corpora, API access.

---

## 9. Roadmap

| Phase | Timeline | Deliverable |
|---|---|---|
| **0 — MVP** | 6 weeks | Pipeline end-to-end. Replaces v1 engine. Three field profiles. |
| **1 — Polish** | 3 months post-MVP | Researcher-in-the-loop fingerprint refinement. Additional field renderers (chemistry, neuroscience). UX polish on visualization. Larger verification corpora. |
| **2 — Stronger surfacing** | 6–12 months post-MVP | Iterated system prompt tuning against benchmark. Multi-modal manuscript inputs (figures, equations from images). Active learning on verification classifier. |
| **3 — Compounding** | 12+ months | Cross-tool features (e.g., Manifest's internal-rigor checks pulling correspondences from LatentLink for context). Self-improving prompts from researcher feedback at scale. |

---

## 10. Engineering Risks & Judgment Calls

**Risk: structural surfacing produces hallucinated correspondences.** Most likely failure mode — model proposes plausible-sounding analogies that don't actually hold. *Mitigation:* the verification step (§3.4) catches many of these. For the rest, the "unverified" category surfaces them honestly to the user. The system never claims a correspondence is real if literature can't corroborate it.

**Risk: structural fingerprint is wrong.** If §3.3 Call 1 misreads what the user's paper is structurally doing, no downstream alignment can be right. *Mitigation:* surface the fingerprint to the user as its own UI artifact, let them flag errors, and iterate the system prompt against cases where it misreads.

**Risk: system prompt is the entire game.** The pipeline's quality is gated by the system prompt's quality. Bad prompt → bad output, regardless of how good the rest of the engineering is. *Mitigation:* treat the prompt as a versioned, evaluated artifact. Track every change against the historical-analogy benchmark. Document why each version is better than the last.

**Risk: targeted verification search misses corroborating literature.** If §3.4's search queries are weak, real correspondences get classified as "unverified." *Mitigation:* construct queries with terms from both domains' fingerprints, use multiple search backends, allow the user to expand the search manually if a correspondence looks interesting but unverified.

**Judgment call: how aggressive on the system prompt?** The current draft (§3.2) has explicit examples and explicit do/don't instructions. There's a risk it over-constrains the model and prevents it from surfacing genuinely novel correspondences that don't match the example pattern. Worth A/B-testing the current prompt against a stripped-down version that just describes the task without examples, on the historical-analogy benchmark.

**Judgment call: when does the user see "unverified" as a feature vs. a bug?** Researchers might initially read "unverified" as "the system isn't sure" rather than "this could be a novel finding worth investigating." Worth thinking about UI copy carefully — "potentially novel — no prior literature noted this connection" lands very differently from "unverified."

**Judgment call: backend architecture.** Separate Python service or Back4App-integrated? Recommendation: separate Python service for the pipeline; Back4App for user-facing storage, accounts, and API. Async job-queue infrastructure is cleaner standalone.

**Judgment call: open-source the system prompt?** The system prompt is the engineering crown jewel. It's also potentially the framework's best demonstration in operational form. Worth deciding explicitly: do we publish it (gives credibility, lets researchers audit, fits the "Kedion publishes" positioning) or keep it proprietary (preserves competitive moat)? Lean toward publishing — it's much harder to copy a framework than a prompt, and the prompt's existence as a public artifact strengthens the framework paper.

---

## 11. The Line With Manifest

The original Manifest specification listed four checks: citation completeness, methodology stress-test, real novelty check, and cross-domain implications. The last two of those are structurally the same job LatentLink does. They've moved to LatentLink in this revision.

**LatentLink's territory:**
- Cross-domain structural correspondences (the headline)
- Real novelty assessment via structural correspondence + verification (whether this work's contribution is genuinely structurally new, or a relabeling of work already done in adjacent fields)
- Cross-domain implications (what this work's findings might mean in other domains, via domain-form rendering)
- Excavating implicit structural moves in the user's own manuscript

**Manifest's territory (paper-bounded checks only):**
- Citation completeness within the paper's own bibliographic claims (does the paper cite what it claims to draw on?)
- Methodology stress-test (sample size, controls, statistical methods vs. discipline norms)
- Internal consistency check (do claims follow from evidence within the paper?)
- Claim-evidence traceability (every claim should be supported by something the paper itself shows or cites)

The line: **LatentLink looks at your paper as embedded in the broader scientific landscape; Manifest looks at your paper as a self-contained artifact and pressure-tests its internal rigor.** Neither does the other's job. Each is a coherent product mandate that doesn't overlap.

For users, the workflow remains intuitive: run LatentLink first (does my work hold up structurally and against the broader literature?), then run Manifest (does my paper hold up internally as a piece of writing?). Sequential rather than overlapping.

---

## 12. Immediate Next Steps

1. **Iterate on the system prompt against the Hopfield/spin-glass case.** Upload a Hopfield-network paper, run §3.3 Call 1 + Call 2, and check whether the system surfaces the spin-glass correspondence. Iterate the prompt until it does, reliably. This is the engineering target throughout MVP development.
2. **Build the structural-fingerprint UI artifact** as the first user-visible piece. Even before the alignment is good, showing users "here is what your paper is structurally doing" is independently valuable and will get feedback flowing.
3. **Prototype a single domain-form renderer.** Pick physics (the easiest field to validate against the Hopfield/spin-glass case) and prototype the rendering on the test correspondence. If this works convincingly on one case, the pattern generalizes; if it doesn't, find out before building the rest.
4. **Sketch the visualization on paper before any rendering code.** Get the parallel-graphs view + drill-in side panel right in static mockups before D3 work begins.
5. **Decide on backend architecture** before infrastructure code (separate Python service vs. Back4App integrated).
6. **Update the Manifest spec** when we get to it, removing the cross-domain features that have moved to LatentLink and tightening its mandate to internal-paper rigor only.
7. **Update the kedion.ai homepage** to match the redrawn line: Manifest's section drops the cross-domain language; LatentLink's section adds the manuscript-upload entry point and structural-correspondence framing.

---

*End of engineering spec. Theoretical insights surfaced during implementation belong in `latentlink_v2_research_notes.md`, not in this document.*

# LatentLink v2 — Research Notes

**Purpose:** A running file for theoretical insights surfaced during the LatentLink v2 build. The engineering spec describes what gets built; this file captures what gets *learned* in the process — observations, anomalies, methodology refinements, and ideas worth turning into papers later.

**Convention:**
- Every entry is dated and tagged with the pipeline stage or topic area it relates to.
- Entries can be raw — the goal is capture, not polish.
- When a notes entry matures into something concrete, move it into the engineering spec (if it's a build decision) or note it as `→ Paper N` (if it's a research result worth writing up).

---

## 1. Open Research Questions

Standing questions that the build will inform. Each can become a Kedion-authored paper as evidence accumulates.

**Note (post-rearchitecture):** Many of the questions in earlier drafts assumed the original v2 pipeline that reconstructed predictive equivalence classes externally with embeddings, judges, and graph algorithms. That architecture has been replaced — the LLM surfaces its implicit structural knowledge directly via the framework system prompt, with verification grounding the output against literature. The questions below are updated to reflect this. Questions that are now moot (external PEC clustering quality, relationship-taxonomy completeness, greedy alignment performance) are archived in §7 for traceability.

### 1.1 The system prompt's calibration

**Question:** How well does the framework system prompt elicit the structural knowledge the LLM has implicitly? Does it under-elicit (missing real correspondences the model could surface with better prompting), over-elicit (producing hallucinated correspondences), or both, in different cases?

**Why it matters:** If the prompt is the entire interface between the framework and the LLM's implicit structural knowledge, calibrating it is the central engineering problem. It's also a research problem — the patterns of what works and what doesn't reveal something about how structural knowledge is organized in the model.

**How the build informs:** Track every prompt revision against the historical-analogy benchmark. Document which kinds of changes improve which kinds of outputs. Note especially where adding examples helps vs. constrains. (This is a focused version of §1.7 — they should probably be merged once we have enough data to know whether they're really one question or two.)

**Status:** Active during MVP development.

---

### 1.2 Verification as ground truth proxy

**Question:** Literature corroboration is used as a proxy for "this correspondence is real." How good is that proxy? Are there real correspondences nobody has written about yet? Are there false correspondences that have published support because of bad prior work?

**Why it matters:** The "unverified" classification (§3.4) is doing a lot of UX work — it tells users when to be careful. If verification is a clean signal, the UX is honest. If verification systematically misses real correspondences (because nobody has connected those domains in print yet), or systematically affirms false ones (because of citation cascades around bad analogies), the UX overstates what the system actually knows.

**How the build informs:** For known correspondences in the historical-analogy benchmark, check: did verification correctly classify them? Where it didn't, why? Build a small inventory of false-positives and false-negatives in verification and look for patterns.

**Status:** Not started. Becomes meaningful after MVP runs on enough cases.

---

### 1.3 Partial mappings

**Question:** Most real cross-domain analogies are partial — they hold within bounds and break outside them. The current framework paper handles total maps. What does a formalization of partial maps look like, and how do the system's identified break-points map onto that formalization?

**Why it matters:** Real scientific use of analogies is almost always bounded. Galileo's mechanics ↔ planetary motion broke at relativistic speeds. Hopfield networks ↔ spin glasses breaks at certain noise thresholds. The "where it breaks" output in the spec demands a formal account of partiality.

**How the build informs:** Track the cases where the system produces high-confidence correspondences with consistent break-points. The break-points may have structure of their own — e.g., they cluster around certain kinds of relationships, or certain conditions. That structure is the seed of a partiality formalization.

**Status:** Not started. Likely Paper 3 material.

---

### 1.4 Confidence calibration

**Question:** The system produces confidence scores per correspondence (from the LLM's own confidence + verification status). Are these calibrated? Do users' actual experience of "this correspondence is true" track the system's confidence?

**Why it matters:** LLM confidence is famously poorly calibrated. Verification adds signal but isn't a complete fix. If users learn that "85% confidence" doesn't track real reliability, they stop trusting the numbers — which means we should either fix calibration or stop showing numbers.

**How the build informs:** As MVP runs on real queries, track the relationship between system confidence and user-reported correctness (when feedback is available). If they correlate, fine. If not, there's a calibration paper to write.

**Status:** Not started.

---

### 1.5 Multi-domain correspondence

**Question:** When the system surfaces 3+ candidate analog domains, do the structural correspondences compose in interesting ways? If A↔B and A↔C, is there a derivable B↔C? Does the model's implicit structural knowledge produce consistent multi-way relationships?

**Why it matters:** If three-way correspondences compose predictably, multi-domain analysis becomes a tractable and interesting product feature. If they don't, multi-domain is just "two-domain run multiple times."

**How the build informs:** Phase 1 of the roadmap. Until then, parked.

**Status:** Not started. Phase 1.

---

### 1.6 Domain-form rendering as evidence for meta-causal structure

**Question:** Domain-form rendering takes the same structural correspondence and renders it across surface vocabularies (equations, pathway diagrams, pseudocode, etc.). How well does the rendering preserve correspondence across forms? Where does it fail?

**Why it matters:** This is the framework's central claim made operational. If structural correspondence carries cleanly across surface vocabularies, that's strong evidence for meta-causal structure as a real level of description. If it doesn't — if renderings frequently disagree about what corresponds to what — either the framework is weaker than the paper claims or our implementation is failing somewhere upstream.

**How the build informs:** For each preserved correspondence in the historical-analogy benchmark, render in 2+ field forms and ask field experts: do the renderings refer to the same structural relationship? Where they disagree, why? Document the disagreements; they're either a finding about the framework or a finding about the renderer.

**Status:** Not started. This is the most directly framework-validating empirical question the build can answer. Likely Paper 3 or 4 material.

---

### 1.7 The system prompt as research artifact

**Question:** The pipeline's quality is gated almost entirely by the system prompt that conveys the framework's operational logic to the LLM. What makes a "good" framework-conveying prompt? How sensitive is output quality to prompt phrasing? What kinds of examples generalize, and which over-constrain the model?

**Why it matters:** If we're claiming the LLM already has implicit knowledge of structural correspondence and we just need to surface it, the system prompt is the mechanism by which we surface it. Understanding what makes prompts work (or not) is understanding what the framework's claim actually predicts at the level of LLM behavior. This is the most direct interface between the framework's theory and the LLM's empirical capabilities.

**How the build informs:** Treat the system prompt as a versioned artifact. Every revision tested against the historical-analogy benchmark. Track which kinds of prompt changes improve which kinds of outputs. Document failures: prompts that worked for one analogy and broke another. The pattern of what works should reveal something about how structural knowledge is organized in the model's weights — and by extension, something about the framework's claim.

**Status:** Not started. Active during MVP development; potentially Paper 2 material if the patterns are interesting.

---

### 1.8 Hallucinated correspondence as failure mode vs. discovery signal

**Question:** When the model proposes a structural correspondence that has no prior literature acknowledgment ("unverified" in the §3.4 classification), is it usually hallucinating, or is it sometimes surfacing genuine novel insight?

**Why it matters:** If unverified correspondences are mostly hallucination, the system needs to suppress them (or warn aggressively). If they're sometimes real discoveries, the system has accidentally become a novel-hypothesis generator and we need to think hard about how to validate them. The answer probably has structure — some unverified correspondences are clearly hallucinations (model misreads the paper), others are at the edge of provable novelty.

**How the build informs:** Track unverified correspondences over time. Send a sample to domain experts and ask: does this look like nonsense, plausible but unproven, or actually interesting? The distribution of expert responses tells us what "unverified" actually means in practice — and how the UI should communicate it.

**Status:** Not started. Becomes interesting once the system has been running on real manuscripts long enough to have a meaningful sample.

---

### 1.9 Implicit structural knowledge in LLMs as empirical claim

**Question:** The architecture rests on the framework's claim that LLMs trained on scientific corpora encode predictive equivalence implicitly. To what extent is this actually true? Where does it hold strongest, where does it fail?

**Why it matters:** This is the framework's foundational empirical claim — the thing that makes the v2 architecture even possible. If LLMs really do encode structural correspondence in their weights, the system works. If they encode something more like surface co-occurrence dressed up as correspondence, the system fails in subtle and predictable ways. Understanding *which* is the case, and *where*, is the empirical core of validating the framework.

**How the build informs:** Compare the model's outputs across domains where we have strong vs. weak prior reason to expect implicit structural knowledge. Domains heavily represented in training (physics, ML, biology) should produce richer correspondences than emerging or thin-corpus fields. The pattern of variation maps something real about how training data shape the implicit structural representation.

**Status:** Not started. Long-running observation; substantial paper material once enough data accumulate.

---

## 2. Theoretical Observations from the Build

(Populate as the build progresses. Each entry: date, stage, observation, implication.)

*No entries yet — start logging once corpus ingestion and claim extraction prototypes are running.*

---

## 3. Methodology Refinements Worth Formalizing

Things the engineering team works out empirically that turn out to be worth writing up as methodology contributions.

*No entries yet.*

---

## 4. Anomalies & Surprises

Cases where the system behaves unexpectedly — either failing on what should be easy, or succeeding on what should be hard. These are usually where the most interesting theory lives.

*No entries yet.*

---

## 5. Related Work to Engage With

Existing literature the eventual paper will need to position against. Capture as it surfaces during the build.

### 5.1 Computational analogical reasoning

- **Webb, Holyoak & Lu (2023+)** — recent work on LLM analogical reasoning benchmarks. Generally treats analogy as classification rather than structural alignment. The framework's contribution is the structural alignment angle they don't engage with.
- **Lewis & Mitchell (2024+)** — pushback on Webb et al., arguing LLM "analogical reasoning" is largely surface pattern-matching. Aligned with the framework's critique of similarity-based methods. Worth citing as motivation.
- **Gentner's structure-mapping theory** (classic, 1980s onward) — the closest cognitive-science precedent for structural alignment as the basis for analogy. Paper should engage with how the quotient-space framework relates to and differs from SMT.

### 5.2 Cross-domain scientific discovery

- **Swanson's literature-based discovery work** (Raynaud-Magnesium, etc.) — historical precedent for the idea that cross-domain literature search produces real discoveries. Limited by manual methods; v2 is in some sense the AI continuation of this lineage.
- **Iris.ai, Scite, Elicit, Consensus, FutureHouse, Sakana AI** — current AI-for-science landscape. Survey what each one actually does (most are literature search + summarization, not structural alignment) and place v2 in that landscape.

### 5.3 Graph alignment algorithms

- Survey of graph isomorphism / approximate alignment literature. Particularly: GED with semantic costs, learned graph alignment via GNNs, attributed graph matching. Relevant for Phase 2 of the roadmap.

---

## 6. Candidate Paper 2 Outline (Running)

When the MVP runs and the first round of real usage produces results, the launch paper takes shape. Drafting the outline incrementally as the build progresses keeps the engineering targeted.

**Working title:** *An approximate algorithm for analogical alignment based on predictive equivalence partitioning*

**Sketch (subject to revision as we learn):**

1. **Introduction.** The gap between similarity-based and structure-based analogy in current AI tools.
2. **Background.** Brief recap of the framework paper's quotient-space formulation.
3. **Method.** The six-stage pipeline.
4. **Implementation.** Engineering decisions, MVP scope.
5. **Evaluation.** Comparison against v1, embedding baselines, direct LLM prompts on historical analogies.
6. **Results.** What v2 found that the baselines missed. Where v2 broke. Confidence calibration analysis.
7. **Discussion.** What this tells us about approximate vs. formal equivalence (§1.1). Implications for the relationship taxonomy (§1.2). Toward a formalization of partial maps (§1.3).
8. **Limitations & Future Work.** Honest accounting; roadmap toward Phases 2 and 3.

**Status:** Outline only. Section 5–6 are the empirical heart and depend on MVP being shipped + run on real cases.

---

## 7. Discarded / Folded Items

When entries get incorporated into the engineering spec, or when an open question gets resolved, log here for traceability.

### Architectural shift — from external reconstruction to LLM-implicit-surfacing (date of shift: during spec drafting, pre-MVP)

The original v2 architecture reconstructed predictive equivalence externally — extracting claims, embedding them, clustering into PECs, classifying typed edges between PECs, running greedy graph alignment. This was abandoned after recognizing that the framework's own claim is that LLMs already encode this structure implicitly during training. Reconstructing it externally was doing the work twice, badly.

The questions tied to that architecture are archived below. They may become relevant again if the LLM-implicit-surfacing approach fails in unexpected ways and we need to fall back on external reconstruction. Otherwise they're dead.

**Archived:**

- *Q: Approximate vs. formal predictive equivalence (the LLM-judge calibration question for external clustering).* Moot — there's no external clustering anymore. The model produces equivalence implicitly; we don't recompute it. Replaced by §1.1 (the system prompt's calibration).
- *Q: The relationship taxonomy (causal/compositional/constraining/specializing/conflicting).* Moot for the architecture proper — the model produces correspondences in natural language without committing to a fixed taxonomy of relationships. The taxonomy may still be useful as a UI rendering / categorization layer; if so, that's a UI question, not a research question.
- *Q: Greedy alignment performance vs. exact graph alignment.* Moot — there's no greedy alignment. The LLM produces alignment in one (or two) calls.

The break-point detection question (formerly part of the alignment-search debugging) survives as §1.3 (partial mappings), since the system still produces break-points; they just emerge from the model's structural surfacing rather than from edge-mismatch detection in a reconstructed graph.

---

*End of running notes. Add freely; refactor when sections get unwieldy.*

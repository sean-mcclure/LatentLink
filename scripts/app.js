const PIPELINE_STEPS = [
    { key: 'extract', title: 'Manuscript intake', description: 'Normalize the upload into a working document model.' },
    { key: 'fingerprint', title: 'Structural fingerprint', description: 'Extract the organizing entities, dynamics, and constraints.' },
    { key: 'correspondences', title: 'Analog domain surfacing', description: 'Propose analog domains and explicit role mappings.' },
    { key: 'verification', title: 'Verification search', description: 'Check each mapping against literature and flag confidence.' },
    { key: 'render', title: 'Field-native rendering', description: 'Render each verified mapping in the user\'s own formal vernacular.' }
];

const state = {
    user: null,
    selectedCorrespondenceId: null,
    analysis: null,
    pipelineStatus: PIPELINE_STEPS.map((step) => ({ ...step, status: 'idle', detail: step.description })),
    notebookList: []
};

document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
    setupEventListeners();
    setupAuthListeners();
    renderPipelineStatus();
});

async function initializeApp() {
    if (typeof Parse === 'undefined') {
        showToast('Parse SDK failed to load.', 'error');
        return;
    }

    try {
        if (Parse.User.current()) {
            await authManager.validateSession();
        }
    } catch (error) {
        console.error('Session validation error:', error);
    }

    try {
        await subscriptionManager.initialize();
    } catch (error) {
        console.error('Stripe initialization error:', error);
    }

    if (authManager.isAuthenticated()) {
        state.user = authManager.getCurrentUser();
        await state.user.fetch();
        await notebookManager.loadNotebooks();
        showMainApp();
        updateUserMenu();
        renderAnalysisSummary();
        renderNotebookLibrary();
    } else {
        showAuthSection();
    }
}

function setupEventListeners() {
    const analyzeBtn = document.getElementById('analyze-btn');
    const saveSessionBtn = document.getElementById('save-session-btn');
    const newAnalysisBtn = document.getElementById('new-analysis-btn');
    const rerenderBtn = document.getElementById('rerender-btn');
    const viewNotebooksBtn = document.getElementById('view-notebooks-btn');
    const backToAppBtn = document.getElementById('back-to-app-btn');

    analyzeBtn?.addEventListener('click', runAnalysis);
    saveSessionBtn?.addEventListener('click', saveCurrentAnalysis);
    newAnalysisBtn?.addEventListener('click', resetWorkspace);
    rerenderBtn?.addEventListener('click', rerenderCorrespondences);
    viewNotebooksBtn?.addEventListener('click', showNotebooksView);
    backToAppBtn?.addEventListener('click', showMainApp);

    document.getElementById('close-upgrade-modal')?.addEventListener('click', () => {
        document.getElementById('upgrade-modal').style.display = 'none';
    });
    document.getElementById('upgrade-now-btn')?.addEventListener('click', async () => {
        try {
            showLoading('Redirecting to Stripe...');
            await subscriptionManager.createCheckoutSession();
        } catch (error) {
            hideLoading();
            showToast(error.message, 'error');
        }
    });
}

function setupAuthListeners() {
    document.getElementById('login-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        if (!email || !password) {
            showToast('Email and password are required.', 'error');
            return;
        }

        showLoading('Signing in...');
        const result = await authManager.logIn(email, password);
        hideLoading();

        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }

        state.user = result.user;
        await notebookManager.loadNotebooks();
        showMainApp();
        updateUserMenu();
        renderNotebookLibrary();
    });

    document.getElementById('signup-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;

        if (!name || !email || !password) {
            showToast('All signup fields are required.', 'error');
            return;
        }

        showLoading('Creating account...');
        const result = await authManager.signUp(email, password, name);
        hideLoading();

        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }

        state.user = result.user;
        showMainApp();
        updateUserMenu();
        renderNotebookLibrary();
        showToast('Account created. You can save up to 3 analyses on the free tier.', 'success');
    });

    document.getElementById('subscribe-btn')?.addEventListener('click', async () => {
        try {
            showLoading('Redirecting to Stripe...');
            await subscriptionManager.createCheckoutSession();
        } catch (error) {
            hideLoading();
            showToast(error.message, 'error');
        }
    });

    document.getElementById('show-signup')?.addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('signup-view').style.display = 'block';
    });

    document.getElementById('show-login')?.addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById('signup-view').style.display = 'none';
        document.getElementById('login-view').style.display = 'block';
    });

    document.getElementById('forgot-password')?.addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById('forgot-password-modal').style.display = 'flex';
    });

    document.getElementById('send-reset-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('reset-email').value.trim();
        if (!email) {
            showToast('Enter an email first.', 'error');
            return;
        }

        showLoading('Sending reset email...');
        const result = await authManager.resetPassword(email);
        hideLoading();
        document.getElementById('forgot-password-modal').style.display = 'none';
        showToast(result.success ? 'Password reset email sent.' : result.error, result.success ? 'success' : 'error');
    });

    document.getElementById('cancel-reset-btn')?.addEventListener('click', () => {
        document.getElementById('forgot-password-modal').style.display = 'none';
    });

    document.getElementById('forgot-password-modal')?.addEventListener('click', (event) => {
        if (event.target.id === 'forgot-password-modal') {
            document.getElementById('forgot-password-modal').style.display = 'none';
        }
    });
}

function showAuthSection() {
    document.getElementById('auth-section').style.display = 'block';
    document.getElementById('subscription-section').style.display = 'none';
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('notebooks-view').style.display = 'none';
}

function showMainApp() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('subscription-section').style.display = 'none';
    document.getElementById('main-app').style.display = 'grid';
    document.getElementById('notebooks-view').style.display = 'none';
    renderAnalysisSummary();
}

async function showNotebooksView() {
    await notebookManager.loadNotebooks();
    renderNotebookLibrary();
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('subscription-section').style.display = 'none';
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('notebooks-view').style.display = 'block';
}

function updateUserMenu() {
    const user = authManager.getCurrentUser();
    if (!user) {
        return;
    }

    if (!document.getElementById('user-menu')) {
        const menu = document.createElement('div');
        menu.id = 'user-menu';
        menu.className = 'user-menu';
        menu.innerHTML = `
            <button class="user-button" id="user-menu-btn">
                <span>${escapeHtml(user.get('name') || user.get('email'))}</span>
                <span>+</span>
            </button>
            <div class="user-dropdown" id="user-dropdown">
                <div class="usage-indicator">
                    <div id="usage-text">Loading...</div>
                    <div class="usage-bar"><div id="usage-bar-fill" class="usage-bar-fill"></div></div>
                </div>
                <div class="user-dropdown-item" id="menu-open-library">Open library</div>
                <div class="user-dropdown-item" id="menu-manage-subscription">Manage subscription</div>
                <div class="user-dropdown-item" id="logout-btn">Sign out</div>
            </div>
        `;
        document.body.appendChild(menu);

        document.getElementById('user-menu-btn').addEventListener('click', () => {
            document.getElementById('user-dropdown').classList.toggle('show');
        });
        document.getElementById('menu-open-library').addEventListener('click', showNotebooksView);
        document.getElementById('menu-manage-subscription').addEventListener('click', async () => {
            try {
                showLoading('Opening portal...');
                await subscriptionManager.createPortalSession();
            } catch (error) {
                hideLoading();
                showToast(error.message, 'error');
            }
        });
        document.getElementById('logout-btn').addEventListener('click', async () => {
            await authManager.logOut();
            location.reload();
        });
        document.addEventListener('click', (event) => {
            if (!event.target.closest('#user-menu')) {
                document.getElementById('user-dropdown')?.classList.remove('show');
            }
        });
    }

    updateUsageStats();
}

async function updateUsageStats() {
    const user = Parse.User.current();
    if (!user) {
        return;
    }

    const subscriptionStatus = user.get('subscriptionStatus') || 'inactive';
    const usageTextEl = document.getElementById('usage-text');
    const usageBarFill = document.getElementById('usage-bar-fill');

    if (!usageTextEl || !usageBarFill) {
        return;
    }

    if (subscriptionStatus === 'active') {
        usageTextEl.textContent = 'Premium active';
        usageBarFill.style.width = '100%';
        usageBarFill.style.background = 'linear-gradient(90deg, var(--accent), var(--accent-2))';
        return;
    }

    const result = await notebookManager.loadNotebooks();
    const percentage = Math.min(100, ((result.count || 0) / 3) * 100);
    usageTextEl.textContent = `Free tier: ${result.count || 0} / 3 saved analyses`;
    usageBarFill.style.width = `${percentage}%`;
    usageBarFill.style.background = 'var(--accent)';
}

async function runAnalysis() {
    const canCreate = await notebookManager.canCreateNotebook();
    if (!canCreate.allowed) {
        showUpgradeModal(canCreate.message);
        return;
    }

    const intake = await gatherManuscriptInput();
    if (!intake) {
        return;
    }

    const title = document.getElementById('analysis-title').value.trim() || intake.title || 'Untitled analysis';
    const field = document.getElementById('field-select').value;
    const searchDepth = document.getElementById('analysis-depth').value;
    const note = document.getElementById('analysis-note').value.trim();

    resetPipelineStatus();
    showLoading('Extracting manuscript...');

    try {
        await notebookManager.startNewNotebook({
            title,
            field,
            manuscript: { sourceName: intake.fileName || 'pasted-text', rawText: intake.rawText }
        });

        updatePipelineStep('extract', 'running', 'Normalizing manuscript and extracting claims.');
        setLoadingText('Extracting manuscript...');
        const manuscript = await Parse.Cloud.run('extractManuscript', {
            rawText: intake.rawText,
            fileName: intake.fileName,
            fieldPreference: field,
            title,
            note
        });
        updatePipelineStep('extract', 'complete', `${manuscript.keyClaims.length} key claims extracted.`);

        const manuscriptPayload = createManuscriptPayload(manuscript);

        updatePipelineStep('fingerprint', 'running', 'Computing structural roles and dynamics.');
        setLoadingText('Computing structural fingerprint...');
        const fingerprint = await Parse.Cloud.run('generateStructuralFingerprint', {
            manuscript: manuscriptPayload,
            fieldPreference: field
        });
        updatePipelineStep('fingerprint', 'complete', `${fingerprint.entities.length} structural entities surfaced.`);

        const fingerprintPayload = createFingerprintPayload(fingerprint);

        updatePipelineStep('correspondences', 'running', 'Finding analog domains and role mappings.');
        setLoadingText('Surfacing analog domains...');
        const correspondenceResult = await Parse.Cloud.run('proposeCorrespondences', {
            manuscript: manuscriptPayload,
            fingerprint: fingerprintPayload,
            searchDepth,
            note
        });
        updatePipelineStep('correspondences', 'complete', `${correspondenceResult.correspondences.length} correspondences proposed.`);

        const correspondencesPayload = createCorrespondencesPayload(correspondenceResult.correspondences);

        updatePipelineStep('verification', 'running', 'Searching literature and classifying evidence.');
        setLoadingText('Verifying against literature...');
        const verification = await Parse.Cloud.run('verifyCorrespondences', {
            manuscript: manuscriptPayload,
            fingerprint: fingerprintPayload,
            correspondences: correspondencesPayload,
            searchDepth
        });
        updatePipelineStep('verification', 'complete', verification.summaryLine);

        updatePipelineStep('render', 'running', 'Rendering mappings in field-native form.');
        setLoadingText('Rendering for your field...');
        const renderings = await Parse.Cloud.run('renderCorrespondences', {
            manuscript: manuscriptPayload,
            fingerprint: fingerprintPayload,
            correspondences: createCorrespondencesPayload(verification.correspondences),
            fieldPreference: field
        });
        updatePipelineStep('render', 'complete', `Rendered for ${labelForField(field)}.`);

        const analysis = {
            title,
            field,
            note,
            manuscript,
            fingerprint,
            correspondences: renderings.correspondences,
            candidates: correspondenceResult.candidates,
            verificationSummary: verification.summary,
            pipeline: [...state.pipelineStatus],
            renderings: renderings.correspondences,
            updatedAt: new Date().toISOString()
        };

        state.analysis = analysis;
        state.selectedCorrespondenceId = analysis.correspondences[0]?.id || null;
        notebookManager.updateCurrentNotebook(analysis);

        renderAnalysis();
        renderAnalysisSummary();
        hideLoading();
        showToast('Analysis complete.', 'success');
    } catch (error) {
        console.error(error);
        hideLoading();
        markRunningStepAsError(error.message);
        showToast(error.message || 'Analysis failed.', 'error');
    }
}

async function rerenderCorrespondences() {
    if (!state.analysis?.correspondences?.length) {
        showToast('Run an analysis first.', 'warning');
        return;
    }

    const field = document.getElementById('field-select').value;
    showLoading('Refreshing field-native renderings...');

    try {
        const manuscriptPayload = createManuscriptPayload(state.analysis.manuscript);
        const fingerprintPayload = createFingerprintPayload(state.analysis.fingerprint);
        const renderings = await Parse.Cloud.run('renderCorrespondences', {
            manuscript: manuscriptPayload,
            fingerprint: fingerprintPayload,
            correspondences: createCorrespondencesPayload(state.analysis.correspondences),
            fieldPreference: field
        });
        state.analysis.field = field;
        state.analysis.correspondences = renderings.correspondences;
        state.analysis.renderings = renderings.correspondences;
        notebookManager.updateCurrentNotebook(state.analysis);
        renderAnalysis();
        renderAnalysisSummary();
        hideLoading();
        showToast('Rendering updated.', 'success');
    } catch (error) {
        hideLoading();
        showToast(error.message, 'error');
    }
}

async function saveCurrentAnalysis() {
    if (!state.analysis) {
        showToast('Run an analysis before saving.', 'warning');
        return;
    }

    const canCreate = await notebookManager.canCreateNotebook();
    if (!canCreate.allowed) {
        showUpgradeModal(canCreate.message);
        return;
    }

    showLoading('Saving analysis...');
    const result = await notebookManager.saveNotebook(state.analysis.title);
    hideLoading();
    if (!result.success) {
        showToast(result.error, 'error');
        return;
    }

    await notebookManager.loadNotebooks();
    renderNotebookLibrary();
    updateUsageStats();
    showToast(result.message, 'success');
}

function resetWorkspace() {
    state.analysis = null;
    state.selectedCorrespondenceId = null;
    notebookManager.startNewNotebook({});
    resetPipelineStatus();
    document.getElementById('analysis-title').value = '';
    document.getElementById('manuscript-text').value = '';
    document.getElementById('analysis-note').value = '';
    document.getElementById('manuscript-file').value = '';
    renderAnalysis();
    renderAnalysisSummary();
}

async function gatherManuscriptInput() {
    const textAreaValue = document.getElementById('manuscript-text').value.trim();
    const file = document.getElementById('manuscript-file').files[0];

    if (!textAreaValue && !file) {
        showToast('Upload a manuscript or paste text.', 'error');
        return null;
    }

    let rawText = textAreaValue;
    let fileName = null;
    let title = null;

    if (file) {
        fileName = file.name;
        title = file.name.replace(/\.[^.]+$/, '');
        rawText = rawText || await extractTextFromFile(file);
    }

    if (!rawText || rawText.trim().length < 200) {
        showToast('The manuscript text is too short for structural analysis.', 'error');
        return null;
    }

    return { rawText, fileName, title };
}

async function extractTextFromFile(file) {
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'pdf') {
        if (!window.pdfjsLib) {
            throw new Error('PDF extraction library did not load.');
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            pages.push(content.items.map((item) => item.str).join(' '));
        }
        return pages.join('\n\n');
    }

    return file.text();
}

function renderAnalysis() {
    renderFingerprint();
    renderCandidates();
    renderGraph();
    renderDetailPanel();
}

function renderFingerprint() {
    const titleEl = document.getElementById('fingerprint-title');
    const summaryEl = document.getElementById('fingerprint-summary');
    const gridEl = document.getElementById('fingerprint-grid');
    const verificationPill = document.getElementById('verification-summary-pill');
    const fieldPill = document.getElementById('field-pill');

    if (!state.analysis?.fingerprint) {
        titleEl.textContent = 'Awaiting manuscript';
        summaryEl.textContent = 'Run an analysis to extract the document\'s organizing entities, dynamics, and constraints.';
        gridEl.innerHTML = '';
        verificationPill.textContent = 'No verification yet';
        fieldPill.textContent = 'Generic';
        return;
    }

    const { manuscript, fingerprint, verificationSummary } = state.analysis;
    titleEl.textContent = manuscript.title || state.analysis.title;
    summaryEl.textContent = fingerprint.summary;
    verificationPill.textContent = summarizeVerificationCounts(verificationSummary);
    fieldPill.textContent = labelForField(state.analysis.field);

    const cards = [
        { title: 'Entities', items: fingerprint.entities },
        { title: 'Dynamics', items: fingerprint.dynamics },
        { title: 'Constraints', items: fingerprint.constraints },
        { title: 'Break-sensitive zones', items: fingerprint.sensitiveZones }
    ];

    gridEl.innerHTML = cards.map((card) => `
        <article class="fingerprint-card">
            <h3>${escapeHtml(card.title)}</h3>
            <ul>
                ${(card.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li><span>None extracted.</span></li>'}
            </ul>
        </article>
    `).join('');
}

function renderCandidates() {
    const container = document.getElementById('candidate-domains');
    if (!state.analysis?.candidates?.length) {
        container.classList.add('empty-state-inline');
        container.innerHTML = 'No candidate domains surfaced yet.';
        return;
    }

    container.classList.remove('empty-state-inline');
    container.innerHTML = state.analysis.candidates.map((candidate, index) => `
        <article class="candidate-card ${index === 0 ? 'active' : ''}">
            <span class="pill">${escapeHtml(candidate.domain)}</span>
            <h3>${escapeHtml(candidate.label)}</h3>
            <p>${escapeHtml(candidate.rationale)}</p>
            <ul>
                ${(candidate.anchorTerms || []).map((term) => `<li>${escapeHtml(term)}</li>`).join('')}
            </ul>
        </article>
    `).join('');
}

function renderGraph() {
    const container = document.getElementById('graph-shell');
    if (!state.analysis?.correspondences?.length) {
        container.classList.add('empty-state-inline');
        container.textContent = 'Proposed correspondences will render here once the analysis completes.';
        return;
    }

    container.classList.remove('empty-state-inline');
    const correspondences = state.analysis.correspondences;
    const sourceNodes = collectNodes(correspondences, 'source');
    const targetNodes = collectNodes(correspondences, 'target');
    const width = 520;
    const height = Math.max(520, Math.max(sourceNodes.length, targetNodes.length) * 92);

    const sourceLayout = sourceNodes.map((node, index) => ({ ...node, y: 50 + index * ((height - 100) / Math.max(sourceNodes.length - 1, 1)) }));
    const targetLayout = targetNodes.map((node, index) => ({ ...node, y: 50 + index * ((height - 100) / Math.max(targetNodes.length - 1, 1)) }));

    container.innerHTML = `
        <div class="graph-layout">
            <div class="graph-column">${sourceLayout.map((node) => renderNodeCard(node, 'source')).join('')}</div>
            <div class="graph-visual">
                <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMin meet">
                    <text x="24" y="24" class="graph-label" fill="#d4f57a">User Domain</text>
                    <text x="${width - 158}" y="24" class="graph-label" fill="#7af5c8">Analog Domain</text>
                    ${correspondences.map((correspondence) => {
                        const source = sourceLayout.find((node) => node.name === correspondence.sourceRole.name);
                        const target = targetLayout.find((node) => node.name === correspondence.targetRole.name);
                        const path = createRibbonPath(120, source.y, width - 120, target.y);
                        const stroke = verificationColor(correspondence.verification.status);
                        const activeClass = correspondence.id === state.selectedCorrespondenceId ? 'active' : '';
                        const strokeWidth = Math.max(3, Math.round((correspondence.confidence || 0.5) * 10));
                        return `<path class="ribbon-path ${activeClass}" data-id="${correspondence.id}" d="${path}" stroke="${stroke}" stroke-width="${strokeWidth}"></path>`;
                    }).join('')}
                </svg>
            </div>
            <div class="graph-column">${targetLayout.map((node) => renderNodeCard(node, 'target')).join('')}</div>
        </div>
    `;

    container.querySelectorAll('.ribbon-path').forEach((path) => {
        path.addEventListener('click', () => {
            state.selectedCorrespondenceId = path.getAttribute('data-id');
            renderGraph();
            renderDetailPanel();
        });
    });
}

function renderDetailPanel() {
    const detailTitle = document.getElementById('detail-title');
    const container = document.getElementById('detail-panel');
    const selected = getSelectedCorrespondence();

    if (!selected) {
        detailTitle.textContent = 'Select a ribbon';
        container.classList.add('empty-state-inline');
        container.textContent = 'Choose a correspondence to inspect the reasoning, evidence, and field-native rendering.';
        return;
    }

    detailTitle.textContent = selected.label;
    container.classList.remove('empty-state-inline');
    container.innerHTML = `
        <div class="detail-stack">
            <section class="detail-section">
                <span class="verification-chip ${selected.verification.status}">${selected.verification.status}</span>
                <h3>${escapeHtml(selected.label)}</h3>
                <p>${escapeHtml(selected.summary)}</p>
                <ul class="detail-list">
                    <li><span>Confidence:</span> ${Math.round((selected.confidence || 0) * 100)}%</li>
                    <li><span>Break-points:</span> ${(selected.breakpoints || []).map(escapeHtml).join('; ') || 'None recorded.'}</li>
                </ul>
            </section>

            <section class="detail-section">
                <span class="detail-label">Structural reasoning</span>
                <p>${escapeHtml(selected.reasoning)}</p>
                <div class="mapping-row active">
                    <h4>${escapeHtml(selected.sourceRole.name)} → ${escapeHtml(selected.targetRole.name)}</h4>
                    <p>${escapeHtml(selected.mappingExplanation)}</p>
                </div>
            </section>

            <section class="detail-section">
                <span class="detail-label">Verification evidence</span>
                <div class="evidence-list">
                    ${(selected.verification.evidence || []).map((evidence) => `
                        <article class="evidence-card">
                            <span class="verification-chip ${selected.verification.status}">${escapeHtml(evidence.source)}</span>
                            <h3>${escapeHtml(evidence.title)}</h3>
                            <p>${escapeHtml(evidence.summary)}</p>
                            <div class="evidence-quote">${escapeHtml(evidence.quote || 'No direct quote extracted.')}</div>
                        </article>
                    `).join('') || '<p>No evidence retrieved.</p>'}
                </div>
            </section>

            <section class="detail-section">
                <span class="rendering-label">${escapeHtml(labelForField(state.analysis.field))} rendering</span>
                <p>${escapeHtml(selected.rendering.summary)}</p>
                <div class="rendering-code">${escapeHtml(selected.rendering.artifact)}</div>
                <ul class="rendering-list">
                    ${(selected.rendering.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join('')}
                </ul>
            </section>
        </div>
    `;
}

function renderAnalysisSummary() {
    const container = document.getElementById('analysis-summary');
    if (!state.analysis) {
        container.className = 'summary-stack empty-state-inline';
        container.textContent = 'No analysis loaded yet.';
        return;
    }

    container.className = 'summary-stack';
    container.innerHTML = `
        <div class="summary-item">
            <strong>${escapeHtml(state.analysis.title)}</strong>
            <p>${escapeHtml(state.analysis.manuscript?.title || 'Untitled manuscript')}</p>
        </div>
        <div class="summary-item">
            <strong>Correspondences</strong>
            <p>${state.analysis.correspondences.length} surfaced</p>
        </div>
        <div class="summary-item">
            <strong>Verification</strong>
            <p>${escapeHtml(summarizeVerificationCounts(state.analysis.verificationSummary))}</p>
        </div>
    `;
}

function renderNotebookLibrary() {
    const container = document.getElementById('notebooks-list');
    const notebooks = notebookManager.savedNotebooks || [];
    if (!notebooks.length) {
        container.innerHTML = '<p class="no-notebooks">No saved analyses yet.</p>';
        return;
    }

    container.innerHTML = notebooks.map((notebook) => `
        <article class="notebook-card" data-id="${notebook.id}">
            <span class="pill">${escapeHtml(labelForField(notebook.field))}</span>
            <h3>${escapeHtml(notebook.title)}</h3>
            <p>${escapeHtml(notebook.manuscript?.summary || notebook.analysisRun?.manuscript?.summary || 'Saved analysis session')}</p>
            <div class="hero-tags">
                <span class="notebook-stat">${(notebook.correspondences || []).length} mappings</span>
                <span class="notebook-stat">${new Date(notebook.updatedAt).toLocaleDateString()}</span>
            </div>
            <div class="action-row">
                <button class="btn btn-secondary load-notebook" data-id="${notebook.id}">Load</button>
                <button class="btn btn-secondary delete-notebook" data-id="${notebook.id}">Delete</button>
            </div>
        </article>
    `).join('');

    container.querySelectorAll('.load-notebook').forEach((button) => {
        button.addEventListener('click', () => {
            const notebook = notebookManager.loadNotebook(button.getAttribute('data-id'));
            if (!notebook) {
                showToast('Could not load session.', 'error');
                return;
            }
            state.analysis = notebook;
            state.selectedCorrespondenceId = notebook.correspondences?.[0]?.id || null;
            state.pipelineStatus = notebook.pipeline?.length ? notebook.pipeline : state.pipelineStatus;
            renderPipelineStatus();
            renderAnalysis();
            renderAnalysisSummary();
            showMainApp();
        });
    });

    container.querySelectorAll('.delete-notebook').forEach((button) => {
        button.addEventListener('click', async () => {
            const confirmed = window.confirm('Delete this saved analysis?');
            if (!confirmed) {
                return;
            }

            const result = await notebookManager.deleteNotebook(button.getAttribute('data-id'));
            if (!result.success) {
                showToast(result.error, 'error');
                return;
            }

            await notebookManager.loadNotebooks();
            renderNotebookLibrary();
            updateUsageStats();
            showToast('Analysis deleted.', 'success');
        });
    });
}

function renderPipelineStatus() {
    const container = document.getElementById('pipeline-status');
    container.innerHTML = state.pipelineStatus.map((step) => `
        <div class="pipeline-step">
            <span class="status-dot ${step.status}">${statusIcon(step.status)}</span>
            <div>
                <div class="pipeline-step-title">${escapeHtml(step.title)}</div>
                <div class="pipeline-step-copy">${escapeHtml(step.detail)}</div>
            </div>
        </div>
    `).join('');
}

function resetPipelineStatus() {
    state.pipelineStatus = PIPELINE_STEPS.map((step) => ({ ...step, status: 'idle', detail: step.description }));
    renderPipelineStatus();
}

function updatePipelineStep(key, status, detail) {
    state.pipelineStatus = state.pipelineStatus.map((step) => step.key === key ? { ...step, status, detail } : step);
    renderPipelineStatus();
    notebookManager.updateCurrentNotebook({ pipeline: state.pipelineStatus });
}

function markRunningStepAsError(message) {
    const running = state.pipelineStatus.find((step) => step.status === 'running');
    if (!running) {
        return;
    }
    updatePipelineStep(running.key, 'error', message || 'Stage failed.');
}

function getSelectedCorrespondence() {
    if (!state.analysis?.correspondences?.length) {
        return null;
    }

    return state.analysis.correspondences.find((item) => item.id === state.selectedCorrespondenceId) || state.analysis.correspondences[0];
}

function collectNodes(correspondences, side) {
    const map = new Map();
    correspondences.forEach((item) => {
        const role = side === 'source' ? item.sourceRole : item.targetRole;
        if (!map.has(role.name)) {
            map.set(role.name, role);
        }
    });
    return [...map.values()];
}

function renderNodeCard(node, side) {
    return `
        <article class="graph-node ${node.name === getSelectedCorrespondence()?.[side === 'source' ? 'sourceRole' : 'targetRole']?.name ? 'active' : ''}">
            <div class="graph-node-role">${escapeHtml(node.roleType)}</div>
            <div class="graph-node-name">${escapeHtml(node.name)}</div>
        </article>
    `;
}

function createRibbonPath(startX, startY, endX, endY) {
    const midX = (startX + endX) / 2;
    return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
}

function verificationColor(status) {
    if (status === 'corroborated') {
        return '#d4f57a';
    }
    if (status === 'contradicted') {
        return '#ff7878';
    }
    return '#ffc96b';
}

function summarizeVerificationCounts(summary) {
    if (!summary) {
        return 'No verification yet';
    }
    return `${summary.corroborated} corroborated / ${summary.unverified} unverified / ${summary.contradicted} contradicted`;
}

function labelForField(field) {
    const labels = {
        physics: 'Physics',
        biology: 'Biology',
        'computer-science': 'Computer Science / ML',
        neuroscience: 'Neuroscience',
        chemistry: 'Chemistry',
        generic: 'Generic structural view'
    };
    return labels[field] || 'Generic structural view';
}

function statusIcon(status) {
    if (status === 'complete') return 'OK';
    if (status === 'running') return '..';
    if (status === 'error') return '!!';
    return '--';
}

function showLoading(message) {
    setLoadingText(message);
    document.getElementById('loading-overlay').style.display = 'flex';
}

function setLoadingText(message) {
    document.getElementById('loading-text').textContent = message;
}

function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 4200);
}

function showUpgradeModal(message) {
    document.getElementById('upgrade-message').textContent = message || 'Upgrade required.';
    document.getElementById('upgrade-modal').style.display = 'flex';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function createManuscriptPayload(manuscript) {
    return {
        title: manuscript?.title || '',
        summary: manuscript?.summary || '',
        inferredField: manuscript?.inferredField || '',
        workingQuestion: manuscript?.workingQuestion || '',
        keyClaims: Array.isArray(manuscript?.keyClaims) ? manuscript.keyClaims.slice(0, 8) : [],
        sectionSignals: Array.isArray(manuscript?.sectionSignals) ? manuscript.sectionSignals.slice(0, 8) : []
    };
}

function createFingerprintPayload(fingerprint) {
    return {
        summary: fingerprint?.summary || '',
        signature: fingerprint?.signature || '',
        entities: Array.isArray(fingerprint?.entities) ? fingerprint.entities.slice(0, 12) : [],
        dynamics: Array.isArray(fingerprint?.dynamics) ? fingerprint.dynamics.slice(0, 12) : [],
        constraints: Array.isArray(fingerprint?.constraints) ? fingerprint.constraints.slice(0, 12) : [],
        sensitiveZones: Array.isArray(fingerprint?.sensitiveZones) ? fingerprint.sensitiveZones.slice(0, 12) : []
    };
}

function createCorrespondencesPayload(correspondences) {
    return (Array.isArray(correspondences) ? correspondences : []).map((correspondence) => ({
        id: correspondence.id,
        label: correspondence.label,
        analogDomain: correspondence.analogDomain,
        summary: correspondence.summary,
        reasoning: correspondence.reasoning,
        confidence: correspondence.confidence,
        sourceRole: correspondence.sourceRole,
        targetRole: correspondence.targetRole,
        mappingExplanation: correspondence.mappingExplanation,
        breakpoints: Array.isArray(correspondence.breakpoints) ? correspondence.breakpoints.slice(0, 6) : [],
        verification: correspondence.verification ? {
            status: correspondence.verification.status,
            rationale: correspondence.verification.rationale,
            evidence: Array.isArray(correspondence.verification.evidence) ? correspondence.verification.evidence.slice(0, 3) : []
        } : undefined,
        rendering: correspondence.rendering ? {
            summary: correspondence.rendering.summary,
            artifact: correspondence.rendering.artifact,
            notes: Array.isArray(correspondence.rendering.notes) ? correspondence.rendering.notes.slice(0, 6) : []
        } : undefined
    }));
}
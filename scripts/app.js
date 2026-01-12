// App State
const state = {
    domainPapers: {
        domain1: [],
        domain2: [],
        domain3: []
    },
    connections: [],
    hypotheses: [],
    user: null,
    subscription: null
};

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
    setupEventListeners();
    setupAuthListeners();
});

// Initialize application
async function initializeApp() {
    // Wait for Parse to be ready
    if (typeof Parse === 'undefined') {
        console.error('Parse SDK not available');
        showToast('Application loading error. Please refresh the page.', 'error');
        return;
    }
    
    // Validate session first - log out if expired (only if user was previously logged in)
    try {
        const currentUser = Parse.User.current();
        if (currentUser) {
            await authManager.validateSession();
        }
    } catch (error) {
        console.error('Session validation error:', error.message);
        // Continue even if validation fails - let the user try to log in
    }
    
    // Initialize Stripe
    try {
        await subscriptionManager.initialize();
    } catch (error) {
        console.error('Stripe initialization error:', error);
        showToast('Payment system unavailable: ' + error.message, 'error');
    }
    
    // Check if returning from successful payment
    const urlParams = new URLSearchParams(window.location.search);
    const paymentSuccess = urlParams.get('success');
    
    // Check if user is logged in
    if (authManager.isAuthenticated()) {
        state.user = authManager.getCurrentUser();
        
        // Always fetch fresh user data from server
        await state.user.fetch();
        
        // If returning from payment, clear the success parameter from URL
        if (paymentSuccess === 'true') {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        
        // All logged-in users can access the app (free tier or paid)
        showMainApp();
        updateUserMenu();
    } else {
        showAuthSection();
    }
}

// Show different sections
function showAuthSection() {
    document.getElementById('auth-section').style.display = 'block';
    document.getElementById('subscription-section').style.display = 'none';
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('notebooks-view').style.display = 'none';
}

function showSubscriptionRequired() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('subscription-section').style.display = 'block';
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('notebooks-view').style.display = 'none';
    updateUserMenu();
}

function showMainApp() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('subscription-section').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    document.getElementById('notebooks-view').style.display = 'none';
    updateUserMenu();
}

function showNotebooksView() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('subscription-section').style.display = 'none';
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('notebooks-view').style.display = 'block';
    loadNotebooksList();
}

// Update user menu
function updateUserMenu() {
    const user = authManager.getCurrentUser();
    if (!user) return;
    
    // Create user menu if it doesn't exist
    if (!document.getElementById('user-menu')) {
        const subscriptionStatus = user.get('subscriptionStatus');
        const isPremium = subscriptionStatus === 'active';
        
        const menu = document.createElement('div');
        menu.id = 'user-menu';
        menu.className = 'user-menu';
        menu.innerHTML = `
            <button class="user-button" id="user-menu-btn">
                <span id="user-name">${user.get('name') || user.get('email')}</span>
                <span>▼</span>
            </button>
            <div class="user-dropdown" id="user-dropdown">
                <div class="usage-indicator">
                    <div id="usage-text">Loading...</div>
                    <div class="usage-bar">
                        <div class="usage-bar-fill" id="usage-bar-fill"></div>
                    </div>
                </div>
                <div class="user-dropdown-item" id="view-notebooks">📚 My Notebooks</div>
                ${isPremium ? '<div class="user-dropdown-item" id="manage-subscription">Manage Subscription</div>' : ''}
                <div class="user-dropdown-item" id="logout-btn">Sign Out</div>
            </div>
        `;
        document.body.appendChild(menu);
        
        // Add event listeners
        document.getElementById('user-menu-btn').addEventListener('click', () => {
            document.getElementById('user-dropdown').classList.toggle('show');
        });
        
        document.getElementById('view-notebooks').addEventListener('click', () => {
            showNotebooksView();
        });
        
        // Only add manage subscription listener if element exists (premium users only)
        const manageSubBtn = document.getElementById('manage-subscription');
        if (manageSubBtn) {
            manageSubBtn.addEventListener('click', async () => {
                try {
                    showLoading('Opening subscription portal...');
                    await subscriptionManager.createPortalSession();
                } catch (error) {
                    hideLoading();
                    showToast('Failed to open portal: ' + error.message, 'error');
                }
            });
        }
        
        document.getElementById('logout-btn').addEventListener('click', async () => {
            await authManager.logOut();
            location.reload();
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#user-menu')) {
                document.getElementById('user-dropdown').classList.remove('show');
            }
        });
    }
    
    // Update usage stats
    updateUsageStats();
}

// Update usage statistics
async function updateUsageStats() {
    try {
        const user = Parse.User.current();
        if (!user) return;
        
        // Don't fetch user data - just use what's already available
        const subscriptionStatus = user.get('subscriptionStatus') || 'inactive';
        const usageTextEl = document.getElementById('usage-text');
        
        if (subscriptionStatus === 'active') {
            usageTextEl.textContent = '✨ Premium Member';
            document.getElementById('usage-bar-fill').style.width = '100%';
            document.getElementById('usage-bar-fill').style.background = 'linear-gradient(90deg, var(--secondary), var(--primary))';
        } else {
            // Free tier - show notebook count
            const notebookResult = await notebookManager.loadNotebooks();
            const notebookCount = notebookResult.success ? notebookResult.count : 0;
            const percentage = (notebookCount / 3) * 100;
            
            usageTextEl.textContent = `Free Tier: ${notebookCount} / 3 notebooks`;
            document.getElementById('usage-bar-fill').style.width = `${percentage}%`;
            document.getElementById('usage-bar-fill').style.background = 'var(--primary)';
        }
    } catch (error) {
        console.error('Error fetching usage stats:', error);
    }
}

// Setup auth event listeners
function setupAuthListeners() {
    // Login
    document.getElementById('login-btn').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        
        if (!email || !password) {
            showToast('Please fill in all fields', 'error');
            return;
        }
        
        showLoading('Signing in...');
        const result = await authManager.logIn(email, password);
        hideLoading();
        
        if (result.success) {
            state.user = result.user;
            showMainApp();
        } else {
            showToast(result.error, 'error');
        }
    });
    
    // Signup
    document.getElementById('signup-btn').addEventListener('click', async () => {
        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        
        if (!name || !email || !password) {
            showToast('Please fill in all fields', 'error');
            return;
        }
        
        if (password.length < 6) {
            showToast('Password must be at least 6 characters', 'error');
            return;
        }
        
        showLoading('Creating account...');
        const result = await authManager.signUp(email, password, name);
        hideLoading();
        
        if (result.success) {
            state.user = result.user;
            showMainApp();
            showToast('🎉 Welcome! You have 3 free notebooks to get started.', 'success');
        } else {
            showToast(result.error, 'error');
        }
    });
    
    // Subscribe
    document.getElementById('subscribe-btn').addEventListener('click', async () => {
        try {
            showLoading('Redirecting to checkout...');
            await subscriptionManager.createCheckoutSession();
        } catch (error) {
            hideLoading();
            showToast('Error: ' + error.message, 'error');
        }
    });
    
    // Toggle views
    document.getElementById('show-signup').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('signup-view').style.display = 'block';
    });
    
    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('signup-view').style.display = 'none';
        document.getElementById('login-view').style.display = 'block';
    });
    
    // Forgot password
    document.getElementById('forgot-password').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('forgot-password-modal').style.display = 'flex';
        document.getElementById('reset-email').value = '';
        document.getElementById('reset-email').focus();
    });
    
    // Send reset email
    document.getElementById('send-reset-btn').addEventListener('click', async () => {
        const email = document.getElementById('reset-email').value.trim();
        if (!email) {
            showToast('Please enter your email address', 'error');
            return;
        }
        
        document.getElementById('forgot-password-modal').style.display = 'none';
        showLoading('Sending reset email...');
        const result = await authManager.resetPassword(email);
        hideLoading();
        
        if (result.success) {
            showToast('Password reset email sent!', 'success');
        } else {
            showToast(result.error, 'error');
        }
    });
    
    // Cancel reset
    document.getElementById('cancel-reset-btn').addEventListener('click', () => {
        document.getElementById('forgot-password-modal').style.display = 'none';
    });
    
    // Close modal on outside click
    document.getElementById('forgot-password-modal').addEventListener('click', (e) => {
        if (e.target.id === 'forgot-password-modal') {
            document.getElementById('forgot-password-modal').style.display = 'none';
        }
    });
}

// Event Listeners
function setupEventListeners() {
    const discoverBtn = document.getElementById('discover-btn');
    const findAnalogiesBtn = document.getElementById('find-analogies-btn');
    const generateHypothesesBtn = document.getElementById('generate-hypotheses-btn');
    const extractPatternsBtn = document.getElementById('extract-patterns-btn');
    const newNotebookBtn = document.getElementById('new-notebook-btn');
    const backToAppBtn = document.getElementById('back-to-app-btn');
    const papersSlider = document.getElementById('papers-per-domain');
    
    if (discoverBtn) discoverBtn.addEventListener('click', discoverConnections);
    if (findAnalogiesBtn) findAnalogiesBtn.addEventListener('click', findDeepAnalogies);
    if (generateHypothesesBtn) generateHypothesesBtn.addEventListener('click', generateHypotheses);
    if (extractPatternsBtn) extractPatternsBtn.addEventListener('click', extractPatterns);
    if (newNotebookBtn) newNotebookBtn.addEventListener('click', startNewNotebook);
    if (backToAppBtn) backToAppBtn.addEventListener('click', showMainApp);
    
    // Update papers count display when slider changes
    if (papersSlider) {
        papersSlider.addEventListener('input', (e) => {
            document.getElementById('papers-count').textContent = e.target.value;
        });
    }
    
    // Add category change listeners to update placeholders
    document.querySelectorAll('.domain-category').forEach(select => {
        select.addEventListener('change', (e) => {
            const domainNum = e.target.getAttribute('data-domain');
            updatePlaceholder(parseInt(domainNum), e.target.value);
        });
    });
}

// Cross-Domain Discovery
async function discoverConnections() {
    const domains = [1, 2, 3];
    const searches = [];
    
    for (const domainNum of domains) {
        const category = document.querySelector(`.domain-category[data-domain="${domainNum}"]`).value;
        const query = document.querySelector(`.domain-query[data-domain="${domainNum}"]`).value.trim();
        
        if (category && query) {
            searches.push({ domainNum, category, query });
        }
    }
    
    if (searches.length < 2) {
        showToast('Please fill in at least 2 domains', 'error');
        return;
    }
    
    // Check if user can create a new notebook (free tier limit)
    const canCreate = await notebookManager.canCreateNotebook();
    if (!canCreate.allowed) {
        if (canCreate.reason === 'free_tier_limit') {
            showUpgradeModal(canCreate.message);
        } else {
            showToast(canCreate.message || 'Cannot create notebook', 'error');
        }
        return;
    }
    
    showLoading('Searching across domains...');
    
    try {
        const papersPerDomain = document.getElementById('papers-per-domain').value;
        
        // Initialize new notebook session
        const domainInfo = searches.map(s => ({
            area: s.category,
            query: s.query
        }));
        await notebookManager.startNewNotebook(domainInfo);
        
        // Search each domain
        for (const search of searches) {
            const papers = await searchArxiv(search.category, search.query, papersPerDomain);
            state.domainPapers[`domain${search.domainNum}`] = papers.map(p => ({
                ...p,
                domain: search.domainNum,
                domainName: search.category,
                searchQuery: search.query
            }));
        }
        
        displayPapersByDomain();
        hideLoading();
        showToast('Papers loaded! Now discovering connections...', 'success');
        
        // Show action buttons and update stats
        document.getElementById('action-section').style.display = 'block';
        updateStats();
        
        // Auto-save notebook with paper data immediately after papers are loaded
        console.log('Auto-saving notebook with paper data...');
        // Force save even if no connections yet - we need to save the paper data
        const result = await notebookManager.saveNotebook();
        if (result.success) {
            console.log('Paper data saved successfully:', result.message);
        } else {
            console.error('Failed to save paper data:', result.error);
        }
        
        // Auto-start finding analogies
        setTimeout(() => findDeepAnalogies(), 1000);
        
    } catch (error) {
        hideLoading();
        showToast('Error: ' + error.message, 'error');
        console.error(error);
    }
}

// Search arXiv with fallback approaches
async function searchArxiv(category, query, maxResults) {
    // First try the Cloud Function approach
    try {
        const result = await Parse.Cloud.run('searchArxiv', {
            category: category,
            query: query,
            maxResults: maxResults
        });
        
        if (result && result.success && result.data) {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(result.data, 'text/xml');
            const entries = xmlDoc.querySelectorAll('entry');
            
            if (entries.length > 0) {
                return Array.from(entries).map(entry => ({
                    id: entry.querySelector('id').textContent,
                    title: entry.querySelector('title').textContent.trim(),
                    authors: Array.from(entry.querySelectorAll('author name')).map(a => a.textContent),
                    abstract: entry.querySelector('summary').textContent.trim(),
                    published: entry.querySelector('published').textContent,
                    link: entry.querySelector('id').textContent
                }));
            }
        } else if (result && result.error) {
            console.warn('Cloud Function returned error:', result.error);
        }
    } catch (error) {
        console.warn('Cloud Function approach failed:', error.message);
    }
    
    // Fallback: try direct fetch (might work in some browsers/environments)
    try {
        console.log('Trying direct ArXiv access...');
        const searchQuery = `cat:${category} AND all:${query}`;
        const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;
        
        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            headers: {
                'Accept': 'application/atom+xml',
            }
        });
        
        if (response.ok) {
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
            const entries = xmlDoc.querySelectorAll('entry');
            
            return Array.from(entries).map(entry => ({
                id: entry.querySelector('id').textContent,
                title: entry.querySelector('title').textContent.trim(),
                authors: Array.from(entry.querySelectorAll('author name')).map(a => a.textContent),
                abstract: entry.querySelector('summary').textContent.trim(),
                published: entry.querySelector('published').textContent,
                link: entry.querySelector('id').textContent
            }));
        }
    } catch (error) {
        console.warn('Direct fetch failed:', error.message);
    }
    
    // Final fallback: return mock data for demonstration
    console.warn('Using mock data for ArXiv search');
    showToast('⚠️ Using demo data - ArXiv temporarily unavailable', 'warning');
    return generateMockPapers(category, query, maxResults);
}

// Generate mock papers as fallback when ArXiv is not accessible
function generateMockPapers(category, query, maxResults) {
    const mockPapers = [];
    const categoryMap = {
        'cs.AI': 'Artificial Intelligence',
        'cs.LG': 'Machine Learning',
        'cs.CV': 'Computer Vision',
        'cs.CL': 'Natural Language Processing',
        'cs.RO': 'Robotics',
        'physics.bio-ph': 'Biological Physics',
        'q-bio.NC': 'Neuroscience',
        'math.DS': 'Dynamical Systems'
    };
    
    const domainName = categoryMap[category] || category;
    
    for (let i = 0; i < Math.min(maxResults, 8); i++) {
        mockPapers.push({
            id: `https://arxiv.org/abs/2024.${String(i + 1).padStart(4, '0')}`,
            title: `${domainName} Research on ${query}: A Comprehensive Study ${i + 1}`,
            authors: [
                `Dr. Alex Smith${i}`,
                `Prof. Maria Johnson${i}`,
                `Dr. Robert Chen${i}`
            ],
            abstract: `This paper presents novel approaches in ${domainName.toLowerCase()} with specific focus on ${query}. Our methodology combines theoretical frameworks with empirical validation to demonstrate significant improvements over existing methods. The research contributes to understanding the fundamental principles underlying ${query} in the context of ${domainName.toLowerCase()}. Key findings include enhanced performance metrics and novel theoretical insights that advance the field.`,
            published: `2024-11-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}T10:30:00Z`,
            link: `https://arxiv.org/abs/2024.${String(i + 1).padStart(4, '0')}`
        });
    }
    
    return mockPapers;
}

// Display Papers by Domain
function displayPapersByDomain() {
    console.log('displayPapersByDomain called with state.domainPapers:', state.domainPapers);
    const container = document.getElementById('papers-by-domain');
    if (!container) {
        console.error('papers-by-domain container not found!');
        return;
    }
    container.innerHTML = '';
    
    for (const [key, papers] of Object.entries(state.domainPapers)) {
        if (papers.length === 0) continue;
        
        const section = document.createElement('div');
        section.className = 'domain-papers-section';
        
        const domainInfo = papers[0];
        section.innerHTML = `
            <h3>Domain ${domainInfo.domain}: ${domainInfo.domainName} - "${domainInfo.searchQuery}"</h3>
            <div class="domain-papers-list" id="papers-${key}"></div>
        `;
        
        container.appendChild(section);
        
        const papersList = document.getElementById(`papers-${key}`);
        papers.forEach(paper => {
            const card = document.createElement('div');
            card.className = 'mini-paper-card';
            card.innerHTML = `
                <div class="paper-title">
                    <a href="${paper.link}" target="_blank" rel="noopener noreferrer" class="paper-link">
                        ${escapeHtml(paper.title)}
                    </a>
                </div>
                <div class="paper-authors">${paper.authors.slice(0, 2).join(', ')}${paper.authors.length > 2 ? ' et al.' : ''}</div>
            `;
            papersList.appendChild(card);
        });
    }
    
    document.getElementById('results-section').style.display = 'block';
}

// Find Deep Analogies
async function findDeepAnalogies() {
    // Check if user can generate more (free tier limit)
    const canGenerate = await notebookManager.canGenerateMore('analogies');
    if (!canGenerate.allowed) {
        if (canGenerate.reason === 'free_tier_limit') {
            showUpgradeModal(canGenerate.message);
        } else {
            showToast(canGenerate.message || 'Cannot generate analogies', 'error');
        }
        return;
    }
    
    showLoading('Discovering deep analogical connections with AI...');
    
    try {
        const activeDomains = Object.values(state.domainPapers).filter(d => d.length > 0);
        
        if (activeDomains.length < 2) {
            showToast('Need at least 2 domains', 'error');
            hideLoading();
            return;
        }
        
        // Prepare domain summaries
        const domainSummaries = activeDomains.map((papers, idx) => {
            const sample = papers.slice(0, 5);
            return {
                domain: papers[0].domain,
                name: papers[0].domainName,
                query: papers[0].searchQuery,
                papers: sample.map(p => ({
                    title: p.title,
                    abstract: p.abstract.substring(0, 500)
                }))
            };
        });
        
        // Add context about existing connections to find NEW ones
        const existingConnectionsContext = state.connections.length > 0 
            ? `\n\nIMPORTANT: You have already found these connections:\n${state.connections.map(c => `- ${c.mechanism}`).join('\n')}\n\nFind DIFFERENT analogies that explore other aspects, mechanisms, or perspectives. Do not repeat these.`
            : '';
        
        const prompt = `You are an expert at discovering deep analogical connections across scientific domains. Analyze these research domains and find surprising, non-obvious analogies.${existingConnectionsContext}

${domainSummaries.map((d, i) => `
DOMAIN ${d.domain}: ${d.name} (Topic: "${d.query}")
Papers:
${d.papers.map((p, j) => `${j + 1}. "${p.title}"\n   Abstract: ${p.abstract}`).join('\n\n')}
`).join('\n\n')}

Find 3-5 DEEP analogical connections where:
1. The same underlying mechanism, principle, or pattern appears in different domains
2. The connection is NOT obvious (avoid surface-level keyword matches)
3. The analogy reveals structural or functional similarities
4. The insight could lead to novel research directions

For each connection, provide:
- Strength score (0-100) based on how deep and surprising the analogy is
- Type of analogy (e.g., "Structural", "Functional", "Mechanistic", "Dynamical")
- The domains involved
- The core mechanism/principle that's analogous
- Detailed explanation of WHY this connection matters
- Specific evidence from the papers
- Potential scientific implications

Return JSON:
{
  "connections": [
    {
      "strength": 95,
      "type": "Mechanistic",
      "domains": [1, 2],
      "mechanism": "Brief name of the shared mechanism",
      "explanation": "Detailed explanation of the analogy",
      "domain1_manifestation": "How it appears in domain 1",
      "domain2_manifestation": "How it appears in domain 2",
      "why_it_matters": "Scientific significance",
      "evidence": ["Evidence point 1", "Evidence point 2"],
      "implications": "Potential research directions"
    }
  ]
}`;
        
        const response = await callOpenAI([
            { role: 'system', content: 'You are a world-class research scientist specializing in cross-domain analogical reasoning and scientific discovery. You excel at finding deep structural similarities that others miss.' },
            { role: 'user', content: prompt }
        ], 0.8);
        
        const result = parseJSONResponse(response);
        
        // Append new connections instead of replacing
        const newConnections = result.connections.filter(newConn => 
            !state.connections.some(existing => existing.mechanism === newConn.mechanism)
        );
        
        if (newConnections.length === 0) {
            hideLoading();
            showToast('No new analogies found. Try searching different domains.', 'info');
            return;
        }
        
        state.connections = [...state.connections, ...newConnections];
        
        // Track in notebook
        console.log('Adding analogies to notebook:', newConnections.length);
        notebookManager.addAnalogies(newConnections);
        console.log('Current notebook state:', notebookManager.getCurrentNotebook());
        
        // Auto-save the notebook
        await autoSaveNotebook();
        
        displayConnections();
        updateStats();
        hideLoading();
        showToast(`Found ${newConnections.length} new analogies!`, 'success');
        
        // Scroll to connections section
        document.getElementById('discovery-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
        
    } catch (error) {
        hideLoading();
        showToast('Error finding analogies: ' + error.message, 'error');
        console.error(error);
    }
}

// Display Connections
function displayConnections() {
    const container = document.getElementById('connections-container');
    container.innerHTML = '';
    
    if (state.connections.length === 0) {
        container.innerHTML = '<p>No connections found</p>';
        return;
    }
    
    state.connections.forEach((conn, idx) => {
        const card = document.createElement('div');
        card.className = 'connection-card';
        
        const domainBadges = conn.domains.map(d => {
            const papers = state.domainPapers[`domain${d}`];
            if (papers && papers.length > 0) {
                return `<div class="domain-badge">Domain ${d}: ${papers[0].domainName}</div>`;
            }
            return '';
        }).join('');
        
        card.innerHTML = `
            <div class="connection-header">
                <div class="connection-left">
                    <div class="connection-strength">${conn.strength}%</div>
                    <div class="connection-type tooltip" data-tooltip="${getAnalogyTooltip(conn.type)}">${conn.type} Analogy</div>
                </div>
                <div class="chord-icon" onclick="showChordDiagram(${idx})" title="View Connection Diagram">🎯</div>
            </div>
            
            <div class="connection-domains">
                ${domainBadges}
            </div>
            
            <div class="analogy-explanation">
                <h4>🔗 Core Mechanism: ${escapeHtml(conn.mechanism)}</h4>
                <p>${escapeHtml(conn.explanation)}</p>
            </div>
            
            <div class="mechanism-comparison">
                <div class="mechanism-box">
                    <h5>In Domain ${conn.domains[0]} ${getPaperLink(conn.domains[0])}</h5>
                    <p>${escapeHtml(conn.domain1_manifestation)}</p>
                </div>
                <div class="arrow">⟷</div>
                <div class="mechanism-box">
                    <h5>In Domain ${conn.domains[1]} ${getPaperLink(conn.domains[1])}</h5>
                    <p>${escapeHtml(conn.domain2_manifestation || conn.domain3_manifestation || 'N/A')}</p>
                </div>
            </div>
            
            <div class="analogy-explanation">
                <h4>💡 Why This Matters</h4>
                <p>${escapeHtml(conn.why_it_matters)}</p>
            </div>
            
            <div class="evidence-section">
                <h4>📋 Supporting Evidence</h4>
                <div class="evidence-list">
                    ${conn.evidence.map(e => `<div class="evidence-item">${escapeHtml(e)}</div>`).join('')}
                </div>
            </div>
            
            <div class="analogy-explanation" style="background: rgba(16, 185, 129, 0.1); border-left: 4px solid var(--secondary);">
                <h4>🚀 Research Implications</h4>
                <p>${escapeHtml(conn.implications)}</p>
            </div>
        `;
        
        container.appendChild(card);
    });
    
    document.getElementById('discovery-section').style.display = 'block';
}

// Get tooltip text for analogy types
function getAnalogyTooltip(type) {
    const tooltips = {
        'Structural': 'Similar organizational patterns, hierarchies, or architectural arrangements (e.g., neural network layers ↔ corporate management hierarchy)',
        'Functional': 'Same roles or purposes achieved through different mechanisms (e.g., bird wings ↔ airplane wings both enable flight)',
        'Causal': 'Similar cause-and-effect chains or mechanisms (e.g., viral spread in networks ↔ information propagation in social media)',
        'Surface': 'Superficial similarities in appearance or terminology without deeper structural alignment (often misleading)',
        'Systematic': 'Comprehensive mapping of multiple relationships and rules (e.g., atomic structure ↔ solar system dynamics)',
        'Pragmatic': 'Similar practical problem-solving approaches or utilities (e.g., ant colony optimization ↔ traffic routing algorithms)',
        'Relational': 'Similar relationships or proportions between elements (e.g., predator-prey ratios ↔ market competition dynamics)',
        'Transformational': 'Similar change or development processes (e.g., biological evolution ↔ technological innovation cycles)',
        'Mechanistic': 'Similar underlying mechanisms or operational principles (e.g., enzyme catalysis ↔ industrial catalytic processes)',
        'Dynamical': 'Similar temporal behaviors, oscillations, or dynamic patterns (e.g., pendulum motion ↔ market cycles)',
        'Mathematical': 'Shared mathematical models or equations (e.g., exponential growth in populations ↔ compound interest)',
        'Behavioral': 'Similar behavioral patterns or responses (e.g., flocking behavior ↔ crowd dynamics)',
        'Geometric': 'Similar spatial arrangements or geometric properties (e.g., honeycomb structure ↔ optimal packing solutions)',
        'Energetic': 'Similar energy flows, conservation principles, or thermodynamic properties (e.g., metabolic pathways ↔ economic resource flows)'
    };
    return tooltips[type] || `${type} analogy - comparing similar patterns or principles across different domains`;
}

// Get clickable paper link for a domain
function getPaperLink(domainNum) {
    const papers = state.domainPapers[`domain${domainNum}`];
    if (!papers || papers.length === 0) return '';
    
    // Get the first paper as the representative paper for this connection
    const paper = papers[0];
    const arxivId = paper.id.split('/').pop(); // Extract arXiv ID
    const url = `https://arxiv.org/abs/${arxivId}`;
    
    return `<a href="${url}" target="_blank" class="paper-link" title="${escapeHtml(paper.title)}">📄</a>`;
}

// Show chord diagram modal
function showChordDiagram(connectionIndex) {
    console.log('showChordDiagram called with index:', connectionIndex);
    
    // Get connection data
    const connection = state.connections[connectionIndex];
    if (!connection) {
        console.error('No connection found at index:', connectionIndex);
        console.log('Available connections:', state.connections);
        alert('No connection found at index: ' + connectionIndex);
        return;
    }
    
    console.log('Connection data:', connection);
    console.log('Current state.domainPapers:', state.domainPapers);
    
    // Show modal
    document.getElementById('chord-modal').style.display = 'flex';
    
    // Generate chord diagram
    createChordDiagram(connection, connectionIndex);
}

// Close chord diagram modal
function closeChordModal() {
    document.getElementById('chord-modal').style.display = 'none';
    // Clear previous diagram and legend
    d3.select('#chord-diagram').selectAll('*').remove();
    d3.select('#domain-legend').selectAll('*').remove();
    // Clean up tooltip
    if (window.chordTooltip) {
        window.chordTooltip.remove();
        window.chordTooltip = null;
    }
}

// Create D3.js chord diagram
function createChordDiagram(connection, connectionIndex) {
    // Clear previous diagram and legend
    d3.select('#chord-diagram').selectAll('*').remove();
    d3.select('#domain-legend').selectAll('*').remove();
    
    // Get papers from the relevant domains
    console.log('Looking for domains:', connection.domains);
    console.log('Available domainPapers keys:', Object.keys(state.domainPapers));
    
    let domain1Papers = state.domainPapers[`domain${connection.domains[0]}`] || [];
    let domain2Papers = state.domainPapers[`domain${connection.domains[1]}`] || [];
    
    // Fallback: try to get papers from displayed DOM elements if state is empty
    if (domain1Papers.length === 0 && domain2Papers.length === 0) {
        console.log('No papers in state, trying to get from DOM...');
        
        // Try to extract papers from the displayed papers section
        const fallbackPapers = [];
        
        // Debug: Check what containers exist
        console.log('Looking for paper containers...');
        const allContainers = document.querySelectorAll('[id*="papers"]');
        console.log('Found containers:', Array.from(allContainers).map(el => el.id));
        
        // Get papers from each domain section - use the correct ID format
        for (let domainNum = 1; domainNum <= 3; domainNum++) {
            const domainKey = `domain${domainNum}`;
            const containerId = `papers-${domainKey}`;  // This matches papers-${key} from displayPapersByDomain
            
            const domainContainer = document.getElementById(containerId);
            console.log(`Looking for container: ${containerId}, found:`, !!domainContainer);
            
            if (domainContainer) {
                const paperElements = domainContainer.querySelectorAll('.mini-paper-card');
                console.log(`Domain ${domainNum} has ${paperElements.length} paper cards`);
                
                Array.from(paperElements).forEach(el => {
                    const titleLinkEl = el.querySelector('.paper-title a');
                    if (titleLinkEl) {
                        const href = titleLinkEl.href;
                        const arxivId = href ? href.split('/').pop() : 'unknown';
                        console.log(`Found paper: ${titleLinkEl.textContent.trim()}`);
                        fallbackPapers.push({
                            title: titleLinkEl.textContent.trim(),
                            id: arxivId,
                            link: href,
                            domain: domainNum,
                            domainName: `Domain ${domainNum}`
                        });
                    }
                });
            } else {
                console.log(`No container found for domain ${domainNum}`);
            }
        }
        
        console.log('Found fallback papers:', fallbackPapers);
        
        // If still no papers found after DOM extraction, show error
        if (fallbackPapers.length === 0) {
            console.error('No papers found for chord diagram. This notebook may have incomplete data.');
            document.getElementById('chord-diagram').innerHTML = 
                '<div style="padding: 40px; text-align: center; color: #666;">' +
                '<h3>No Papers Available</h3>' +
                '<p>This notebook appears to have incomplete paper data.</p>' +
                '<p>Try running a fresh discovery session to generate a new chord diagram.</p>' +
                '</div>';
            return;
        }
        
        // Separate by domain
        domain1Papers = fallbackPapers.filter(p => p.domain === connection.domains[0]);
        domain2Papers = fallbackPapers.filter(p => p.domain === connection.domains[1]);
    }
    
    console.log('Domain1Papers:', domain1Papers.length, 'Domain2Papers:', domain2Papers.length);
    
    // Limit to first 3 papers from each domain for simplicity
    const papers = [
        ...domain1Papers.slice(0, 3),
        ...domain2Papers.slice(0, 3)
    ];
    
    console.log('Total papers for diagram:', papers.length);
    
    if (papers.length === 0) {
        const svg = d3.select('#chord-diagram').attr('width', 400).attr('height', 200);
        svg.append('text')
            .attr('x', 200)
            .attr('y', 100)
            .attr('text-anchor', 'middle')
            .style('font-size', '16px')
            .style('fill', '#666')
            .text('No papers available for visualization');
        return;
    }
    
    // Create domain legend
    const domains = [...new Set(papers.map(p => p.domain))];
    const domainNames = domains.map(d => {
        const firstPaper = papers.find(p => p.domain === d);
        return firstPaper ? firstPaper.domainName || `Domain ${d}` : `Domain ${d}`;
    });
    
    const color = d3.scaleOrdinal()
        .domain([1, 2, 3])
        .range(['#2563eb', '#10b981', '#f59e0b']);
    
    // Create legend
    const legend = d3.select('#domain-legend');
    domains.forEach((domain, i) => {
        const legendItem = legend.append('div')
            .attr('class', 'legend-item');
        
        legendItem.append('div')
            .attr('class', 'legend-color')
            .style('background-color', color(domain));
        
        legendItem.append('span')
            .text(`${domainNames[i]}`);
    });
    
    // Create connection matrix (papers x papers)
    const n = papers.length;
    const matrix = Array(n).fill().map(() => Array(n).fill(0));
    
    // Fill matrix with connection strengths
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i !== j) {
                const paper1Domain = papers[i].domain;
                const paper2Domain = papers[j].domain;
                
                if (paper1Domain === paper2Domain) {
                    // Same domain - weaker connection
                    matrix[i][j] = Math.random() * 30 + 10; // 10-40
                } else {
                    // Different domains - stronger connection (based on analogy strength)
                    matrix[i][j] = (connection.strength / 100) * 80 + 20; // 20-100
                }
            }
        }
    }
    
    // Responsive sizing based on viewport
    const containerWidth = Math.min(window.innerWidth * 0.8, 600);
    const containerHeight = Math.min(window.innerHeight * 0.6, 500);
    const size = Math.min(containerWidth, containerHeight, 400);
    
    const width = size;
    const height = size;
    const outerRadius = Math.min(width, height) * 0.35;
    const innerRadius = outerRadius - 25;
    
    const svg = d3.select('#chord-diagram')
        .attr('width', width)
        .attr('height', height);
    
    const g = svg.append('g')
        .attr('transform', `translate(${width / 2}, ${height / 2})`);
    
    // Create tooltip div
    const tooltip = d3.select('body').append('div')
        .attr('class', 'chord-tooltip')
        .style('opacity', 0);
    
    // Generate chord layout
    const chord = d3.chord()
        .padAngle(0.05)
        .sortSubgroups(d3.descending);
    
    const arc = d3.arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius);
    
    const ribbon = d3.ribbon()
        .radius(innerRadius);
    
    const chords = chord(matrix);
    
    // Draw groups (paper arcs)
    const group = g.selectAll('.chord-group')
        .data(chords.groups)
        .enter().append('g')
        .attr('class', 'chord-group');
    
    group.append('path')
        .style('fill', d => color(papers[d.index].domain))
        .style('stroke', d => d3.rgb(color(papers[d.index].domain)).darker())
        .attr('d', arc)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
            const paper = papers[d.index];
            tooltip.transition().duration(200).style('opacity', .9);
            tooltip.html(`<strong>${paper.title}</strong><br/>Domain: ${paper.domainName}<br/>Click to open paper`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            tooltip.transition().duration(500).style('opacity', 0);
        })
        .on('click', function(event, d) {
            const paper = papers[d.index];
            const arxivId = paper.id.split('/').pop();
            window.open(`https://arxiv.org/abs/${arxivId}`, '_blank');
        });
    
    // Add shortened labels (since we have tooltips for full titles)
    group.append('text')
        .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
        .attr('dy', '.35em')
        .attr('transform', d => `
            rotate(${(d.angle * 180 / Math.PI - 90)})
            translate(${outerRadius + 8})
            ${d.angle > Math.PI ? 'rotate(180)' : ''}
        `)
        .style('text-anchor', d => d.angle > Math.PI ? 'end' : null)
        .style('font-size', '8px')
        .style('font-weight', 'bold')
        .style('fill', '#666')
        .text(d => {
            const paper = papers[d.index];
            return `P${d.index + 1}`;
        });
    
    // Draw ribbons (connections)
    g.selectAll('.chord')
        .data(chords)
        .enter().append('path')
        .attr('class', 'chord')
        .attr('d', ribbon)
        .style('fill', d => color(papers[d.source.index].domain))
        .style('opacity', 0.67)
        .on('mouseover', function(event, d) {
            const sourcePaper = papers[d.source.index];
            const targetPaper = papers[d.target.index];
            const strength = Math.round(matrix[d.source.index][d.target.index]);
            
            d3.select(this).style('opacity', 0.9);
            tooltip.transition().duration(200).style('opacity', .9);
            tooltip.html(`<strong>Connection Strength: ${strength}%</strong><br/>
                         <em>${sourcePaper.title}</em><br/>
                         ↔<br/>
                         <em>${targetPaper.title}</em>`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(this).style('opacity', 0.67);
            tooltip.transition().duration(500).style('opacity', 0);
        });
    
    // Clean up tooltip when modal is closed
    window.chordTooltip = tooltip;
}

// Make functions available globally for inline onclick handlers
window.showChordDiagram = showChordDiagram;
window.closeChordModal = closeChordModal;

// Generate Hypotheses
async function generateHypotheses() {
    if (state.connections.length === 0) {
        showToast('Find analogies first', 'error');
        return;
    }
    
    // Check if user can generate more (free tier limit)
    const canGenerate = await notebookManager.canGenerateMore('hypotheses');
    if (!canGenerate.allowed) {
        if (canGenerate.reason === 'free_tier_limit') {
            showUpgradeModal(canGenerate.message);
        } else {
            showToast(canGenerate.message || 'Cannot generate hypotheses', 'error');
        }
        return;
    }
    
    showLoading('Generating research hypotheses...');
    
    try {
        const connectionsText = state.connections.map((c, i) => `
Connection ${i + 1}: ${c.mechanism}
- Type: ${c.type}
- Strength: ${c.strength}%
- Explanation: ${c.explanation}
- Implications: ${c.implications}
`).join('\n');
        
        const prompt = `Based on these cross-domain analogical connections, generate 3-5 novel, testable research hypotheses.

${connectionsText}

Each hypothesis should:
1. Be specific and testable
2. Leverage insights from the cross-domain connections
3. Suggest a concrete research direction
4. Have clear scientific value
5. Include testable predictions

Return JSON:
{
  "hypotheses": [
    {
      "title": "Brief hypothesis title",
      "statement": "Full hypothesis statement",
      "rationale": "Why this hypothesis follows from the connections",
      "novelty": "What makes this hypothesis novel",
      "testable_predictions": ["Prediction 1", "Prediction 2", "Prediction 3"],
      "methodology": "Suggested experimental or computational approach",
      "impact": "Potential scientific impact if validated"
    }
  ]
}`;
        
        const response = await callOpenAI([
            { role: 'system', content: 'You are a visionary research scientist who generates bold, testable hypotheses based on cross-domain insights.' },
            { role: 'user', content: prompt }
        ], 0.9);
        
        const result = parseJSONResponse(response);
        
        // Append new hypotheses instead of replacing
        const newHypotheses = result.hypotheses.filter(newHyp => 
            !state.hypotheses.some(existing => existing.title === newHyp.title)
        );
        
        if (newHypotheses.length === 0) {
            hideLoading();
            showToast('No new hypotheses generated. Try finding more analogies first.', 'info');
            return;
        }
        
        state.hypotheses = [...state.hypotheses, ...newHypotheses];
        
        // Track in notebook
        notebookManager.addHypotheses(newHypotheses);
        
        // Auto-save the notebook
        await autoSaveNotebook();
        
        displayHypotheses();
        updateStats();
        hideLoading();
        showToast(`Generated ${newHypotheses.length} new hypotheses!`, 'success');
        
        // Scroll to hypotheses section
        document.getElementById('hypotheses-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
        
    } catch (error) {
        hideLoading();
        showToast('Error generating hypotheses: ' + error.message, 'error');
        console.error(error);
    }
}

// Display Hypotheses
function displayHypotheses() {
    const container = document.getElementById('hypotheses-container');
    container.innerHTML = '';
    
    if (state.hypotheses.length === 0) {
        container.innerHTML = '<p>No hypotheses generated</p>';
        return;
    }
    
    state.hypotheses.forEach((hyp, idx) => {
        const card = document.createElement('div');
        card.className = 'hypothesis-card';
        
        card.innerHTML = `
            <div class="hypothesis-header">
                <div class="hypothesis-number">${idx + 1}</div>
                <div class="hypothesis-title">${escapeHtml(hyp.title)}</div>
            </div>
            
            <div class="hypothesis-content">
                <strong>Hypothesis:</strong> ${escapeHtml(hyp.statement)}
            </div>
            
            <div class="hypothesis-rationale">
                <h4>🧠 Rationale</h4>
                <p>${escapeHtml(hyp.rationale)}</p>
            </div>
            
            <div class="hypothesis-content">
                <strong>💎 Novelty:</strong> ${escapeHtml(hyp.novelty)}
            </div>
            
            <div class="testable-predictions">
                <h4>🔬 Testable Predictions</h4>
                <ul class="predictions-list">
                    ${hyp.testable_predictions.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
                </ul>
            </div>
            
            <div class="hypothesis-content">
                <strong>🛠️ Suggested Methodology:</strong> ${escapeHtml(hyp.methodology)}
            </div>
            
            <div class="hypothesis-content" style="background: rgba(16, 185, 129, 0.1); border-left: 4px solid var(--secondary);">
                <strong>🌟 Potential Impact:</strong> ${escapeHtml(hyp.impact)}
            </div>
        `;
        
        container.appendChild(card);
    });
    
    document.getElementById('hypotheses-section').style.display = 'block';
}

// Extract Patterns
async function extractPatterns() {
    if (state.connections.length === 0) {
        showToast('Find analogies first', 'error');
        return;
    }
    
    // Check if user can generate more (free tier limit)
    const canGenerate = await notebookManager.canGenerateMore('patterns');
    if (!canGenerate.allowed) {
        if (canGenerate.reason === 'free_tier_limit') {
            showUpgradeModal(canGenerate.message);
        } else {
            showToast(canGenerate.message || 'Cannot extract patterns', 'error');
        }
        return;
    }
    
    showLoading('Extracting cross-domain patterns...');
    
    try {
        const connectionsText = state.connections.map(c => `
- ${c.mechanism}: ${c.explanation}
`).join('\n');
        
        const prompt = `Identify recurring patterns, principles, or mechanisms that appear across these connections:

${connectionsText}

Extract 3-5 fundamental patterns that transcend specific domains. These could be:
- Mathematical structures (e.g., power laws, phase transitions)
- Information processing principles (e.g., feedback loops, hierarchical organization)
- Optimization strategies (e.g., gradient descent, evolutionary algorithms)
- Dynamical patterns (e.g., oscillations, synchronization)

Return JSON:
{
  "patterns": [
    {
      "name": "Pattern name",
      "description": "What the pattern is",
      "universality": "Why it appears across domains",
      "instances": [
        {"domain": "Domain name", "manifestation": "How it appears"}
      ],
      "mathematical_form": "Mathematical description if applicable",
      "implications": "What this universality tells us"
    }
  ]
}`;
        
        const response = await callOpenAI([
            { role: 'system', content: 'You are an expert at identifying universal patterns and principles in science.' },
            { role: 'user', content: prompt }
        ], 0.7);
        
        const result = parseJSONResponse(response);
        
        // Track in notebook
        notebookManager.addPatterns(result.patterns);
        
        // Auto-save the notebook
        await autoSaveNotebook();
        
        displayPatterns(result.patterns);
        updateStats();
        hideLoading();
        showToast('Patterns extracted!', 'success');
        
    } catch (error) {
        hideLoading();
        showToast('Error extracting patterns: ' + error.message, 'error');
        console.error(error);
    }
}

// Display Patterns
function displayPatterns(patterns) {
    const container = document.getElementById('patterns-container');
    container.innerHTML = '';
    
    if (patterns.length === 0) {
        container.innerHTML = '<p>No patterns found</p>';
        return;
    }
    
    patterns.forEach(pattern => {
        const card = document.createElement('div');
        card.className = 'pattern-card';
        
        card.innerHTML = `
            <div class="pattern-name">${escapeHtml(pattern.name)}</div>
            <p><strong>Description:</strong> ${escapeHtml(pattern.description)}</p>
            <p><strong>Why Universal:</strong> ${escapeHtml(pattern.universality)}</p>
            ${pattern.mathematical_form ? `<p><strong>Mathematical Form:</strong> ${escapeHtml(pattern.mathematical_form)}</p>` : ''}
            <div class="pattern-instances">
                <strong>Instances Across Domains:</strong>
                ${pattern.instances.map(inst => `
                    <div class="pattern-instance">
                        <strong>${escapeHtml(inst.domain)}:</strong> ${escapeHtml(inst.manifestation)}
                    </div>
                `).join('')}
            </div>
            <p style="margin-top: 12px;"><strong>Implications:</strong> ${escapeHtml(pattern.implications)}</p>
        `;
        
        container.appendChild(card);
    });
    
    document.getElementById('patterns-section').style.display = 'block';
    
    // Scroll to patterns section
    document.getElementById('patterns-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// OpenAI API Call via Back4App Cloud Function
async function callOpenAI(messages, temperature = 0.7) {
    // Check authentication
    if (!authManager.isAuthenticated()) {
        throw new Error('Must be logged in');
    }
    
    try {
        // Call Back4App Cloud Function (which proxies to OpenAI with your API key)
        const result = await Parse.Cloud.run('callOpenAI', {
            messages: messages,
            temperature: temperature
        });
        
        // Update usage stats in UI
        updateUsageStats();
        
        return result.content;
    } catch (error) {
        throw new Error(error.message || 'AI request failed');
    }
}

// Parse JSON Response (handles markdown wrapping)
function parseJSONResponse(response) {
    // Remove markdown code blocks if present
    let cleaned = response.trim();
    
    // Remove ```json and ``` wrappers
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
        cleaned = cleaned.replace(/\n?```\s*$/, '');
    }
    
    return JSON.parse(cleaned.trim());
}

// Update Stats
function updateStats() {
    document.getElementById('connections-count').textContent = state.connections.length;
    document.getElementById('hypotheses-count').textContent = state.hypotheses.length;
    
    // Count patterns from state
    const patternsCount = document.querySelectorAll('#patterns-container .pattern-card').length;
    document.getElementById('patterns-count').textContent = patternsCount;
    
    // Update button text based on state
    const analogiesBtn = document.getElementById('find-analogies-btn');
    const hypothesesBtn = document.getElementById('generate-hypotheses-btn');
    const patternsBtn = document.getElementById('extract-patterns-btn');
    
    if (state.connections.length === 0) {
        analogiesBtn.textContent = '🔗 Find Deep Analogies';
    } else {
        analogiesBtn.textContent = '🔗 Find More Analogies';
    }
    
    if (state.hypotheses.length === 0) {
        hypothesesBtn.textContent = '💭 Generate Hypotheses';
    } else {
        hypothesesBtn.textContent = '💭 Generate More Hypotheses';
    }
    
    // Check if patterns have been extracted
    const patternsSection = document.getElementById('patterns-section');
    if (patternsSection.style.display === 'block') {
        patternsBtn.textContent = '🧩 Extract More Patterns';
    } else {
        patternsBtn.textContent = '🧩 Extract Patterns';
    }
}

// UI Utilities
function showLoading(text = 'Loading...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-overlay').style.display = 'flex';
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
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show upgrade modal for free tier limits
function showUpgradeModal(message) {
    const modal = document.getElementById('upgrade-modal');
    const messageEl = document.getElementById('upgrade-message');
    
    if (message) {
        messageEl.textContent = message;
    }
    
    modal.style.display = 'flex';
    
    // Set up event listeners if not already set
    if (!modal.dataset.listenersSet) {
        document.getElementById('upgrade-now-btn').addEventListener('click', async () => {
            modal.style.display = 'none';
            try {
                showLoading('Opening checkout...');
                await subscriptionManager.createCheckoutSession();
                // Hide loading after opening new tab
                hideLoading();
                showToast('Checkout opened in new tab. Complete payment there to upgrade.', 'info');
            } catch (error) {
                hideLoading();
                console.error('Checkout error:', error);
                showToast('Failed to start checkout: ' + error.message, 'error');
            }
        });
        
        document.getElementById('close-upgrade-modal').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        modal.dataset.listenersSet = 'true';
    }
}

// Auto-save notebook after content is added
async function autoSaveNotebook() {
    try {
        if (!notebookManager.hasContent()) {
            return; // Nothing to save yet
        }

        const result = await notebookManager.saveNotebook();
        if (result.success) {
            console.log('Notebook auto-saved successfully');
            
            // Show a subtle success message for first save (new notebook)
            if (result.message && result.message.includes('saved successfully')) {
                showToast('📚 Notebook saved automatically!', 'success');
            }
            
            // Update usage stats to reflect any changes in notebook count
            await updateUsageStats();
        } else {
            console.warn('Auto-save failed:', result.error);
        }
    } catch (error) {
        console.error('Auto-save error:', error);
        // Don't show error toast for auto-save failures to avoid interrupting user flow
    }
}

// Notebook Management Functions
async function startNewNotebook() {
    // Check if user can create a new notebook (free tier limit)
    const canCreate = await notebookManager.canCreateNotebook();
    if (!canCreate.allowed) {
        if (canCreate.reason === 'free_tier_limit') {
            showUpgradeModal(canCreate.message);
        } else {
            showToast(canCreate.message || 'Cannot create notebook', 'error');
        }
        return;
    }
    
    // Clear current state
    state.domainPapers = {
        domain1: [],
        domain2: [],
        domain3: []
    };
    state.connections = [];
    state.hypotheses = [];
    
    // Reset domain inputs
    resetDomainInputs();
    
    // Hide result sections
    document.getElementById('results-section').style.display = 'none';
    document.getElementById('discovery-section').style.display = 'none';
    document.getElementById('hypotheses-section').style.display = 'none';
    document.getElementById('patterns-section').style.display = 'none';
    document.getElementById('action-section').style.display = 'none';
    
    // Clear containers
    document.getElementById('papers-by-domain').innerHTML = '';
    document.getElementById('connections-container').innerHTML = '';
    document.getElementById('hypotheses-container').innerHTML = '';
    document.getElementById('patterns-container').innerHTML = '';
    
    // Reset stats
    updateStats();
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    showToast('Ready to start a new notebook!', 'success');
}

// Reset domain inputs to default state
function resetDomainInputs() {
    // Reset domain 1 and 2 to first option
    const domain1Select = document.querySelector('.domain-category[data-domain="1"]');
    const domain2Select = document.querySelector('.domain-category[data-domain="2"]');
    const domain3Select = document.querySelector('.domain-category[data-domain="3"]');
    
    if (domain1Select && domain1Select.options.length > 0) {
        domain1Select.selectedIndex = 0;
        updatePlaceholder(1, domain1Select.value);
    }
    if (domain2Select && domain2Select.options.length > 0) {
        domain2Select.selectedIndex = 0;
        updatePlaceholder(2, domain2Select.value);
    }
    if (domain3Select) {
        // Set domain 3 to "none" option (should be the last option)
        const noneOption = Array.from(domain3Select.options).find(opt => 
            opt.value === '' || opt.textContent.toLowerCase().includes('none')
        );
        if (noneOption) {
            domain3Select.selectedIndex = noneOption.index;
        } else {
            domain3Select.selectedIndex = domain3Select.options.length - 1; // Fallback to last option
        }
        updatePlaceholder(3, domain3Select.value);
    }
    
    // Clear all query inputs and reset placeholders
    for (let i = 1; i <= 3; i++) {
        const queryInput = document.querySelector(`.domain-query[data-domain="${i}"]`);
        if (queryInput) {
            queryInput.value = '';
        }
    }
}

// Update placeholder text based on selected category
function updatePlaceholder(domainNum, category) {
    const queryInput = document.querySelector(`.domain-query[data-domain="${domainNum}"]`);
    if (!queryInput) return;
    
    const placeholders = {
        'cs.AI': 'e.g., neural networks, machine learning, computer vision',
        'cs.CL': 'e.g., natural language processing, text analysis, chatbots',
        'cs.LG': 'e.g., deep learning, reinforcement learning, model training',
        'physics.bio-ph': 'e.g., protein folding, cellular dynamics, biomechanics',
        'q-bio.BM': 'e.g., molecular interactions, drug discovery, biochemistry',
        'q-bio.NC': 'e.g., brain networks, neural computation, cognition',
        'econ.EM': 'e.g., market analysis, economic modeling, forecasting',
        'stat.ML': 'e.g., statistical learning, data mining, pattern recognition',
        'math.OC': 'e.g., optimization algorithms, control theory, operations research',
        'cond-mat.stat-mech': 'e.g., phase transitions, complex systems, statistical physics'
    };
    
    queryInput.placeholder = placeholders[category] || 'Enter your research interest or keywords';
}

async function loadNotebooksList() {
    const container = document.getElementById('notebooks-list');
    container.innerHTML = '<div class="loading-text">Loading notebooks...</div>';

    try {
        const result = await notebookManager.loadNotebooks();
        
        if (!result.success) {
            container.innerHTML = `<div class="error-text">Failed to load notebooks: ${result.error}</div>`;
            return;
        }
        
        const notebooks = notebookManager.savedNotebooks; // Get the actual notebooks array
        
        if (notebooks.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>📚 No notebooks yet</p>
                    <p class="hint">Start discovering connections and save your first notebook!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = notebooks.map(nb => `
            <div class="notebook-card" data-id="${nb.id}">
                <div class="notebook-header">
                    <h3>${escapeHtml(nb.title)}</h3>
                    <div class="notebook-actions">
                        <button class="btn-icon view-notebook" data-id="${nb.id}" title="View">👁️</button>
                        <button class="btn-icon delete-notebook" data-id="${nb.id}" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="notebook-meta">
                    <span>📅 ${new Date(nb.createdAt).toLocaleDateString()}</span>
                    <span>🔗 ${nb.analogies.length} analogies</span>
                    <span>💭 ${nb.hypotheses.length} hypotheses</span>
                    <span>🧩 ${nb.patterns.length} patterns</span>
                </div>
            </div>
        `).join('');

        // Add event listeners
        container.querySelectorAll('.view-notebook').forEach(btn => {
            btn.addEventListener('click', () => viewNotebook(btn.dataset.id));
        });

        container.querySelectorAll('.delete-notebook').forEach(btn => {
            btn.addEventListener('click', () => deleteNotebook(btn.dataset.id));
        });
    } catch (error) {
        container.innerHTML = `<div class="error-message">Failed to load notebooks: ${error.message}</div>`;
    }
}

async function viewNotebook(notebookId) {
    showLoading('Loading notebook...');
    
    try {
        const notebook = await notebookManager.loadNotebook(notebookId);
        
        if (!notebook) {
            hideLoading();
            showToast('Failed to load notebook: Notebook not found', 'error');
            return;
        }
        
        // Load notebook data into state
        state.connections = notebook.analogies || [];
        state.hypotheses = notebook.hypotheses || [];
        
        // Restore the original paper data for chord diagrams
        if (notebook.domainPapers) {
            state.domainPapers = notebook.domainPapers;
            console.log('Restored domainPapers from notebook:', Object.keys(state.domainPapers), state.domainPapers);
        } else {
            console.log('No domainPapers found in notebook:', notebook);
        }
        
        // Restore the notebook to current session with generation counts
        notebookManager.currentNotebook = {
            title: notebook.title,
            domains: notebook.domains,
            connections: notebook.connections || [],
            analogies: notebook.analogies || [],
            patterns: notebook.patterns || [],
            hypotheses: notebook.hypotheses || [],
            createdAt: notebook.createdAt,
            // Set generation counts to 1 since this notebook was already generated
            analogiesGenerated: notebook.analogies && notebook.analogies.length > 0 ? 1 : 0,
            hypothesesGenerated: notebook.hypotheses && notebook.hypotheses.length > 0 ? 1 : 0,
            patternsGenerated: notebook.patterns && notebook.patterns.length > 0 ? 1 : 0,
            savedId: notebookId // Mark as already saved so re-saving updates instead of creating new
        };
        
        // Switch to main app view
        showMainApp();
        
        // Display the original papers if they were restored
        if (notebook.domainPapers && Object.keys(notebook.domainPapers).length > 0) {
            console.log('Displaying restored papers from notebook');
            // Make sure papers section is visible
            const papersSection = document.getElementById('papers-section');
            if (papersSection) {
                papersSection.style.display = 'block';
            }
            // Small delay to ensure DOM is ready
            setTimeout(() => {
                displayPapersByDomain();
            }, 100);
        } else {
            console.log('Legacy notebook without paper data - showing notice');
            // Show a helpful message for legacy notebooks
            const papersSection = document.getElementById('papers-section');
            if (papersSection) {
                papersSection.style.display = 'block';
                papersSection.innerHTML = `
                    <div style="padding: 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #007acc; margin: 20px 0;">
                        <h3 style="margin-top: 0; color: #333;">📚 Legacy Notebook</h3>
                        <p style="color: #666; margin-bottom: 10px;">This notebook was created before paper data was saved. You can still view all connections and hypotheses, but the original papers and chord diagrams are not available.</p>
                        <p style="color: #666; margin: 0;"><strong>Tip:</strong> Create a new discovery session to get the full experience with interactive chord diagrams!</p>
                    </div>
                `;
            }
        }
        
        // Display notebook content
        if (state.connections.length > 0) {
            document.getElementById('discovery-section').style.display = 'block';
            displayConnections();
        }
        
        if (state.hypotheses.length > 0) {
            document.getElementById('hypotheses-section').style.display = 'block';
            displayHypotheses();
        }
        
        if (notebook.patterns && notebook.patterns.length > 0) {
            document.getElementById('patterns-section').style.display = 'block';
            displayPatterns(notebook.patterns);
        }
        
        document.getElementById('action-section').style.display = 'block';
        updateStats();
        
        showToast(`📚 Loaded: ${notebook.title}`, 'success');
    } catch (error) {
        showToast(`Failed to load notebook: ${error.message}`, 'error');
        console.error('Load notebook error:', error);
    } finally {
        hideLoading();
    }
}

async function deleteNotebook(notebookId) {
    // Use custom confirmation instead of browser confirm
    const confirmed = await showConfirmDialog('Are you sure you want to delete this notebook?');
    if (!confirmed) {
        return;
    }

    try {
        showLoading('Deleting notebook...');
        const result = await notebookManager.deleteNotebook(notebookId);
        hideLoading();
        
        if (result.success) {
            showToast('🗑️ Notebook deleted', 'success');
            await updateUsageStats(); // Update the notebook count
            loadNotebooksList();
        } else {
            showToast(`Failed to delete: ${result.error}`, 'error');
        }
    } catch (error) {
        hideLoading();
        console.error('Delete error:', error);
        showToast(`Failed to delete: ${error.message}`, 'error');
    }
}

// Custom confirm dialog
function showConfirmDialog(message) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Confirm Delete</h3>
                <p>${message}</p>
                <div class="modal-buttons">
                    <button class="btn btn-danger" id="confirm-yes">Delete</button>
                    <button class="btn btn-secondary" id="confirm-no">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        document.getElementById('confirm-yes').addEventListener('click', () => {
            modal.remove();
            resolve(true);
        });
        
        document.getElementById('confirm-no').addEventListener('click', () => {
            modal.remove();
            resolve(false);
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        });
    });
}

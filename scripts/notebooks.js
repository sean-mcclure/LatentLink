// Notebook Management for LatentLink

class NotebookManager {
    constructor() {
        this.currentNotebook = {
            title: '',
            domains: [],
            connections: [],
            analogies: [],
            patterns: [],
            hypotheses: [],
            createdAt: new Date(),
            analogiesGenerated: 0,
            hypothesesGenerated: 0,
            patternsGenerated: 0,
            savedId: null // Track if this notebook has been saved
        };
    }

    // Initialize a new notebook session
    async startNewNotebook(domains) {
        this.currentNotebook = {
            title: this.generateTitle(domains),
            domains: domains,
            connections: [],
            analogies: [],
            patterns: [],
            hypotheses: [],
            createdAt: new Date(),
            analogiesGenerated: 0,
            hypothesesGenerated: 0,
            patternsGenerated: 0,
            savedId: null
        };
        
        // Note: We'll check notebook limits when saving, not when starting
        // This eliminates the need for Master Key operations
    }

    // Generate a title from domains
    generateTitle(domains) {
        const domainNames = domains.map(d => d.area || d).filter(Boolean);
        if (domainNames.length === 0) return 'Untitled Discovery';
        return domainNames.join(' × ');
    }

    // Add connections to current notebook
    addConnections(connections) {
        this.currentNotebook.connections.push(...connections);
    }

    // Add analogies to current notebook
    addAnalogies(analogies) {
        this.currentNotebook.analogies.push(...analogies);
        this.currentNotebook.analogiesGenerated++;
    }

    // Add patterns to current notebook
    addPatterns(patterns) {
        this.currentNotebook.patterns.push(...patterns);
        this.currentNotebook.patternsGenerated++;
    }

    // Add hypotheses to current notebook
    addHypotheses(hypotheses) {
        this.currentNotebook.hypotheses.push(...hypotheses);
        this.currentNotebook.hypothesesGenerated++;
    }

    // Save current notebook to Back4App (simplified approach)
    async saveNotebook(customTitle = null) {
        try {
            const user = Parse.User.current();
            if (!user) {
                throw new Error('Must be logged in to save notebooks');
            }

            const Notebook = Parse.Object.extend('Notebook');
            let notebook;
            let isUpdate = false;

            // Check if this notebook has already been saved - if so, update it
            if (this.currentNotebook.savedId) {
                const query = new Parse.Query(Notebook);
                notebook = await query.get(this.currentNotebook.savedId);
                isUpdate = true;
            } else {
                // Create new notebook
                notebook = new Notebook();
            }

            notebook.set('title', customTitle || this.currentNotebook.title);
            notebook.set('domains', this.currentNotebook.domains);
            notebook.set('connections', this.currentNotebook.connections);
            notebook.set('analogies', this.currentNotebook.analogies);
            notebook.set('patterns', this.currentNotebook.patterns);
            notebook.set('hypotheses', this.currentNotebook.hypotheses);
            // Save the actual paper data so chord diagrams work with real papers
            const paperData = window.state?.domainPapers || {};
            console.log('Attempting to save domainPapers to notebook:');
            console.log('- window.state exists:', !!window.state);
            console.log('- domainPapers keys:', Object.keys(paperData));
            console.log('- domainPapers data:', paperData);
            console.log('- Total paper count:', Object.values(paperData).reduce((total, papers) => total + (papers?.length || 0), 0));
            notebook.set('domainPapers', paperData);
            
            // Only set user for new notebooks (no ACL needed with public permissions)
            if (!isUpdate) {
                notebook.set('user', user);
            }

            await notebook.save();
            
            // Mark this notebook as saved (for new notebooks)
            if (!isUpdate) {
                this.currentNotebook.savedId = notebook.id;
            }
            
            return {
                success: true,
                notebookId: notebook.id,
                message: isUpdate ? 'Notebook updated successfully' : 'Notebook saved successfully'
            };
        } catch (error) {
            console.error('Save notebook error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Load notebooks from Back4App (simplified approach)
    async loadNotebooks() {
        try {
            const user = Parse.User.current();
            if (!user) {
                this.savedNotebooks = [];
                this.renderSavedNotebooks();
                return { success: true, count: 0 };
            }

            const Notebook = Parse.Object.extend('Notebook');
            const query = new Parse.Query(Notebook);
            query.equalTo('user', user);
            query.descending('updatedAt');

            const notebooks = await query.find();
            
            this.savedNotebooks = notebooks.map(notebook => ({
                id: notebook.id,
                title: notebook.get('title'),
                domains: notebook.get('domains') || [],
                connections: notebook.get('connections') || [],
                analogies: notebook.get('analogies') || [],
                patterns: notebook.get('patterns') || [],
                hypotheses: notebook.get('hypotheses') || [],
                domainPapers: notebook.get('domainPapers') || {},
                createdAt: notebook.get('createdAt'),
                updatedAt: notebook.get('updatedAt')
            }));

            this.renderSavedNotebooks();
            return { success: true, count: this.savedNotebooks.length };
        } catch (error) {
            console.error('Load notebooks error:', error);
            return { success: false, error: error.message };
        }
    }

    // Load a specific notebook
    async loadNotebook(notebookId) {
        try {
            // For now, load all notebooks and filter - we can optimize this later
            const notebooks = await this.loadNotebooks();
            const notebook = notebooks.find(nb => nb.id === notebookId);
            
            if (!notebook) {
                throw new Error('Notebook not found');
            }
            
            return notebook;
        } catch (error) {
            console.error('Load notebook error:', error);
            throw error;
        }
    }

        // Delete a notebook (simplified approach)
    async deleteNotebook(notebookId) {
        try {
            const Notebook = Parse.Object.extend('Notebook');
            const query = new Parse.Query(Notebook);
            const notebook = await query.get(notebookId);
            await notebook.destroy();
            
            // Remove from local array
            this.savedNotebooks = this.savedNotebooks.filter(n => n.id !== notebookId);
            this.renderSavedNotebooks();
            return { success: true, message: 'Notebook deleted successfully' };
        } catch (error) {
            console.error('Delete notebook error:', error);
            return { success: false, error: error.message };
        }
    }

    // Get current notebook data
    getCurrentNotebook() {
        return this.currentNotebook;
    }

    // Check if current notebook has content
    hasContent() {
        return this.currentNotebook.connections.length > 0 ||
               this.currentNotebook.analogies.length > 0 ||
               this.currentNotebook.patterns.length > 0 ||
               this.currentNotebook.hypotheses.length > 0;
    }

    // Check if user can generate more (for free tier limits)
    async canGenerateMore(type) {
        const user = Parse.User.current();
        if (!user) return { allowed: false, reason: 'Not logged in' };

        await user.fetch();
        const subscriptionStatus = user.get('subscriptionStatus');
        const stripeSubscriptionId = user.get('stripeSubscriptionId');
        
        // DEBUG: Log subscription info
        console.log('🔍 DEBUG canGenerateMore:', {
            type,
            subscriptionStatus,
            stripeSubscriptionId,
            stripeCustomerId: user.get('stripeCustomerId'),
            isPaidUser: subscriptionStatus === 'active'
        });
        
        // Paid users have unlimited generations
        if (subscriptionStatus === 'active') {
            console.log('✅ User is paid - allowing unlimited generations');
            return { allowed: true };
        }
        
        if (!stripeSubscriptionId) {
            console.log('⚠️ User has no Stripe subscription ID - treating as free user');
        }

        // Free tier: 1 generation per type per notebook
        const generationCount = this.currentNotebook[`${type}Generated`] || 0;
        
        // Enforce free tier limits (disable test mode)
        const allowFreeTier = false; // FREE TIER LIMITS ARE ENFORCED
        
        if (generationCount >= 1 && !allowFreeTier) {
            return { 
                allowed: false, 
                reason: 'free_tier_limit',
                message: `Free users can generate ${type} once per notebook. Subscribe for unlimited generations!`
            };
        }

        console.log(`✅ Allowing ${type} generation`);
        return { allowed: true };
    }

    // Check if user can create a new notebook (simplified client-side check)
    async canCreateNotebook() {
        try {
            const user = Parse.User.current();
            if (!user) {
                return { allowed: false, reason: 'Must be logged in', message: 'Must be logged in' };
            }

            // Check if user has premium status
            const subscriptionStatus = user.get('subscriptionStatus') || 'inactive';
            const isPremium = subscriptionStatus === 'active';
            
            if (isPremium) {
                return { allowed: true, reason: 'Premium user - unlimited notebooks' };
            }

            // For free users, count their existing notebooks
            const notebookCount = this.savedNotebooks.length;
            const FREE_LIMIT = 3;

            if (notebookCount >= FREE_LIMIT) {
                return { 
                    allowed: false, 
                    reason: 'free_tier_limit',
                    message: `Free users are limited to ${FREE_LIMIT} notebooks. Upgrade to premium for 100 notebooks per month.` 
                };
            }

            return { 
                allowed: true, 
                reason: `Free user - ${notebookCount}/${FREE_LIMIT} notebooks used` 
            };
        } catch (error) {
            console.error('Error checking notebook limit:', error);
            return { allowed: true, reason: 'Unable to check limit, allowing creation' };
        }
    }

    // Render saved notebooks in the UI
    renderSavedNotebooks() {
        const container = document.getElementById('saved-notebooks');
        if (!container) {
            console.log('Saved notebooks container not found - UI might not be ready');
            return;
        }

        if (!this.savedNotebooks || this.savedNotebooks.length === 0) {
            container.innerHTML = '<p class="no-notebooks">No saved notebooks yet</p>';
            return;
        }

        container.innerHTML = this.savedNotebooks.map(notebook => `
            <div class="notebook-item" data-id="${notebook.id}">
                <div class="notebook-header">
                    <h3>${notebook.title}</h3>
                    <div class="notebook-actions">
                        <button class="btn-small load-notebook" data-id="${notebook.id}">Load</button>
                        <button class="btn-small delete-notebook" data-id="${notebook.id}">Delete</button>
                    </div>
                </div>
                <div class="notebook-meta">
                    <span>Domains: ${notebook.domains.length}</span>
                    <span>Connections: ${notebook.connections.length}</span>
                    <span>Updated: ${new Date(notebook.updatedAt).toLocaleDateString()}</span>
                </div>
            </div>
        `).join('');

        // Add event listeners for load and delete buttons
        container.querySelectorAll('.load-notebook').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const notebookId = e.target.getAttribute('data-id');
                this.loadNotebook(notebookId);
            });
        });

        container.querySelectorAll('.delete-notebook').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const notebookId = e.target.getAttribute('data-id');
                if (confirm('Are you sure you want to delete this notebook?')) {
                    const result = await this.deleteNotebook(notebookId);
                    if (result.success) {
                        showToast('Notebook deleted successfully', 'success');
                    } else {
                        showToast('Failed to delete notebook: ' + result.error, 'error');
                    }
                }
            });
        });
    }

    // Load a specific notebook
    loadNotebook(notebookId) {
        const notebook = this.savedNotebooks.find(n => n.id === notebookId);
        if (!notebook) {
            console.error('Notebook not found with ID:', notebookId);
            return null;
        }

        // Set as current notebook
        this.currentNotebook = {
            ...notebook,
            savedId: notebook.id
        };

        // Return the notebook data
        console.log('Loaded notebook:', notebook);
        return notebook;
    }
}

// Export singleton instance
const notebookManager = new NotebookManager();
console.log('NotebookManager initialized:', notebookManager);

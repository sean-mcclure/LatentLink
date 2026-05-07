class NotebookManager {
    constructor() {
        this.savedNotebooks = [];
        this.currentNotebook = this.createEmptyNotebook();
    }

    createEmptyNotebook() {
        return {
            title: '',
            manuscript: null,
            field: 'generic',
            pipeline: [],
            fingerprint: null,
            correspondences: [],
            candidates: [],
            renderings: [],
            verificationSummary: null,
            savedId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    async startNewNotebook(meta = {}) {
        this.currentNotebook = {
            ...this.createEmptyNotebook(),
            title: meta.title || 'Untitled analysis',
            field: meta.field || 'generic',
            manuscript: meta.manuscript || null
        };

        return this.currentNotebook;
    }

    updateCurrentNotebook(patch) {
        this.currentNotebook = {
            ...this.currentNotebook,
            ...patch,
            updatedAt: new Date().toISOString()
        };
        return this.currentNotebook;
    }

    getCurrentNotebook() {
        return this.currentNotebook;
    }

    hasContent() {
        return Boolean(
            this.currentNotebook.manuscript ||
            this.currentNotebook.fingerprint ||
            this.currentNotebook.correspondences?.length ||
            this.currentNotebook.renderings?.length
        );
    }

    async saveNotebook(customTitle = null) {
        try {
            const user = Parse.User.current();
            if (!user) {
                throw new Error('Must be logged in to save sessions');
            }

            const Notebook = Parse.Object.extend('Notebook');
            let notebook;
            let isUpdate = false;

            if (this.currentNotebook.savedId) {
                const query = new Parse.Query(Notebook);
                notebook = await query.get(this.currentNotebook.savedId);
                isUpdate = true;
            } else {
                notebook = new Notebook();
                notebook.set('user', user);
            }

            const title = customTitle || this.currentNotebook.title || 'Untitled analysis';
            notebook.set('title', title);
            notebook.set('domains', [{ area: this.currentNotebook.field, query: title }]);
            notebook.set('connections', this.currentNotebook.correspondences || []);
            notebook.set('analogies', this.currentNotebook.correspondences || []);
            notebook.set('patterns', this.currentNotebook.fingerprint?.dynamics || []);
            notebook.set('hypotheses', []);
            notebook.set('analysisRun', this.currentNotebook);
            notebook.set('manuscript', this.currentNotebook.manuscript || null);
            notebook.set('fingerprint', this.currentNotebook.fingerprint || null);
            notebook.set('renderings', this.currentNotebook.renderings || []);
            notebook.set('verificationSummary', this.currentNotebook.verificationSummary || null);

            await notebook.save();

            this.currentNotebook.savedId = notebook.id;
            return {
                success: true,
                notebookId: notebook.id,
                message: isUpdate ? 'Analysis updated' : 'Analysis saved'
            };
        } catch (error) {
            console.error('Save notebook error:', error);
            return { success: false, error: error.message };
        }
    }

    async loadNotebooks() {
        try {
            const user = Parse.User.current();
            if (!user) {
                this.savedNotebooks = [];
                return { success: true, count: 0, notebooks: [] };
            }

            const Notebook = Parse.Object.extend('Notebook');
            const query = new Parse.Query(Notebook);
            query.equalTo('user', user);
            query.descending('updatedAt');

            const notebooks = await query.find();
            this.savedNotebooks = notebooks.map((notebook) => {
                const analysisRun = notebook.get('analysisRun') || {};
                return {
                    id: notebook.id,
                    title: notebook.get('title') || 'Untitled analysis',
                    analysisRun,
                    field: analysisRun.field || notebook.get('domains')?.[0]?.area || 'generic',
                    correspondences: analysisRun.correspondences || notebook.get('connections') || [],
                    fingerprint: analysisRun.fingerprint || notebook.get('fingerprint') || null,
                    manuscript: analysisRun.manuscript || notebook.get('manuscript') || null,
                    verificationSummary: analysisRun.verificationSummary || notebook.get('verificationSummary') || null,
                    updatedAt: notebook.updatedAt,
                    createdAt: notebook.createdAt
                };
            });

            return {
                success: true,
                count: this.savedNotebooks.length,
                notebooks: this.savedNotebooks
            };
        } catch (error) {
            console.error('Load notebooks error:', error);
            return { success: false, error: error.message, notebooks: [] };
        }
    }

    loadNotebook(notebookId) {
        const notebook = this.savedNotebooks.find((item) => item.id === notebookId);
        if (!notebook) {
            return null;
        }

        this.currentNotebook = {
            ...this.createEmptyNotebook(),
            ...notebook.analysisRun,
            title: notebook.title,
            field: notebook.field,
            savedId: notebook.id,
            fingerprint: notebook.fingerprint,
            correspondences: notebook.correspondences,
            manuscript: notebook.manuscript,
            verificationSummary: notebook.verificationSummary
        };

        return this.currentNotebook;
    }

    async deleteNotebook(notebookId) {
        try {
            const Notebook = Parse.Object.extend('Notebook');
            const query = new Parse.Query(Notebook);
            const notebook = await query.get(notebookId);
            await notebook.destroy();
            this.savedNotebooks = this.savedNotebooks.filter((item) => item.id !== notebookId);
            return { success: true };
        } catch (error) {
            console.error('Delete notebook error:', error);
            return { success: false, error: error.message };
        }
    }

    async canCreateNotebook() {
        try {
            const user = Parse.User.current();
            if (!user) {
                return { allowed: false, reason: 'auth', message: 'Must be logged in' };
            }

            const subscriptionStatus = user.get('subscriptionStatus') || 'inactive';
            if (subscriptionStatus === 'active') {
                return { allowed: true, reason: 'premium' };
            }

            if (!this.savedNotebooks.length) {
                await this.loadNotebooks();
            }

            const FREE_LIMIT = 3;
            if (this.savedNotebooks.length >= FREE_LIMIT && !this.currentNotebook.savedId) {
                return {
                    allowed: false,
                    reason: 'free_tier_limit',
                    message: `Free users are limited to ${FREE_LIMIT} saved analyses. Upgrade for more.`
                };
            }

            return { allowed: true, reason: 'free-tier-available' };
        } catch (error) {
            console.error('Notebook limit check failed:', error);
            return { allowed: true, reason: 'fallback' };
        }
    }
}

const notebookManager = new NotebookManager();
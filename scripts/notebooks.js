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
            note: '',
            pipeline: [],
            fingerprint: null,
            correspondences: [],
            candidates: [],
            renderings: [],
            verificationSummary: null,
            savedId: null,
            manuscriptHash: null,
            creditsCharged: 0,
            parentAnalysisId: null,
            pins: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    normalizeCorrespondences(correspondences, pinMap = {}) {
        return (Array.isArray(correspondences) ? correspondences : [])
            .map((item, index) => {
                const id = item.id || `corr-${index + 1}`;
                const pin = pinMap[id] || null;
                return {
                    ...item,
                    id,
                    pin: pin ? {
                        id: pin.id,
                        annotation: pin.annotation || '',
                        isRelevant: typeof pin.isRelevant === 'boolean' ? pin.isRelevant : true,
                        createdAt: pin.createdAt || null
                    } : null
                };
            })
            .sort((left, right) => {
                const leftPinned = left.pin ? 1 : 0;
                const rightPinned = right.pin ? 1 : 0;
                if (leftPinned !== rightPinned) {
                    return rightPinned - leftPinned;
                }

                const leftRelevant = left.pin?.isRelevant === false ? 1 : 0;
                const rightRelevant = right.pin?.isRelevant === false ? 1 : 0;
                if (leftRelevant !== rightRelevant) {
                    return leftRelevant - rightRelevant;
                }

                return 0;
            });
    }

    applyPinsToNotebook(notebook, pinMap = {}) {
        const correspondences = this.normalizeCorrespondences(notebook.correspondences || notebook.renderings || [], pinMap);
        return {
            ...notebook,
            correspondences,
            renderings: correspondences,
            pins: pinMap
        };
    }

    async startNewNotebook(meta = {}) {
        this.currentNotebook = this.applyPinsToNotebook({
            ...this.createEmptyNotebook(),
            title: meta.title || 'Untitled analysis',
            field: meta.field || 'generic',
            manuscript: meta.manuscript || null,
            manuscriptHash: meta.manuscriptHash || null,
            parentAnalysisId: meta.parentAnalysisId || null,
            note: meta.note || ''
        });

        return this.currentNotebook;
    }

    updateCurrentNotebook(patch) {
        this.currentNotebook = this.applyPinsToNotebook({
            ...this.currentNotebook,
            ...patch,
            updatedAt: new Date().toISOString()
        }, patch.pins || this.currentNotebook.pins || {});
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

    createAnalysisACL(user) {
        const acl = new Parse.ACL(user);
        acl.setPublicReadAccess(false);
        acl.setPublicWriteAccess(false);
        return acl;
    }

    async saveNotebook(customTitle = null) {
        try {
            const user = Parse.User.current();
            if (!user) {
                throw new Error('Must be logged in to save analyses');
            }

            const Analysis = Parse.Object.extend('Analysis');
            let analysis;
            let isUpdate = false;

            if (this.currentNotebook.savedId) {
                const query = new Parse.Query(Analysis);
                analysis = await query.get(this.currentNotebook.savedId);
                isUpdate = true;
            } else {
                analysis = new Analysis();
                analysis.setACL(this.createAnalysisACL(user));
                analysis.set('user', user);
            }

            const title = customTitle || this.currentNotebook.title || 'Untitled analysis';
            const manuscript = this.currentNotebook.manuscript || {};
            const correspondences = this.normalizeCorrespondences(this.currentNotebook.correspondences || this.currentNotebook.renderings, this.currentNotebook.pins || {});

            analysis.set('manuscript_title', title);
            analysis.set('title', title);
            analysis.set('manuscript', manuscript);
            analysis.set('manuscript_text', manuscript.rawText || this.currentNotebook.manuscript?.rawText || '');
            analysis.set('manuscript_hash', this.currentNotebook.manuscriptHash || null);
            analysis.set('fingerprint', this.currentNotebook.fingerprint || null);
            analysis.set('correspondences', correspondences);
            analysis.set('field_rendering', {
                [this.currentNotebook.field || 'generic']: correspondences
            });
            analysis.set('renderings', correspondences);
            analysis.set('candidates', this.currentNotebook.candidates || []);
            analysis.set('verification_summary', this.currentNotebook.verificationSummary || null);
            analysis.set('verificationSummary', this.currentNotebook.verificationSummary || null);
            analysis.set('pipeline', this.currentNotebook.pipeline || []);
            analysis.set('field', this.currentNotebook.field || 'generic');
            analysis.set('credits_charged', this.currentNotebook.creditsCharged || 0);
            analysis.set('note', this.currentNotebook.note || '');

            if (this.currentNotebook.parentAnalysisId) {
                const parent = new Analysis();
                parent.id = this.currentNotebook.parentAnalysisId;
                analysis.set('parent_analysis', parent);
            }

            await analysis.save();

            this.currentNotebook.savedId = analysis.id;
            await this.persistPinsForCurrentNotebook();
            return {
                success: true,
                notebookId: analysis.id,
                message: isUpdate ? 'Analysis updated' : 'Analysis saved'
            };
        } catch (error) {
            console.error('Save analysis error:', error);
            return { success: false, error: error.message };
        }
    }

    buildPinMap(pinObjects) {
        return pinObjects.reduce((items, pin) => {
            items[pin.get('correspondence_id')] = {
                id: pin.id,
                annotation: pin.get('annotation') || '',
                isRelevant: typeof pin.get('is_relevant') === 'boolean' ? pin.get('is_relevant') : true,
                createdAt: pin.createdAt
            };
            return items;
        }, {});
    }

    buildNotebookRecord(analysisObject, pinMap = {}) {
        const correspondences = analysisObject.get('correspondences') || analysisObject.get('renderings') || [];
        const record = {
            id: analysisObject.id,
            title: analysisObject.get('manuscript_title') || analysisObject.get('title') || 'Untitled analysis',
            analysisRun: analysisObject.toJSON(),
            field: analysisObject.get('field') || 'generic',
            correspondences,
            fingerprint: analysisObject.get('fingerprint') || null,
            manuscript: analysisObject.get('manuscript') || null,
            verificationSummary: analysisObject.get('verification_summary') || analysisObject.get('verificationSummary') || null,
            manuscriptHash: analysisObject.get('manuscript_hash') || null,
            creditsCharged: analysisObject.get('credits_charged') || 0,
            parentAnalysisId: analysisObject.get('parent_analysis')?.id || null,
            note: analysisObject.get('note') || '',
            pipeline: analysisObject.get('pipeline') || [],
            candidates: analysisObject.get('candidates') || [],
            updatedAt: analysisObject.updatedAt,
            createdAt: analysisObject.createdAt,
            pins: pinMap
        };

        const withPins = this.applyPinsToNotebook(record, pinMap);
        return {
            ...withPins,
            pinnedCount: Object.keys(pinMap).length
        };
    }

    async loadNotebooks() {
        try {
            const user = Parse.User.current();
            if (!user) {
                this.savedNotebooks = [];
                return { success: true, count: 0, notebooks: [] };
            }

            const Analysis = Parse.Object.extend('Analysis');
            const analysisQuery = new Parse.Query(Analysis);
            analysisQuery.equalTo('user', user);
            analysisQuery.descending('updatedAt');

            const analysisObjects = await analysisQuery.find();
            const pinMapByAnalysisId = {};

            if (analysisObjects.length) {
                const Pin = Parse.Object.extend('Pin');
                const pinQuery = new Parse.Query(Pin);
                pinQuery.equalTo('user', user);
                pinQuery.containedIn('analysis', analysisObjects);
                const pinObjects = await pinQuery.find();

                pinObjects.forEach((pin) => {
                    const analysisId = pin.get('analysis')?.id;
                    if (!analysisId) {
                        return;
                    }

                    if (!pinMapByAnalysisId[analysisId]) {
                        pinMapByAnalysisId[analysisId] = {};
                    }

                    pinMapByAnalysisId[analysisId][pin.get('correspondence_id')] = {
                        id: pin.id,
                        annotation: pin.get('annotation') || '',
                        isRelevant: typeof pin.get('is_relevant') === 'boolean' ? pin.get('is_relevant') : true,
                        createdAt: pin.createdAt
                    };
                });
            }

            this.savedNotebooks = analysisObjects.map((analysisObject) => this.buildNotebookRecord(analysisObject, pinMapByAnalysisId[analysisObject.id] || {}));

            return {
                success: true,
                count: this.savedNotebooks.length,
                notebooks: this.savedNotebooks
            };
        } catch (error) {
            console.error('Load analyses error:', error);
            return { success: false, error: error.message, notebooks: [] };
        }
    }

    loadNotebook(notebookId) {
        const notebook = this.savedNotebooks.find((item) => item.id === notebookId);
        if (!notebook) {
            return null;
        }

        this.currentNotebook = this.applyPinsToNotebook({
            ...this.createEmptyNotebook(),
            ...notebook.analysisRun,
            title: notebook.title,
            field: notebook.field,
            savedId: notebook.id,
            fingerprint: notebook.fingerprint,
            correspondences: notebook.correspondences,
            manuscript: notebook.manuscript,
            verificationSummary: notebook.verificationSummary,
            manuscriptHash: notebook.manuscriptHash,
            creditsCharged: notebook.creditsCharged,
            parentAnalysisId: notebook.parentAnalysisId,
            note: notebook.note,
            pipeline: notebook.pipeline,
            candidates: notebook.candidates,
            pins: notebook.pins
        }, notebook.pins || {});

        return this.currentNotebook;
    }

    getNotebookByHash(manuscriptHash) {
        return this.savedNotebooks.find((item) => item.manuscriptHash && item.manuscriptHash === manuscriptHash) || null;
    }

    async renameNotebook(notebookId, nextTitle) {
        try {
            const Analysis = Parse.Object.extend('Analysis');
            const query = new Parse.Query(Analysis);
            const analysis = await query.get(notebookId);
            analysis.set('manuscript_title', nextTitle);
            analysis.set('title', nextTitle);
            await analysis.save();

            if (this.currentNotebook.savedId === notebookId) {
                this.currentNotebook.title = nextTitle;
            }

            return { success: true };
        } catch (error) {
            console.error('Rename analysis error:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteNotebook(notebookId) {
        try {
            const Analysis = Parse.Object.extend('Analysis');
            const Pin = Parse.Object.extend('Pin');
            const query = new Parse.Query(Analysis);
            const analysis = await query.get(notebookId);

            const pinQuery = new Parse.Query(Pin);
            pinQuery.equalTo('analysis', analysis);
            const pins = await pinQuery.find();
            if (pins.length) {
                await Parse.Object.destroyAll(pins);
            }

            await analysis.destroy();
            this.savedNotebooks = this.savedNotebooks.filter((item) => item.id !== notebookId);
            return { success: true };
        } catch (error) {
            console.error('Delete analysis error:', error);
            return { success: false, error: error.message };
        }
    }

    async persistPin({ analysisId, correspondenceId, annotation, isRelevant }) {
        try {
            const user = Parse.User.current();
            if (!user) {
                throw new Error('Must be logged in');
            }
            if (!analysisId) {
                throw new Error('Save the analysis before pinning correspondences');
            }

            const Analysis = Parse.Object.extend('Analysis');
            const Pin = Parse.Object.extend('Pin');
            const analysis = new Analysis();
            analysis.id = analysisId;

            const pinQuery = new Parse.Query(Pin);
            pinQuery.equalTo('user', user);
            pinQuery.equalTo('analysis', analysis);
            pinQuery.equalTo('correspondence_id', correspondenceId);
            let pin = await pinQuery.first();
            if (!pin) {
                pin = new Pin();
                pin.setACL(this.createAnalysisACL(user));
                pin.set('user', user);
                pin.set('analysis', analysis);
                pin.set('correspondence_id', correspondenceId);
            }

            pin.set('annotation', annotation || '');
            pin.set('is_relevant', typeof isRelevant === 'boolean' ? isRelevant : true);
            await pin.save();

            const nextPin = {
                id: pin.id,
                annotation: pin.get('annotation') || '',
                isRelevant: typeof pin.get('is_relevant') === 'boolean' ? pin.get('is_relevant') : true,
                createdAt: pin.createdAt
            };

            const nextPins = {
                ...(this.currentNotebook.pins || {}),
                [correspondenceId]: nextPin
            };

            this.updateCurrentNotebook({ pins: nextPins });
            this.savedNotebooks = this.savedNotebooks.map((item) => item.id === analysisId ? this.applyPinsToNotebook({ ...item, pins: nextPins }, nextPins) : item);
            return { success: true, pin: nextPin };
        } catch (error) {
            console.error('Persist pin error:', error);
            return { success: false, error: error.message };
        }
    }

    async persistPinsForCurrentNotebook() {
        const analysisId = this.currentNotebook.savedId;
        if (!analysisId || !this.currentNotebook.pins) {
            return;
        }

        const pins = Object.entries(this.currentNotebook.pins);
        for (const [correspondenceId, pin] of pins) {
            await this.persistPin({
                analysisId,
                correspondenceId,
                annotation: pin.annotation,
                isRelevant: pin.isRelevant
            });
        }
    }

    async canCreateNotebook() {
        return { allowed: true, reason: 'analysis-library' };
    }
}

const notebookManager = new NotebookManager();
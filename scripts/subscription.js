// Credit and checkout management for LatentLink v2

class SubscriptionManager {
    constructor() {
        this.stripe = null;
        this.creditStatus = null;
        this.packCatalog = [
            {
                tier: 'starter',
                name: 'Starter',
                credits: 5,
                priceCents: 1900,
                researcherPriceCents: 1500,
                description: 'For a handful of new manuscript workspaces.'
            },
            {
                tier: 'researcher',
                name: 'Researcher',
                credits: 20,
                priceCents: 5900,
                researcherPriceCents: 4700,
                description: 'Best value for active drafting and revision cycles.',
                isPopular: true
            },
            {
                tier: 'lab',
                name: 'Lab',
                credits: 75,
                priceCents: 17900,
                researcherPriceCents: 14300,
                description: 'For teams comparing many manuscripts and revisions.'
            }
        ];
    }

    async initialize() {
        if (!window.Stripe) {
            throw new Error('Stripe.js not loaded');
        }
        if (typeof STRIPE_CONFIG === 'undefined') {
            throw new Error('STRIPE_CONFIG not defined. Make sure back4app-config.js is loaded first.');
        }
        this.stripe = Stripe(STRIPE_CONFIG.publishableKey);
    }

    getPackCatalog() {
        return this.packCatalog.slice();
    }

    async refreshCreditStatus() {
        const user = Parse.User.current();
        if (!user) {
            this.creditStatus = null;
            return null;
        }

        const result = await Parse.Cloud.run('getCreditStatus');
        this.creditStatus = result;
        return result;
    }

    async getCreditStatus(forceRefresh = false) {
        if (!forceRefresh && this.creditStatus) {
            return this.creditStatus;
        }
        return this.refreshCreditStatus();
    }

    async createCheckoutSession(packTier) {
        try {
            const user = Parse.User.current();
            if (!user) {
                throw new Error('Must be logged in to buy credits');
            }

            const result = await Parse.Cloud.run('createCheckoutSession', { packTier });
            if (!result.url) {
                throw new Error('Failed to create checkout session');
            }

            const newWindow = window.open(result.url, '_blank');
            if (!newWindow) {
                window.location.href = result.url;
            }
            return result;
        } catch (error) {
            console.error('Checkout error:', error);
            throw error;
        }
    }

    async verifyResearcher(method, value) {
        const result = await Parse.Cloud.run('setResearcherVerification', { method, value });
        this.creditStatus = result;
        return result;
    }

    async getAnalysisEligibility(action = 'analysis') {
        const status = await this.getCreditStatus(true);
        if (!status) {
            return { allowed: false, reason: 'auth', message: 'Must be logged in' };
        }

        if (action === 'analysis' && status.freeAnalysisAvailable) {
            return {
                allowed: true,
                kind: 'free',
                message: 'Your first full analysis is free.'
            };
        }

        if ((status.creditsBalance || 0) > 0) {
            return {
                allowed: true,
                kind: 'paid',
                message: `This action will use 1 credit. You have ${status.creditsBalance} remaining.`
            };
        }

        return {
            allowed: false,
            reason: 'no_credits',
            message: 'No credits available. Buy a pack to run a new analysis.'
        };
    }

    async consumeAnalysisCredit(action = 'analysis') {
        const result = await Parse.Cloud.run('consumeAnalysisCredit', { action });
        this.creditStatus = result;
        return result;
    }

    formatPrice(priceCents) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0
        }).format(priceCents / 100);
    }
}

const subscriptionManager = new SubscriptionManager();

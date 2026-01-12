// Authentication Module for LatentLink

class AuthManager {
    constructor() {
        this.currentUser = null;
    }

    // Check if user is logged in
    isAuthenticated() {
        this.currentUser = Parse.User.current();
        return this.currentUser !== null;
    }

    // Get current user
    getCurrentUser() {
        return Parse.User.current();
    }

    // Sign up new user
    async signUp(email, password, name) {
        try {
            const user = new Parse.User();
            user.set('username', email);
            user.set('email', email);
            user.set('password', password);
            user.set('name', name);
            user.set('subscriptionStatus', 'inactive');
            user.set('usageCount', 0);
            user.set('usageLimit', 100); // 100 discoveries per month
            
            await user.signUp();
            this.currentUser = user;
            return { success: true, user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Log in existing user
    async logIn(email, password) {
        try {
            const user = await Parse.User.logIn(email, password);
            this.currentUser = user;
            return { success: true, user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Log out
    async logOut() {
        try {
            await Parse.User.logOut();
            this.currentUser = null;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Validate session on page load - log out if session is expired
    async validateSession() {
        try {
            const currentUser = Parse.User.current();
            
            // If no current user, session is already invalid
            if (!currentUser) {
                this.currentUser = null;
                return { valid: false, message: 'No active session' };
            }

            // Try to fetch user data - this will fail if session token is expired
            await currentUser.fetch();
            this.currentUser = currentUser;
            console.log('✅ Session valid for user:', currentUser.get('email'));
            return { valid: true, user: currentUser };
        } catch (error) {
            console.warn('⚠️ Session expired or invalid, logging out:', error.message);
            // Force logout if session is invalid
            await Parse.User.logOut();
            this.currentUser = null;
            return { valid: false, message: 'Session expired - logged out' };
        }
    }

    // Check subscription status
    async checkSubscription() {
        if (!this.isAuthenticated()) {
            return { active: false, message: 'Not logged in' };
        }

        const user = this.getCurrentUser();
        const status = user.get('subscriptionStatus');
        const expiresAt = user.get('subscriptionExpiresAt');

        if (status === 'active') {
            if (expiresAt && new Date(expiresAt) > new Date()) {
                return { active: true };
            }
        }

        return { active: false, message: 'Subscription inactive or expired' };
    }

    // Check usage limits
    async checkUsageLimit() {
        if (!this.isAuthenticated()) {
            return { allowed: false, message: 'Not logged in' };
        }

        const user = this.getCurrentUser();
        await user.fetch();
        
        const usageCount = user.get('usageCount') || 0;
        const usageLimit = user.get('usageLimit') || 100;

        if (usageCount >= usageLimit) {
            return { 
                allowed: false, 
                message: `Monthly limit reached (${usageCount}/${usageLimit})`,
                count: usageCount,
                limit: usageLimit
            };
        }

        return { 
            allowed: true,
            count: usageCount,
            limit: usageLimit
        };
    }

    // Reset password
    async resetPassword(email) {
        try {
            await Parse.User.requestPasswordReset(email);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// Export singleton instance
const authManager = new AuthManager();

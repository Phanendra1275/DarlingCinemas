import { DarlingUserProfile, DarlingSession, DarlingPreferences } from "../types/user";

const KEYS = {
    PROFILE: "darling-cinemas:user-profile",
    SESSION: "darling-cinemas:session",
    PREFERENCES: "darling-cinemas:preferences"
};

export const darlingStorage = {
    saveProfile(profile: DarlingUserProfile): void {
        try {
            localStorage.setItem(KEYS.PROFILE, JSON.stringify(profile));
        } catch (e) {
            console.error("Failed to save profile:", e);
        }
    },
    loadProfile(): DarlingUserProfile | null {
        try {
            const data = localStorage.getItem(KEYS.PROFILE);
            if (!data) return null;
            return JSON.parse(data) as DarlingUserProfile;
        } catch (e) {
            console.error("Failed to load profile:", e);
            return null;
        }
    },
    deleteProfile(): void {
        try {
            localStorage.removeItem(KEYS.PROFILE);
        } catch (e) {}
    },
    saveSession(session: DarlingSession): void {
        try {
            localStorage.setItem(KEYS.SESSION, JSON.stringify(session));
        } catch (e) {}
    },
    loadSession(): DarlingSession | null {
        try {
            const data = localStorage.getItem(KEYS.SESSION);
            if (!data) return null;
            return JSON.parse(data) as DarlingSession;
        } catch (e) {
            return null;
        }
    },
    deleteSession(): void {
        try {
            localStorage.removeItem(KEYS.SESSION);
        } catch (e) {}
    },
    savePreferences(prefs: DarlingPreferences): void {
        try {
            localStorage.setItem(KEYS.PREFERENCES, JSON.stringify(prefs));
        } catch (e) {}
    },
    loadPreferences(): DarlingPreferences | null {
        try {
            const data = localStorage.getItem(KEYS.PREFERENCES);
            if (!data) return null;
            return JSON.parse(data) as DarlingPreferences;
        } catch (e) {
            return null;
        }
    },
    deletePreferences(): void {
        try {
            localStorage.removeItem(KEYS.PREFERENCES);
        } catch (e) {}
    }
};

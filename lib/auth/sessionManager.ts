import { DarlingUserProfile, DarlingSession } from "../types/user";
import { darlingStorage } from "../storage/darlingStorage";

export const sessionManager = {
    createSession(name: string, gender: "Male" | "Female"): DarlingUserProfile {
        const profile: DarlingUserProfile = {
            id: crypto.randomUUID(),
            name,
            gender,
            avatarType: gender,
            createdAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
        };

        const session: DarlingSession = {
            userId: profile.id,
            remembered: true,
            createdAt: new Date().toISOString(),
        };

        darlingStorage.saveProfile(profile);
        darlingStorage.saveSession(session);
        return profile;
    },
    
    restoreSession(): DarlingUserProfile | null {
        const profile = darlingStorage.loadProfile();
        const session = darlingStorage.loadSession();

        if (profile && session && session.remembered && session.userId === profile.id) {
            // Update last seen
            profile.lastSeenAt = new Date().toISOString();
            darlingStorage.saveProfile(profile);
            return profile;
        }
        return null;
    },

    clearSession(): void {
        darlingStorage.deleteSession();
    },

    deleteLocalProfile(): void {
        darlingStorage.deleteProfile();
        darlingStorage.deleteSession();
        darlingStorage.deletePreferences();
    }
};

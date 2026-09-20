export type DarlingUserProfile = {
    id: string;
    name: string;
    gender: "Male" | "Female";
    avatarType: "Male" | "Female";
    jacket?: string;
    createdAt: string;
    lastSeenAt: string;
};

export type DarlingSession = {
    userId: string;
    remembered: boolean;
    createdAt: string;
};

export type DarlingPreferences = {
    quality?: "Performance" | "Adaptive" | "Ultra";
    reducedMotion?: boolean;
    highRefresh?: boolean;
};

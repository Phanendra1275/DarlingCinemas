import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, Auth, User } from 'firebase/auth';
import {
  getDatabase,
  ref,
  set,
  update,
  get,
  onValue,
  off,
  push,
  onDisconnect,
  runTransaction,
  Database,
  Unsubscribe
} from 'firebase/database';
import type {
  RoomMeta,
  RoomMedia,
  RoomPlayback,
  RoomMember,
  PlayerPose,
  ChatMessage,
  RoomSeats,
  PartyEventListener
} from '../types/party';

// Standard 10 cinema seats
export const CINEMA_SEAT_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'] as const;

// Default or environment-provided Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDarlingCinemasKeyForPartySync123",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "darling-cinemas.firebaseapp.com",
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "https://darling-cinemas-default-rtdb.firebaseio.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "darling-cinemas",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "darling-cinemas.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1029384756",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:1029384756:web:darlingcinema"
};

// Generates a 6-character uppercase alphanumeric code excluding ambiguous characters
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Local multi-tab fallback bridge (BroadcastChannel + localStorage) for instant multi-tab testing
class LocalPartyBridge {
  private channel: BroadcastChannel | null = null;
  private roomCode: string | null = null;
  private listeners: Map<string, Set<(val: any) => void>> = new Map();

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('darling_cinema_party_sync');
      this.channel.onmessage = (event) => {
        const { type, roomCode, path, value } = event.data || {};
        if (roomCode === this.roomCode) {
          this.triggerListeners(path, value);
        }
      };

      // Handle graceful tab close in local mode
      window.addEventListener('beforeunload', () => {
        this.handleDisconnect();
      });
      window.addEventListener('pagehide', () => {
        this.handleDisconnect();
      });
    }
  }

  public setRoom(code: string) {
    this.roomCode = code;
  }

  public getRoom(): string | null {
    return this.roomCode;
  }

  private storageKey(path: string): string {
    return `dc_rtdb:${this.roomCode}:${path}`;
  }

  public get(path: string): any {
    if (typeof window === 'undefined') return null;
    try {
      const item = localStorage.getItem(this.storageKey(path));
      return item ? JSON.parse(item) : null;
    } catch {
      return null;
    }
  }

  public set(path: string, value: any): void {
    if (typeof window === 'undefined') return;
    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(this.storageKey(path));
      } else {
        localStorage.setItem(this.storageKey(path), JSON.stringify(value));
      }
      this.channel?.postMessage({
        type: 'SET',
        roomCode: this.roomCode,
        path,
        value
      });
      this.triggerListeners(path, value);
    } catch (e) {
      console.warn('LocalPartyBridge set failed:', e);
    }
  }

  public update(path: string, partial: Record<string, any>): void {
    const current = this.get(path) || {};
    const updated = { ...current, ...partial };
    this.set(path, updated);
  }

  public runTransaction(path: string, updateFn: (cur: any) => any): { committed: boolean; snapshot: { val: () => any } } {
    const cur = this.get(path);
    const updated = updateFn(cur);
    if (updated === undefined) {
      return { committed: false, snapshot: { val: () => cur } };
    }
    this.set(path, updated);
    return { committed: true, snapshot: { val: () => updated } };
  }

  public push(path: string, item: any): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const collection = this.get(path) || {};
    collection[id] = { ...item, id };
    this.set(path, collection);
    return id;
  }

  public on(path: string, callback: (val: any) => void): () => void {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set());
    }
    this.listeners.get(path)!.add(callback);
    callback(this.get(path));
    return () => {
      this.listeners.get(path)?.delete(callback);
    };
  }

  private triggerListeners(path: string, value: any) {
    // Notify direct listeners
    this.listeners.get(path)?.forEach(cb => {
      try { cb(value); } catch {}
    });

    // Notify root or parent listeners if path is child
    this.listeners.forEach((set, listenerPath) => {
      if (path.startsWith(listenerPath + '/') || listenerPath.startsWith(path + '/')) {
        const fullVal = this.get(listenerPath);
        set.forEach(cb => {
          try { cb(fullVal); } catch {}
        });
      }
    });
  }

  private disconnectHandlers: Array<() => void> = [];

  public onDisconnect(handler: () => void) {
    this.disconnectHandlers.push(handler);
  }

  public clearDisconnects() {
    this.disconnectHandlers = [];
  }

  public handleDisconnect() {
    this.disconnectHandlers.forEach(h => {
      try { h(); } catch {}
    });
    this.disconnectHandlers = [];
  }
}

export class PartyService {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private db: Database | null = null;
  private uid: string | null = null;
  private isAnonymousAuthReady = false;
  private useLocalFallback = false;
  private localBridge = new LocalPartyBridge();

  private activeRoomCode: string | null = null;
  private activeSeatId: string | null = null;
  private isHost = false;
  private currentUserName = 'Guest';
  private currentUserColor = '#c8bea9';

  private lastPoseSentAt = 0;
  private pendingPose: PlayerPose | null = null;
  private poseThrottleTimer: any = null;

  private unsubscribers: Array<() => void> = [];

  constructor() {
    if (typeof window !== 'undefined') {
      // Restore cached UID or establish stable anonymous UID
      const cachedUid = sessionStorage.getItem('darling_party_uid');
      if (cachedUid) {
        this.uid = cachedUid;
      }
    }
  }

  /**
   * Initializes Firebase App, Auth, and Database.
   * Gracefully falls back to local multi-tab sync if Firebase is offline or unconfigured.
   */
  public async init(): Promise<{ uid: string; isFallback: boolean }> {
    if (typeof window === 'undefined') {
      return { uid: 'ssr-uid', isFallback: true };
    }

    try {
      if (!getApps().length) {
        this.app = initializeApp(firebaseConfig);
      } else {
        this.app = getApp();
      }
      this.auth = getAuth(this.app);
      this.db = getDatabase(this.app);

      // Anonymous authentication
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          // If auth takes more than 3 seconds, proceed in fallback mode
          this.useLocalFallback = true;
          if (!this.uid) {
            this.uid = `user_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
            sessionStorage.setItem('darling_party_uid', this.uid);
          }
          resolve();
        }, 3000);

        onAuthStateChanged(this.auth!, async (user: User | null) => {
          clearTimeout(timeout);
          if (user) {
            this.uid = user.uid;
            sessionStorage.setItem('darling_party_uid', user.uid);
            this.isAnonymousAuthReady = true;
            this.useLocalFallback = false;
            resolve();
          } else {
            try {
              const cred = await signInAnonymously(this.auth!);
              this.uid = cred.user.uid;
              sessionStorage.setItem('darling_party_uid', cred.user.uid);
              this.isAnonymousAuthReady = true;
              this.useLocalFallback = false;
              resolve();
            } catch (authErr) {
              console.warn('Firebase anonymous auth failed, using local multi-tab bridge:', authErr);
              this.useLocalFallback = true;
              if (!this.uid) {
                this.uid = `user_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
                sessionStorage.setItem('darling_party_uid', this.uid);
              }
              resolve();
            }
          }
        });
      });
    } catch (err) {
      console.warn('Firebase initialization error, activating local multi-tab bridge:', err);
      this.useLocalFallback = true;
      if (!this.uid) {
        this.uid = `user_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
        sessionStorage.setItem('darling_party_uid', this.uid);
      }
    }

    return { uid: this.uid!, isFallback: this.useLocalFallback };
  }

  public getUid(): string {
    if (!this.uid) {
      this.uid = (typeof window !== 'undefined' && sessionStorage.getItem('darling_party_uid')) ||
        `user_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      if (typeof window !== 'undefined') sessionStorage.setItem('darling_party_uid', this.uid);
    }
    return this.uid;
  }

  public getActiveRoom(): string | null {
    return this.activeRoomCode;
  }

  public getActiveSeat(): string | null {
    return this.activeSeatId;
  }

  public getIsHost(): boolean {
    return this.isHost;
  }

  /**
   * FEATURE A: Create Party
   * Generates a 6-character code and claims it atomically via transaction.
   */
  public async createRoom(
    title: string,
    hostProfile: { name: string; color: string; gender?: 'Male' | 'Female' },
    initialMedia?: Partial<RoomMedia>
  ): Promise<string> {
    await this.init();
    const uid = this.getUid();
    this.currentUserName = hostProfile.name || 'Host';
    this.currentUserColor = hostProfile.color || '#c8bea9';

    let attempts = 0;
    while (attempts < 5) {
      attempts++;
      const code = generateRoomCode();

      if (this.useLocalFallback || !this.db) {
        this.localBridge.setRoom(code);
        const metaKey = 'meta';
        const existing = this.localBridge.get(metaKey);
        if (existing) continue; // Collision, try next code

        const newMeta: RoomMeta = {
          code,
          title: title || 'A little movie night',
          hostId: uid,
          online: true,
          screening: false,
          createdAt: Date.now()
        };
        this.localBridge.set(metaKey, newMeta);

        const initialMediaData: RoomMedia = {
          id: initialMedia?.id || 'default-cinema',
          title: initialMedia?.title || 'The Quiet Hours',
          kind: initialMedia?.kind || 'stream',
          streamUrl: initialMedia?.streamUrl || '',
          posterPath: initialMedia?.posterPath || '/darling-banner.jpg'
        };
        this.localBridge.set('media', initialMediaData);

        const initialPlayback: RoomPlayback = {
          playing: false,
          time: 0.0,
          rate: 1.0,
          updatedAt: Date.now()
        };
        this.localBridge.set('playback', initialPlayback);

        // Initial empty seats A1-B5
        const initialSeats: RoomSeats = {};
        CINEMA_SEAT_IDS.forEach(sid => { initialSeats[sid] = null; });
        this.localBridge.set('seats', initialSeats);

        // Add host member
        const hostMember: RoomMember = {
          id: uid,
          name: this.currentUserName,
          color: this.currentUserColor,
          seatId: null,
          joinedAt: Date.now(),
          muted: false,
          gender: hostProfile.gender || 'Male'
        };
        this.localBridge.set(`members/${uid}`, hostMember);
        this.localBridge.set('poses', {});
        this.localBridge.set('chat', {});

        // On disconnect cleanup
        this.localBridge.onDisconnect(() => {
          this.leaveRoom();
        });

        this.activeRoomCode = code;
        this.isHost = true;
        this.activeSeatId = null;
        return code;
      }

      // Real Firebase RTDB Transaction
      try {
        const metaRef = ref(this.db, `rooms/${code}/meta`);
        const txnResult = await runTransaction(metaRef, (currentMeta) => {
          if (currentMeta === null) {
            return {
              code,
              title: title || 'A little movie night',
              hostId: uid,
              online: true,
              screening: false,
              createdAt: Date.now()
            };
          }
          return undefined; // Already exists, abort
        });

        if (txnResult.committed) {
          this.activeRoomCode = code;
          this.isHost = true;
          this.activeSeatId = null;

          const initialMediaData: RoomMedia = {
            id: initialMedia?.id || 'default-cinema',
            title: initialMedia?.title || 'The Quiet Hours',
            kind: initialMedia?.kind || 'stream',
            streamUrl: initialMedia?.streamUrl || '',
            posterPath: initialMedia?.posterPath || '/darling-banner.jpg'
          };
          await set(ref(this.db, `rooms/${code}/media`), initialMediaData);

          const initialPlayback: RoomPlayback = {
            playing: false,
            time: 0.0,
            rate: 1.0,
            updatedAt: Date.now()
          };
          await set(ref(this.db, `rooms/${code}/playback`), initialPlayback);

          const initialSeats: RoomSeats = {};
          CINEMA_SEAT_IDS.forEach(sid => { initialSeats[sid] = null; });
          await set(ref(this.db, `rooms/${code}/seats`), initialSeats);

          const hostMember: RoomMember = {
            id: uid,
            name: this.currentUserName,
            color: this.currentUserColor,
            seatId: null,
            joinedAt: Date.now(),
            muted: false,
            gender: hostProfile.gender || 'Male'
          };
          await set(ref(this.db, `rooms/${code}/members/${uid}`), hostMember);

          // Configure presence & onDisconnect
          await onDisconnect(ref(this.db, `rooms/${code}/members/${uid}`)).remove();
          await onDisconnect(ref(this.db, `rooms/${code}/poses/${uid}`)).remove();

          return code;
        }
      } catch (err) {
        console.warn('Firebase transaction failed, switching to local bridge:', err);
        this.useLocalFallback = true;
      }
    }

    throw new Error('Could not generate unique room code. Please try again.');
  }

  /**
   * FEATURE A: Join Party
   * Enforces 10-member limit and attaches onDisconnect hooks.
   */
  public async joinRoom(
    code: string,
    guestProfile: { name: string; color: string; gender?: 'Male' | 'Female' }
  ): Promise<{ success: boolean; error?: string }> {
    await this.init();
    const cleanCode = code.trim().toUpperCase();
    const uid = this.getUid();
    this.currentUserName = guestProfile.name || 'Guest';
    this.currentUserColor = guestProfile.color || '#c8bea9';

    if (this.useLocalFallback || !this.db) {
      this.localBridge.setRoom(cleanCode);
      const meta = this.localBridge.get('meta') as RoomMeta | null;
      if (!meta) {
        return { success: false, error: 'Cinema room not found. Check the 6-character code.' };
      }

      const members = (this.localBridge.get('members') || {}) as Record<string, RoomMember>;
      const memberCount = Object.keys(members).length;
      if (memberCount >= 10 && !members[uid]) {
        return { success: false, error: 'Room is at full capacity (10 / 10 recliners occupied).' };
      }

      const newMember: RoomMember = {
        id: uid,
        name: this.currentUserName,
        color: this.currentUserColor,
        seatId: null,
        joinedAt: Date.now(),
        muted: false,
        gender: guestProfile.gender || 'Male'
      };
      this.localBridge.set(`members/${uid}`, newMember);

      this.localBridge.onDisconnect(() => {
        this.leaveRoom();
      });

      this.activeRoomCode = cleanCode;
      this.isHost = meta.hostId === uid;
      this.activeSeatId = null;

      // Broadcast welcome join message
      this.sendChatMessage(`🎟️ ${this.currentUserName} joined the cinema.`);
      return { success: true };
    }

    // Real Firebase RTDB join
    try {
      const metaSnap = await get(ref(this.db, `rooms/${cleanCode}/meta`));
      if (!metaSnap.exists()) {
        // Check if room exists in local bridge
        this.localBridge.setRoom(cleanCode);
        if (this.localBridge.get('meta')) {
          this.useLocalFallback = true;
          return this.joinRoom(cleanCode, guestProfile);
        }
        return { success: false, error: 'Cinema room not found. Check the 6-character code.' };
      }

      const meta = metaSnap.val() as RoomMeta;
      const membersSnap = await get(ref(this.db, `rooms/${cleanCode}/members`));
      const members = (membersSnap.val() || {}) as Record<string, RoomMember>;
      const memberCount = Object.keys(members).length;

      if (memberCount >= 10 && !members[uid]) {
        return { success: false, error: 'Room is at full capacity (10 / 10 recliners occupied).' };
      }

      const newMember: RoomMember = {
        id: uid,
        name: this.currentUserName,
        color: this.currentUserColor,
        seatId: null,
        joinedAt: Date.now(),
        muted: false,
        gender: guestProfile.gender || 'Male'
      };
      await set(ref(this.db, `rooms/${cleanCode}/members/${uid}`), newMember);

      // OnDisconnect handlers
      await onDisconnect(ref(this.db, `rooms/${cleanCode}/members/${uid}`)).remove();
      await onDisconnect(ref(this.db, `rooms/${cleanCode}/poses/${uid}`)).remove();

      this.activeRoomCode = cleanCode;
      this.isHost = meta.hostId === uid;
      this.activeSeatId = null;

      this.sendChatMessage(`🎟️ ${this.currentUserName} joined the cinema.`);
      return { success: true };
    } catch (err: any) {
      console.warn('Firebase join failed, trying local bridge:', err);
      this.useLocalFallback = true;
      return this.joinRoom(cleanCode, guestProfile);
    }
  }

  /**
   * Leave room and clean up resources and seat reservations.
   */
  public async leaveRoom(): Promise<void> {
    if (!this.activeRoomCode) return;
    const code = this.activeRoomCode;
    const uid = this.getUid();

    // Release seat if held
    if (this.activeSeatId) {
      await this.releaseSeat(this.activeSeatId);
    }

    if (this.useLocalFallback || !this.db) {
      this.localBridge.set(`members/${uid}`, null);
      this.localBridge.set(`poses/${uid}`, null);
      this.localBridge.clearDisconnects();
    } else {
      try {
        await set(ref(this.db, `rooms/${code}/members/${uid}`), null);
        await set(ref(this.db, `rooms/${code}/poses/${uid}`), null);
        await onDisconnect(ref(this.db, `rooms/${code}/members/${uid}`)).cancel();
        await onDisconnect(ref(this.db, `rooms/${code}/poses/${uid}`)).cancel();
      } catch {}
    }

    this.unsubscribeAll();
    this.activeRoomCode = null;
    this.activeSeatId = null;
    this.isHost = false;
  }

  /**
   * FEATURE B: Distributed Recliner Seat Reservation (Mutex)
   * Uses atomic transaction on /rooms/{code}/seats/{seatId}.
   */
  public async claimSeat(seatId: string): Promise<{ success: boolean; reason?: string }> {
    if (!this.activeRoomCode) {
      return { success: false, reason: 'Not connected to a watch party room.' };
    }
    const code = this.activeRoomCode;
    const uid = this.getUid();

    if (this.useLocalFallback || !this.db) {
      const res = this.localBridge.runTransaction(`seats/${seatId}`, (currentOccupant) => {
        if (!currentOccupant || currentOccupant === uid) {
          return uid;
        }
        return undefined; // Mutex locked by someone else
      });

      if (!res.committed || res.snapshot.val() !== uid) {
        return {
          success: false,
          reason: `Seat ${seatId} is already occupied. Choose another recliner.`
        };
      }

      // If user had another seat, free previous seat
      if (this.activeSeatId && this.activeSeatId !== seatId) {
        this.localBridge.set(`seats/${this.activeSeatId}`, null);
      }

      this.activeSeatId = seatId;
      this.localBridge.update(`members/${uid}`, { seatId });
      this.localBridge.onDisconnect(() => {
        this.localBridge.set(`seats/${seatId}`, null);
      });
      return { success: true };
    }

    // Real Firebase RTDB Transaction Mutex
    try {
      const seatRef = ref(this.db, `rooms/${code}/seats/${seatId}`);
      const txn = await runTransaction(seatRef, (currentOccupant) => {
        if (currentOccupant === null || currentOccupant === undefined || currentOccupant === '' || currentOccupant === uid) {
          return uid;
        }
        return undefined; // Already claimed by another user
      });

      if (!txn.committed || txn.snapshot.val() !== uid) {
        return {
          success: false,
          reason: `Seat ${seatId} is already occupied. Choose another recliner.`
        };
      }

      // Free old seat if switching
      if (this.activeSeatId && this.activeSeatId !== seatId) {
        await set(ref(this.db, `rooms/${code}/seats/${this.activeSeatId}`), null);
        await onDisconnect(ref(this.db, `rooms/${code}/seats/${this.activeSeatId}`)).cancel();
      }

      this.activeSeatId = seatId;
      await update(ref(this.db, `rooms/${code}/members/${uid}`), { seatId });
      // Clean up recliner automatically when tab closes
      await onDisconnect(seatRef).set(null);

      return { success: true };
    } catch (err: any) {
      console.warn('claimSeat transaction error:', err);
      return {
        success: false,
        reason: `Seat ${seatId} is already occupied. Choose another recliner.`
      };
    }
  }

  /**
   * FEATURE B: Standing Up - Immediately frees the recliner
   */
  public async releaseSeat(seatId?: string): Promise<void> {
    if (!this.activeRoomCode) return;
    const target = seatId || this.activeSeatId;
    if (!target) return;
    const code = this.activeRoomCode;
    const uid = this.getUid();

    if (this.useLocalFallback || !this.db) {
      const cur = this.localBridge.get(`seats/${target}`);
      if (cur === uid) {
        this.localBridge.set(`seats/${target}`, null);
      }
      this.localBridge.update(`members/${uid}`, { seatId: null });
    } else {
      try {
        const seatRef = ref(this.db, `rooms/${code}/seats/${target}`);
        await set(seatRef, null);
        await onDisconnect(seatRef).cancel();
        await update(ref(this.db, `rooms/${code}/members/${uid}`), { seatId: null });
      } catch (err) {
        console.warn('releaseSeat error:', err);
      }
    }

    if (this.activeSeatId === target) {
      this.activeSeatId = null;
    }
  }

  /**
   * FEATURE D: Throttled Pose Heartbeat (every 110ms)
   */
  public updatePose(pose: PlayerPose): void {
    if (!this.activeRoomCode) return;
    const now = performance.now();
    this.pendingPose = pose;

    if (now - this.lastPoseSentAt >= 110) {
      this.flushPose();
    } else if (!this.poseThrottleTimer) {
      this.poseThrottleTimer = setTimeout(() => {
        this.flushPose();
      }, 110 - (now - this.lastPoseSentAt));
    }
  }

  private flushPose() {
    clearTimeout(this.poseThrottleTimer);
    this.poseThrottleTimer = null;
    if (!this.pendingPose || !this.activeRoomCode) return;

    this.lastPoseSentAt = performance.now();
    const poseToSend = this.pendingPose;
    this.pendingPose = null;
    const uid = this.getUid();
    const code = this.activeRoomCode;

    if (this.useLocalFallback || !this.db) {
      this.localBridge.set(`poses/${uid}`, poseToSend);
    } else {
      set(ref(this.db, `rooms/${code}/poses/${uid}`), poseToSend).catch(() => {});
    }
  }

  /**
   * FEATURE C: Playback Command Sync (Host Authority)
   */
  public async updatePlayback(playback: { playing: boolean; time: number; rate?: number }): Promise<void> {
    if (!this.activeRoomCode || !this.isHost) return;
    const code = this.activeRoomCode;
    const data: RoomPlayback = {
      playing: playback.playing,
      time: playback.time,
      rate: playback.rate ?? 1.0,
      updatedAt: Date.now()
    };

    if (this.useLocalFallback || !this.db) {
      this.localBridge.set('playback', data);
    } else {
      await set(ref(this.db, `rooms/${code}/playback`), data).catch(console.warn);
    }
  }

  /**
   * FEATURE C: Media Change Sync (Host Authority)
   */
  public async updateMedia(media: RoomMedia): Promise<void> {
    if (!this.activeRoomCode || !this.isHost) return;
    const code = this.activeRoomCode;

    if (this.useLocalFallback || !this.db) {
      this.localBridge.set('media', media);
      this.localBridge.set('playback', {
        playing: false,
        time: 0,
        rate: 1.0,
        updatedAt: Date.now()
      });
    } else {
      await set(ref(this.db, `rooms/${code}/media`), media);
      await set(ref(this.db, `rooms/${code}/playback`), {
        playing: false,
        time: 0,
        rate: 1.0,
        updatedAt: Date.now()
      });
    }
  }

  /**
   * FEATURE E: Live In-Room Chat
   */
  public async sendChatMessage(text: string): Promise<void> {
    if (!this.activeRoomCode || !text.trim()) return;
    const code = this.activeRoomCode;
    const cleanText = text.trim().substring(0, 400);

    const message: Omit<ChatMessage, 'id'> = {
      sender: this.currentUserName,
      text: cleanText,
      ts: Date.now(),
      seatId: this.activeSeatId
    };

    if (this.useLocalFallback || !this.db) {
      this.localBridge.push('chat', message);
    } else {
      const chatRef = push(ref(this.db, `rooms/${code}/chat`));
      await set(chatRef, message);
    }
  }

  /**
   * FEATURE E: Global Room Audio Mute (Host Authority)
   */
  public async setMuteRoomAudio(muted: boolean): Promise<void> {
    if (!this.activeRoomCode || !this.isHost) return;
    const code = this.activeRoomCode;

    if (this.useLocalFallback || !this.db) {
      this.localBridge.update('meta', { roomAudioMuted: muted });
    } else {
      await update(ref(this.db, `rooms/${code}/meta`), { roomAudioMuted: muted });
    }
  }

  /**
   * Subscribes to real-time events for the active room.
   */
  public subscribeToRoom(listener: PartyEventListener): () => void {
    if (!this.activeRoomCode) {
      return () => {};
    }
    const code = this.activeRoomCode;

    if (this.useLocalFallback || !this.db) {
      const unsubs = [
        this.localBridge.on('meta', (v) => v && listener.onMeta?.(v)),
        this.localBridge.on('media', (v) => v && listener.onMedia?.(v)),
        this.localBridge.on('playback', (v) => v && listener.onPlayback?.(v)),
        this.localBridge.on('members', (v) => listener.onMembers?.(v || {})),
        this.localBridge.on('seats', (v) => listener.onSeats?.(v || {})),
        this.localBridge.on('poses', (v) => listener.onPoses?.(v || {})),
        this.localBridge.on('chat', (v) => {
          if (!v) {
            listener.onChat?.([]);
            return;
          }
          const list: ChatMessage[] = Object.entries(v).map(([id, item]: [string, any]) => ({
            id,
            ...item
          }));
          list.sort((a, b) => a.ts - b.ts);
          listener.onChat?.(list);
        })
      ];

      const cleanup = () => {
        unsubs.forEach(u => u());
      };
      this.unsubscribers.push(cleanup);
      return cleanup;
    }

    // Real Firebase RTDB listeners
    const metaRef = ref(this.db, `rooms/${code}/meta`);
    const mediaRef = ref(this.db, `rooms/${code}/media`);
    const playbackRef = ref(this.db, `rooms/${code}/playback`);
    const membersRef = ref(this.db, `rooms/${code}/members`);
    const seatsRef = ref(this.db, `rooms/${code}/seats`);
    const posesRef = ref(this.db, `rooms/${code}/poses`);
    const chatRef = ref(this.db, `rooms/${code}/chat`);

    const unsubMeta = onValue(metaRef, (s) => {
      if (s.exists()) listener.onMeta?.(s.val() as RoomMeta);
    });
    const unsubMedia = onValue(mediaRef, (s) => {
      if (s.exists()) listener.onMedia?.(s.val() as RoomMedia);
    });
    const unsubPlayback = onValue(playbackRef, (s) => {
      if (s.exists()) listener.onPlayback?.(s.val() as RoomPlayback);
    });
    const unsubMembers = onValue(membersRef, (s) => {
      listener.onMembers?.((s.val() || {}) as Record<string, RoomMember>);
    });
    const unsubSeats = onValue(seatsRef, (s) => {
      listener.onSeats?.((s.val() || {}) as RoomSeats);
    });
    const unsubPoses = onValue(posesRef, (s) => {
      listener.onPoses?.((s.val() || {}) as Record<string, PlayerPose>);
    });
    const unsubChat = onValue(chatRef, (s) => {
      const val = s.val() || {};
      const list: ChatMessage[] = Object.entries(val).map(([id, item]: [string, any]) => ({
        id,
        ...item
      }));
      list.sort((a, b) => a.ts - b.ts);
      listener.onChat?.(list);
    });

    const cleanup = () => {
      unsubMeta();
      unsubMedia();
      unsubPlayback();
      unsubMembers();
      unsubSeats();
      unsubPoses();
      unsubChat();
    };
    this.unsubscribers.push(cleanup);
    return cleanup;
  }

  private unsubscribeAll() {
    this.unsubscribers.forEach(fn => {
      try { fn(); } catch {}
    });
    this.unsubscribers = [];
  }
}

// Singleton PartyService instance
export const partyService = new PartyService();

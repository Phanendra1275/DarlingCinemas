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
  Unsubscribe,
  remove,
  onChildAdded
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

// Local multi-device & multi-tab fallback bridge (Server API + BroadcastChannel + Cloud Pub/Sub + WebSocket)
class LocalPartyBridge {
  private channel: BroadcastChannel | null = null;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: any = null;
  private roomCode: string | null = null;
  private listeners: Map<string, Set<(val: any) => void>> = new Map();
  private cache: Record<string, any> = {};
  private currentUid: string | null = null;
  private signalListeners: Set<(fromUid: string, signalData: any) => void> = new Set();
  private processedSignals: Set<string> = new Set();
  private processedMsgIds: Set<string> = new Set();
  private pollTimer: any = null;
  private isPolling = false;
  private lastPoseSent = 0;
  private disconnectHandlers: Array<() => void> = [];

  constructor() {
    if (typeof window !== 'undefined') {
      const cachedUid = sessionStorage.getItem('darling_party_uid');
      if (cachedUid) this.currentUid = cachedUid;

      if ('BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('darling_cinema_party_sync');
        this.channel.onmessage = (event) => {
          const data = event.data || {};
          if (data.type === 'SIGNAL') {
            if (data.roomCode === this.roomCode && data.to === this.currentUid) {
              if (data.id && this.processedSignals.has(data.id)) return;
              if (data.id) this.processedSignals.add(data.id);
              this.triggerSignal(data.from, data.signal);
            }
            return;
          }
          const { roomCode, path, value, doc } = data;
          if (roomCode === this.roomCode) {
            if (doc) {
              this.cache = doc;
            }
            this.triggerListeners(path, value);
          }
        };
      }

      // Also listen to window storage event for cross-tab sync
      window.addEventListener('storage', (event) => {
        if (event.key === `dc_room:${this.roomCode}` && event.newValue) {
          try {
            this.cache = JSON.parse(event.newValue);
            this.triggerAllListeners();

            if (this.currentUid && this.cache.signals && this.cache.signals[this.currentUid]) {
              const mySigs = this.cache.signals[this.currentUid];
              for (const [sigId, s] of Object.entries(mySigs)) {
                if (!this.processedSignals.has(sigId)) {
                  this.processedSignals.add(sigId);
                  this.triggerSignal((s as any).from, (s as any).signal);
                }
              }
            }
          } catch {}
        }
      });

      // Handle graceful tab close in local mode
      window.addEventListener('beforeunload', () => {
        this.handleDisconnect();
      });
      window.addEventListener('pagehide', () => {
        this.handleDisconnect();
      });
    }
  }

  public setUid(uid: string) {
    this.currentUid = uid;
  }

  public setRoom(code: string, initialDoc?: Record<string, any>) {
    const clean = code.trim().toUpperCase();
    this.roomCode = clean;
    if (initialDoc) {
      this.writeStorage(initialDoc);
    } else {
      this.cache = this.readStorage();
    }
    this.connectCloudWs();
    this.startServerPoll();
  }

  public getRoom(): string | null {
    return this.roomCode;
  }

  public close() {
    this.stopPolling();
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.roomCode = null;
    this.cache = {};
  }

  public connectCloudWs() {
    if (typeof window === 'undefined' || !this.roomCode) return;
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    try {
      const topic = `dc_party_${encodeURIComponent(this.roomCode)}`;
      const wsUrl = `wss://ntfy.sh/${topic}/ws`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          if (raw.id && this.processedMsgIds.has(raw.id)) return;
          if (raw.id) this.processedMsgIds.add(raw.id);

          if (raw.event === 'message' && raw.message) {
            let payload: any;
            try {
              payload = JSON.parse(raw.message);
            } catch {
              payload = raw.message;
            }
            if (payload && typeof payload === 'object') {
              this.handleCloudMessage(payload);
            }
          }
        } catch (e) {
          console.warn('ws message parse error:', e);
        }
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        if (this.roomCode && this.ws === ws) {
          clearTimeout(this.wsReconnectTimer);
          this.wsReconnectTimer = setTimeout(() => {
            if (this.roomCode) this.connectCloudWs();
          }, 2000);
        }
      };
    } catch (err) {
      console.warn('connectCloudWs error:', err);
    }
  }

  public handleCloudMessage(payload: any) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.senderUid && payload.senderUid === this.currentUid) return;

    const { type } = payload;

    if (type === 'SIGNAL') {
      if (payload.to === this.currentUid) {
        if (payload.id && this.processedSignals.has(payload.id)) return;
        if (payload.id) this.processedSignals.add(payload.id);
        this.triggerSignal(payload.from, payload.signal);
      }
      return;
    }

    if (type === 'INIT_DOC' && payload.doc) {
      this.mergeServerDoc(payload.doc);
      return;
    }

    if (type === 'JOIN_MEMBER' && payload.uid && payload.member) {
      if (!this.cache.members) this.cache.members = {};
      this.cache.members[payload.uid] = payload.member;
      this.writeStorage(this.cache);
      this.triggerListeners('members', this.cache.members);
      this.triggerListeners(`members/${payload.uid}`, payload.member);
      return;
    }

    if (type === 'LEAVE_MEMBER' && payload.uid) {
      if (this.cache.members && this.cache.members[payload.uid]) {
        delete this.cache.members[payload.uid];
        this.writeStorage(this.cache);
        this.triggerListeners('members', this.cache.members);
        this.triggerListeners(`members/${payload.uid}`, null);
      }
      if (this.cache.poses && this.cache.poses[payload.uid]) {
        delete this.cache.poses[payload.uid];
        this.triggerListeners('poses', this.cache.poses);
      }
      return;
    }

    if (type === 'CLAIM_SEAT' && payload.seatId && payload.uid) {
      if (!this.cache.seats) this.cache.seats = {};
      this.cache.seats[payload.seatId] = payload.uid;
      if (this.cache.members && this.cache.members[payload.uid]) {
        this.cache.members[payload.uid].seatId = payload.seatId;
        this.triggerListeners('members', this.cache.members);
      }
      this.writeStorage(this.cache);
      this.triggerListeners('seats', this.cache.seats);
      this.triggerListeners(`seats/${payload.seatId}`, payload.uid);
      return;
    }

    if (type === 'RELEASE_SEAT' && payload.seatId) {
      if (!this.cache.seats) this.cache.seats = {};
      this.cache.seats[payload.seatId] = null;
      if (payload.uid && this.cache.members && this.cache.members[payload.uid]) {
        this.cache.members[payload.uid].seatId = null;
        this.triggerListeners('members', this.cache.members);
      }
      this.writeStorage(this.cache);
      this.triggerListeners('seats', this.cache.seats);
      this.triggerListeners(`seats/${payload.seatId}`, null);
      return;
    }

    if (type === 'PLAYBACK' && payload.playback) {
      this.cache.playback = payload.playback;
      this.writeStorage(this.cache);
      this.triggerListeners('playback', payload.playback);
      return;
    }

    if (type === 'MEDIA' && payload.media) {
      this.cache.media = payload.media;
      this.writeStorage(this.cache);
      this.triggerListeners('media', payload.media);
      return;
    }

    if (type === 'SET' && payload.path !== undefined) {
      const { path, value } = payload;
      this.applyPathToDoc(this.cache, path, value);
      this.writeStorage(this.cache);
      this.triggerListeners(path, value);
      return;
    }

    if (type === 'POSE' && payload.uid && payload.pose) {
      if (!this.cache.poses) this.cache.poses = {};
      this.cache.poses[payload.uid] = payload.pose;
      this.triggerListeners('poses', this.cache.poses);
      return;
    }

    if (type === 'CHAT' && payload.message) {
      const msg = payload.message;
      if (!this.cache.chat) this.cache.chat = {};
      this.cache.chat[msg.id] = msg;
      this.writeStorage(this.cache);
      this.triggerListeners('chat', this.cache.chat);
      return;
    }
  }

  public publishCloud(event: any): void {
    if (typeof window === 'undefined' || !this.roomCode) return;
    const topic = `dc_party_${encodeURIComponent(this.roomCode)}`;
    const payload = {
      ...event,
      senderUid: this.currentUid,
      roomCode: this.roomCode,
      timestamp: Date.now()
    };
    fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      cache: 'no-store'
    }).catch(() => {});
  }

  public async publishCloudAsync(event: any): Promise<boolean> {
    if (typeof window === 'undefined' || !this.roomCode) return false;
    const topic = `dc_party_${encodeURIComponent(this.roomCode)}`;
    const payload = {
      ...event,
      senderUid: this.currentUid,
      roomCode: this.roomCode,
      timestamp: Date.now()
    };
    try {
      const res = await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async fetchFromServer(): Promise<Record<string, any> | null> {
    if (typeof window === 'undefined' || !this.roomCode) return null;

    // 1. Query global cloud relay first so ANY device finds the room
    try {
      const topic = `dc_party_${encodeURIComponent(this.roomCode)}`;
      const cloudRes = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=all`, {
        cache: 'no-store'
      });
      if (cloudRes.ok) {
        const text = await cloudRes.text();
        const lines = text.trim().split('\n').filter(Boolean);
        let cloudDoc: Record<string, any> | null = null;
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.event === 'message' && parsed.message) {
              let msg: any;
              try {
                msg = JSON.parse(parsed.message);
              } catch {
                msg = parsed.message;
              }
              if (msg && msg.type === 'INIT_DOC' && msg.doc) {
                cloudDoc = msg.doc;
              } else if (cloudDoc && msg && msg.type === 'SET' && msg.path) {
                this.applyPathToDoc(cloudDoc, msg.path, msg.value);
              } else if (cloudDoc && msg && msg.type === 'CLAIM_SEAT' && msg.seatId && msg.uid) {
                if (!cloudDoc.seats) cloudDoc.seats = {};
                cloudDoc.seats[msg.seatId] = msg.uid;
              } else if (cloudDoc && msg && msg.type === 'RELEASE_SEAT' && msg.seatId) {
                if (!cloudDoc.seats) cloudDoc.seats = {};
                cloudDoc.seats[msg.seatId] = null;
              }
            }
          } catch {}
        }
        if (cloudDoc && cloudDoc.meta) {
          this.writeStorage(cloudDoc);
          this.triggerAllListeners();
          return cloudDoc;
        }
      }
    } catch (e) {
      console.warn('fetchFromServer cloud relay warning:', e);
    }

    // 2. Query local server API fallback
    try {
      const uid = this.currentUid || (typeof window !== 'undefined' ? sessionStorage.getItem('darling_party_uid') : '') || '';
      const res = await fetch(`/api/party?code=${encodeURIComponent(this.roomCode)}&user=${encodeURIComponent(uid)}`);
      if (res.ok) {
        const data = (await res.json()) as any;
        if (data && data.success && data.doc) {
          this.writeStorage(data.doc);
          this.triggerAllListeners();
          return data.doc;
        }
      }
    } catch (e) {
      console.warn('fetchFromServer local error:', e);
    }
    return null;
  }

  public startServerPoll() {
    this.stopPolling();
    if (typeof window === 'undefined' || !this.roomCode) return;

    const poll = async () => {
      if (!this.roomCode) return;
      if (this.isPolling) return;
      this.isPolling = true;

      try {
        const uid = this.currentUid || (typeof window !== 'undefined' ? sessionStorage.getItem('darling_party_uid') : '') || '';
        const res = await fetch(`/api/party?code=${encodeURIComponent(this.roomCode)}&user=${encodeURIComponent(uid)}`);
        if (res.ok) {
          const data = (await res.json()) as any;
          if (data && data.success && data.doc) {
            this.mergeServerDoc(data.doc);
          }
          if (Array.isArray(data.signals) && data.signals.length > 0) {
            for (const s of data.signals) {
              if (s && s.id && !this.processedSignals.has(s.id)) {
                this.processedSignals.add(s.id);
                this.triggerSignal(s.from, s.data);
              }
            }
          }
        }
      } catch (err) {
        // Network blip, continue polling
      } finally {
        this.isPolling = false;
      }
    };

    setTimeout(poll, 60);
    this.pollTimer = setInterval(poll, 400);
  }

  public stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isPolling = false;
  }

  public mergeServerDoc(serverDoc: Record<string, any>) {
    if (!serverDoc || typeof serverDoc !== 'object') return;
    let changed = false;

    // 1. Meta
    if (serverDoc.meta && JSON.stringify(serverDoc.meta) !== JSON.stringify(this.cache.meta)) {
      this.cache.meta = serverDoc.meta;
      this.triggerListeners('meta', this.cache.meta);
      changed = true;
    }

    // 2. Media
    if (serverDoc.media && JSON.stringify(serverDoc.media) !== JSON.stringify(this.cache.media)) {
      this.cache.media = serverDoc.media;
      this.triggerListeners('media', this.cache.media);
      changed = true;
    }

    // 3. Playback
    if (serverDoc.playback) {
      const curTime = this.cache.playback?.updatedAt || 0;
      const srvTime = serverDoc.playback?.updatedAt || 0;
      if (srvTime >= curTime) {
        if (JSON.stringify(serverDoc.playback) !== JSON.stringify(this.cache.playback)) {
          this.cache.playback = serverDoc.playback;
          this.triggerListeners('playback', this.cache.playback);
          changed = true;
        }
      }
    }

    // 4. Seats
    if (serverDoc.seats && JSON.stringify(serverDoc.seats) !== JSON.stringify(this.cache.seats)) {
      this.cache.seats = serverDoc.seats;
      this.triggerListeners('seats', this.cache.seats);
      changed = true;
    }

    // 5. Members
    if (serverDoc.members && JSON.stringify(serverDoc.members) !== JSON.stringify(this.cache.members)) {
      if (!this.cache.members) this.cache.members = {};
      for (const [mId, mVal] of Object.entries(serverDoc.members)) {
        if (mId !== this.currentUid || !this.cache.members[mId]) {
          this.cache.members[mId] = mVal;
        }
      }
      this.triggerListeners('members', this.cache.members);
      changed = true;
    }

    // 6. Poses
    if (serverDoc.poses) {
      if (!this.cache.poses) this.cache.poses = {};
      let posesChanged = false;
      for (const [pUid, pVal] of Object.entries(serverDoc.poses)) {
        if (pUid !== this.currentUid) {
          this.cache.poses[pUid] = pVal;
          posesChanged = true;
        }
      }
      if (posesChanged) {
        this.triggerListeners('poses', this.cache.poses);
      }
    }

    // 7. Chat
    if (serverDoc.chat && JSON.stringify(serverDoc.chat) !== JSON.stringify(this.cache.chat)) {
      this.cache.chat = { ...(this.cache.chat || {}), ...(serverDoc.chat || {}) };
      this.triggerListeners('chat', this.cache.chat);
      changed = true;
    }

    if (changed) {
      try {
        localStorage.setItem(`dc_room:${this.roomCode}`, JSON.stringify(this.cache));
      } catch {}
    }
  }

  private readStorage(): Record<string, any> {
    if (typeof window === 'undefined' || !this.roomCode) return {};
    try {
      const raw = localStorage.getItem(`dc_room:${this.roomCode}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private writeStorage(doc: Record<string, any>) {
    if (typeof window === 'undefined' || !this.roomCode) return;
    this.cache = doc;
    try {
      localStorage.setItem(`dc_room:${this.roomCode}`, JSON.stringify(doc));
    } catch (e) {
      console.warn('writeStorage failed:', e);
    }
  }

  public applyPathToDoc(doc: Record<string, any>, path: string, value: any): void {
    if (!doc || !path) return;
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return;

    if (parts.length === 1) {
      if (value === null || value === undefined) {
        delete doc[parts[0]];
      } else {
        doc[parts[0]] = value;
      }
      return;
    }

    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cur[part] || typeof cur[part] !== 'object') {
        cur[part] = {};
      }
      cur = cur[part];
    }
    const last = parts[parts.length - 1];
    if (value === null || value === undefined) {
      delete cur[last];
    } else {
      cur[last] = value;
    }
  }

  public get(path?: string): any {
    if (!this.cache || Object.keys(this.cache).length === 0) {
      this.cache = this.readStorage();
    }
    const doc = this.cache;
    if (!path || path === '/' || path === '.') return doc;
    const parts = path.split('/').filter(Boolean);
    let cur: any = doc;
    for (const part of parts) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return null;
      cur = cur[part];
    }
    return cur !== undefined ? cur : null;
  }

  public set(path: string, value: any): void {
    if (typeof window === 'undefined' || !this.roomCode) return;
    const doc = this.readStorage();
    this.applyPathToDoc(doc, path, value);
    this.writeStorage(doc);

    try {
      this.channel?.postMessage({
        type: 'SET',
        roomCode: this.roomCode,
        path,
        value,
        doc
      });
    } catch {}

    this.triggerListeners(path, value);

    // Relay to cloud broker for cross-device synchronization
    if (path.startsWith('poses/')) {
      const now = performance.now();
      if (now - this.lastPoseSent > 100) {
        this.lastPoseSent = now;
        this.publishCloud({
          type: 'POSE',
          uid: this.currentUid,
          pose: value
        });
      }
    } else {
      this.publishCloud({
        type: 'SET',
        path,
        value
      });
    }

    // Local server API sync as secondary fallback
    if (path.startsWith('poses/')) {
      const now = performance.now();
      if (now - this.lastPoseSent > 120) {
        fetch('/api/party', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'set',
            code: this.roomCode,
            path,
            value,
            uid: this.currentUid
          })
        }).catch(() => {});
      }
    } else {
      fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set',
          code: this.roomCode,
          path,
          value,
          uid: this.currentUid
        })
      }).catch(() => {});
    }
  }

  public update(path: string, partial: Record<string, any>): void {
    const cur = this.get(path) || {};
    const updated = { ...cur, ...partial };
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
    const fullItem = { ...item, id };
    this.set(`${path}/${id}`, fullItem);
    if (path === 'chat') {
      this.publishCloud({
        type: 'CHAT',
        message: fullItem
      });
      fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          code: this.roomCode,
          message: fullItem
        })
      }).catch(() => {});
    }
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

  public triggerAllListeners() {
    this.listeners.forEach((set, path) => {
      const val = this.get(path);
      set.forEach(cb => {
        try { cb(val); } catch {}
      });
    });
  }

  private triggerListeners(path: string, value: any) {
    // 1. Direct path listeners (e.g. 'members/uid')
    this.listeners.get(path)?.forEach(cb => {
      try { cb(value); } catch {}
    });

    // 2. Parent path listeners (e.g. 'members' when 'members/uid' updated)
    const parts = path.split('/').filter(Boolean);
    if (parts.length > 1) {
      const parentPath = parts[0];
      const parentVal = this.get(parentPath);
      this.listeners.get(parentPath)?.forEach(cb => {
        try { cb(parentVal); } catch {}
      });
    }

    // 3. Child path listeners (e.g. 'members/uid' when entire 'members' updated)
    this.listeners.forEach((set, listenerPath) => {
      if (listenerPath.startsWith(path + '/')) {
        const childVal = this.get(listenerPath);
        set.forEach(cb => {
          try { cb(childVal); } catch {}
        });
      }
    });
  }

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

  public sendSignal(fromUid: string, toUid: string, signal: any) {
    if (typeof window === 'undefined' || !this.roomCode) return;
    const signalId = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      this.channel?.postMessage({
        type: 'SIGNAL',
        roomCode: this.roomCode,
        id: signalId,
        from: fromUid,
        to: toUid,
        signal
      });
    } catch {}

    const doc = this.readStorage();
    if (!doc.signals) doc.signals = {};
    if (!doc.signals[toUid]) doc.signals[toUid] = {};
    doc.signals[toUid][signalId] = { id: signalId, from: fromUid, signal, timestamp: Date.now() };
    this.writeStorage(doc);

    // Relay to cloud broker for cross-device remote WebRTC signalling
    this.publishCloud({
      type: 'SIGNAL',
      id: signalId,
      from: fromUid,
      to: toUid,
      signal
    });

    // Also relay to local server API
    fetch('/api/party', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'signal',
        code: this.roomCode,
        id: signalId,
        from: fromUid,
        to: toUid,
        signal
      })
    }).catch(() => {});
  }

  public onSignal(callback: (fromUid: string, signalData: any) => void): () => void {
    this.signalListeners.add(callback);
    return () => {
      this.signalListeners.delete(callback);
    };
  }

  public triggerSignal(fromUid: string, signalData: any) {
    this.signalListeners.forEach(cb => {
      try { cb(fromUid, signalData); } catch (e) { console.warn('Signal listener error:', e); }
    });
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

  private cachedMembers: Record<string, RoomMember> = {};
  private cachedMedia: RoomMedia | null = null;
  private signalListeners: Set<(fromUid: string, signalData: any) => void> = new Set();
  private processedSignalIds: Set<string> = new Set();
  private activeSignalsUnsub: (() => void) | null = null;

  private unsubscribers: Array<() => void> = [];
  private roomChangeListeners: Set<(roomCode: string | null) => void> = new Set();

  public onRoomChange(listener: (roomCode: string | null) => void): () => void {
    this.roomChangeListeners.add(listener);
    listener(this.activeRoomCode);
    return () => {
      this.roomChangeListeners.delete(listener);
    };
  }

  private notifyRoomChange(code: string | null) {
    this.activeRoomCode = code;
    this.setupSignalsListener(code);
    this.roomChangeListeners.forEach(cb => {
      try { cb(code); } catch (e) { console.warn('Room change listener error:', e); }
    });
  }

  private setupSignalsListener(code: string | null) {
    if (this.activeSignalsUnsub) {
      this.activeSignalsUnsub();
      this.activeSignalsUnsub = null;
    }
    if (!code) return;

    if (this.db) {
      try {
        const uid = this.getUid();
        const mySignalsRef = ref(this.db, `rooms/${code}/signals/${uid}`);
        const firebaseUnsub = onChildAdded(mySignalsRef, (snap) => {
          const val = snap.val();
          if (val && val.from && val.signal) {
            const sigId = val.id || snap.key;
            if (sigId && this.processedSignalIds.has(sigId)) {
              remove(snap.ref).catch(() => {});
              return;
            }
            if (sigId) this.processedSignalIds.add(sigId);
            this.signalListeners.forEach(cb => {
              try { cb(val.from, val.signal); } catch (e) { console.warn('Signal listener error:', e); }
            });
            remove(snap.ref).catch(() => {});
          }
        });
        this.activeSignalsUnsub = () => firebaseUnsub();
      } catch (err) {
        console.warn('Firebase signals subscription failed:', err);
      }
    }
  }

  constructor() {
    if (typeof window !== 'undefined') {
      // Restore cached UID or establish stable anonymous UID
      const cachedUid = sessionStorage.getItem('darling_party_uid');
      if (cachedUid) {
        this.uid = cachedUid;
        this.localBridge.setUid(cachedUid);
      }
    }
  }

  /**
   * Initializes Firebase App, Auth, and Database.
   * Gracefully falls back to local/server sync if Firebase is offline or unconfigured.
   */
  public async init(): Promise<{ uid: string; isFallback: boolean }> {
    if (typeof window === 'undefined') {
      return { uid: 'ssr-uid', isFallback: true };
    }

    const isDummyFirebase = !process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      firebaseConfig.apiKey.includes('DarlingCinemasKey');

    if (isDummyFirebase) {
      this.useLocalFallback = true;
      const uid = this.getUid();
      this.localBridge.setUid(uid);
      return { uid, isFallback: true };
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
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.useLocalFallback = true;
          if (!this.uid) {
            this.uid = `user_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
            sessionStorage.setItem('darling_party_uid', this.uid);
          }
          resolve();
        }, 1200);

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
              console.warn('Firebase anonymous auth failed, using server bridge:', authErr);
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
      console.warn('Firebase initialization error, activating server bridge:', err);
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
    this.localBridge.setUid(this.uid);
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

  public getMembers(): Record<string, RoomMember> {
    if (this.useLocalFallback || !this.db) {
      return this.localBridge.get('members') || {};
    }
    return this.cachedMembers || {};
  }

  public getCurrentRoomMedia(): RoomMedia | null {
    if (this.useLocalFallback || !this.db) {
      return this.localBridge.get('media') || null;
    }
    return this.cachedMedia;
  }

  public sendSignal(toUid: string, signalData: any): void {
    if (!this.activeRoomCode) return;
    const sigId = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const myUid = this.getUid();

    // 1. Always dispatch via Local Broadcast Bridge for instant multi-tab sync
    this.localBridge.sendSignal(myUid, toUid, signalData);

    // 2. Also dispatch to Firebase RTDB for cross-device remote sync
    if (this.db && !this.useLocalFallback) {
      try {
        const sigRef = push(ref(this.db, `rooms/${this.activeRoomCode}/signals/${toUid}`));
        set(sigRef, {
          id: sigId,
          from: myUid,
          signal: signalData,
          timestamp: Date.now()
        }).catch(() => {});
      } catch (err) {
        console.warn('Firebase sendSignal error:', err);
      }
    }
  }

  public onSignal(callback: (fromUid: string, signalData: any) => void): () => void {
    this.signalListeners.add(callback);
    const localUnsub = this.localBridge.onSignal(callback);

    if (this.activeRoomCode && !this.activeSignalsUnsub) {
      this.setupSignalsListener(this.activeRoomCode);
    }

    return () => {
      this.signalListeners.delete(callback);
      localUnsub();
    };
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

        // Register room on cloud relay & local server so ANY device can find and join it
        const fullDoc = {
          code,
          meta: newMeta,
          media: initialMediaData,
          playback: initialPlayback,
          seats: initialSeats,
          members: { [uid]: hostMember },
          poses: {},
          chat: {}
        };
        await this.localBridge.publishCloudAsync({ type: 'INIT_DOC', doc: fullDoc });

        try {
          await fetch('/api/party', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create_room',
              code,
              doc: fullDoc,
              guestName: this.currentUserName
            })
          });
        } catch (e) {
          console.warn('Failed to register room on server:', e);
        }

        this.isHost = true;
        this.activeSeatId = null;
        this.notifyRoomChange(code);
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
          this.isHost = true;
          this.activeSeatId = null;
          this.notifyRoomChange(code);

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

          // Also register on cloud relay as cross-device fallback
          const fullDoc = {
            code,
            meta: { code, title: title || 'A little movie night', hostId: uid, online: true, screening: false, createdAt: Date.now() },
            media: initialMediaData,
            playback: initialPlayback,
            seats: initialSeats,
            members: { [uid]: hostMember },
            poses: {},
            chat: {}
          };
          this.localBridge.setRoom(code, fullDoc);
          this.localBridge.publishCloudAsync({ type: 'INIT_DOC', doc: fullDoc }).catch(() => {});

          fetch('/api/party', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create_room',
              code,
              doc: fullDoc,
              guestName: this.currentUserName
            })
          }).catch(() => {});

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

    const newMember: RoomMember = {
      id: uid,
      name: this.currentUserName,
      color: this.currentUserColor,
      seatId: null,
      joinedAt: Date.now(),
      muted: false,
      gender: guestProfile.gender || 'Male'
    };

    if (this.useLocalFallback || !this.db) {
      this.localBridge.setRoom(cleanCode);
      let meta = this.localBridge.get('meta') as RoomMeta | null;
      if (!meta) {
        // Query cloud relay / server for room created on another device
        // Retry up to 3 times to accommodate initial network handshake
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) {
            await new Promise(r => setTimeout(r, 400));
          }
          const serverDoc = await this.localBridge.fetchFromServer();
          if (serverDoc && serverDoc.meta) {
            meta = serverDoc.meta as RoomMeta;
            break;
          }
        }
      }

      if (!meta) {
        return { success: false, error: 'Cinema room not found. Check the 6-character code.' };
      }

      const members = (this.localBridge.get('members') || {}) as Record<string, RoomMember>;
      const memberCount = Object.keys(members).length;
      if (memberCount >= 10 && !members[uid]) {
        return { success: false, error: 'Room is at full capacity (10 / 10 recliners occupied).' };
      }

      this.localBridge.set(`members/${uid}`, newMember);
      await this.localBridge.publishCloudAsync({
        type: 'JOIN_MEMBER',
        uid,
        member: newMember
      });

      // Register join with server so host sees the guest on their screen
      try {
        await fetch('/api/party', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join_room',
            code: cleanCode,
            uid,
            guestName: this.currentUserName,
            member: newMember
          })
        });
      } catch (err) {
        console.warn('Could not register join on server:', err);
      }

      this.localBridge.onDisconnect(() => {
        this.leaveRoom();
      });

      this.isHost = meta.hostId === uid;
      this.activeSeatId = null;
      this.notifyRoomChange(cleanCode);

      // Broadcast welcome join message
      this.sendChatMessage(`🎟️ ${this.currentUserName} joined the cinema.`);
      return { success: true };
    }

    // Real Firebase RTDB join
    try {
      const metaSnap = await get(ref(this.db, `rooms/${cleanCode}/meta`));
      if (!metaSnap.exists()) {
        // Check if room exists in cloud relay or local bridge
        this.localBridge.setRoom(cleanCode);
        const serverDoc = await this.localBridge.fetchFromServer();
        if (serverDoc || this.localBridge.get('meta')) {
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

      await set(ref(this.db, `rooms/${cleanCode}/members/${uid}`), newMember);

      // OnDisconnect handlers
      await onDisconnect(ref(this.db, `rooms/${cleanCode}/members/${uid}`)).remove();
      await onDisconnect(ref(this.db, `rooms/${cleanCode}/poses/${uid}`)).remove();

      this.isHost = meta.hostId === uid;
      this.activeSeatId = null;
      this.notifyRoomChange(cleanCode);

      this.sendChatMessage(`🎟️ ${this.currentUserName} joined the cinema.`);
      return { success: true };
    } catch (err: any) {
      console.warn('Firebase join failed, trying server/local bridge:', err);
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
      this.localBridge.publishCloud({
        type: 'LEAVE_MEMBER',
        uid
      });

      fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'leave',
          code,
          uid
        })
      }).catch(() => {});

      this.localBridge.set(`members/${uid}`, null);
      this.localBridge.set(`poses/${uid}`, null);
      this.localBridge.clearDisconnects();
      this.localBridge.close();
    } else {
      try {
        await set(ref(this.db, `rooms/${code}/members/${uid}`), null);
        await set(ref(this.db, `rooms/${code}/poses/${uid}`), null);
        await onDisconnect(ref(this.db, `rooms/${code}/members/${uid}`)).cancel();
        await onDisconnect(ref(this.db, `rooms/${code}/poses/${uid}`)).cancel();
      } catch {}
    }

    this.unsubscribeAll();
    this.activeSeatId = null;
    this.isHost = false;
    this.notifyRoomChange(null);
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
      // 1. Claim on server atomically
      try {
        const sRes = await fetch('/api/party', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'claim_seat',
            code,
            seatId,
            uid
          })
        });
        const sData = (await sRes.json()) as any;
        if (sData && !sData.success) {
          return {
            success: false,
            reason: sData.reason || `Seat ${seatId} is already occupied. Choose another recliner.`
          };
        }
      } catch (err) {
        console.warn('Server claim_seat check error:', err);
      }

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
        this.localBridge.publishCloud({
          type: 'RELEASE_SEAT',
          seatId: this.activeSeatId,
          uid
        });
      }

      this.activeSeatId = seatId;
      this.localBridge.update(`members/${uid}`, { seatId });
      this.localBridge.publishCloud({
        type: 'CLAIM_SEAT',
        seatId,
        uid
      });
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
      this.localBridge.publishCloud({
        type: 'RELEASE_SEAT',
        seatId: target,
        uid
      });

      fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'release_seat',
          code,
          seatId: target,
          uid
        })
      }).catch(() => {});
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
      this.localBridge.publishCloud({
        type: 'PLAYBACK',
        playback: data
      });
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
      const resetPlayback = {
        playing: false,
        time: 0,
        rate: 1.0,
        updatedAt: Date.now()
      };
      this.localBridge.set('media', media);
      this.localBridge.set('playback', resetPlayback);
      this.localBridge.publishCloud({
        type: 'MEDIA',
        media
      });
      this.localBridge.publishCloud({
        type: 'PLAYBACK',
        playback: resetPlayback
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
        this.localBridge.on('media', (v) => {
          this.cachedMedia = v || null;
          if (v) listener.onMedia?.(v);
        }),
        this.localBridge.on('playback', (v) => v && listener.onPlayback?.(v)),
        this.localBridge.on('members', (v) => {
          this.cachedMembers = v || {};
          listener.onMembers?.(this.cachedMembers);
        }),
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
      if (s.exists()) {
        const val = s.val() as RoomMedia;
        this.cachedMedia = val;
        listener.onMedia?.(val);
      }
    });
    const unsubPlayback = onValue(playbackRef, (s) => {
      if (s.exists()) listener.onPlayback?.(s.val() as RoomPlayback);
    });
    const unsubMembers = onValue(membersRef, (s) => {
      const val = (s.val() || {}) as Record<string, RoomMember>;
      this.cachedMembers = val;
      listener.onMembers?.(val);
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

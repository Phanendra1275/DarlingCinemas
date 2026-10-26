import { NextResponse } from 'next/server';

// Global state persisting across requests and hot reloads
const globalRooms = global as any;
if (!globalRooms.watchParties) {
  globalRooms.watchParties = new Map<string, RoomState>();
}

export type Signal = {
  id: string;
  to: string;
  from: string;
  data: any;
  timestamp: number;
};

export type PartyMember = {
  name: string;
  jacket: string;
  gender: 'Male' | 'Female';
  seat: string | null;
  position?: { x: number; y: number; z: number };
  rotation?: number;
  isWalking?: boolean;
  lastSeen: number;
};

export type ChatMessage = {
  id: string;
  from: string;
  seat: string | null;
  text: string;
  emoji?: string;
  timestamp: number;
};

export type PartyReaction = {
  id: string;
  from: string;
  seat: string | null;
  emoji: string;
  timestamp: number;
};

export type RoomState = {
  code: string;
  host: string;
  guests: string[];
  members: Record<string, any>;
  videoUrl: string;
  isPlaying: boolean;
  currentTime: number;
  lastUpdate: number;
  createdAt: number;
  signals: Signal[];
  messages: ChatMessage[];
  reactions: PartyReaction[];
  doc?: any; // Full cinema document (meta, media, playback, seats, members, poses, chat)
};

const rooms: Map<string, RoomState> = globalRooms.watchParties;

// Housekeeping: Keep rooms alive for 24 hours. Member inactive grace period: 5 minutes.
function pruneRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    // Expire room only if completely untouched for 24 hours
    if (now - room.lastUpdate > 24 * 60 * 60 * 1000) {
      rooms.delete(code);
      continue;
    }

    // Clean up members inactive for more than 5 minutes (300,000 ms)
    for (const [name, member] of Object.entries(room.members)) {
      if (name !== room.host && now - (member.lastSeen || 0) > 300000) {
        delete room.members[name];
        room.guests = room.guests.filter(g => g !== name);
        if (room.doc && room.doc.members) {
          delete room.doc.members[name];
        }
      }
    }

    // Keep only signals from the last 60 seconds
    room.signals = room.signals.filter(s => now - s.timestamp < 60000);

    // Keep reactions from the last 15 seconds
    room.reactions = room.reactions.filter(r => now - r.timestamp < 15000);
  }
}

export async function GET(req: Request) {
  try {
    pruneRooms();
    const url = new URL(req.url);
    const rawCode = url.searchParams.get('code');
    const user = url.searchParams.get('user');
    
    if (!rawCode) {
      return NextResponse.json({ error: 'Room code required' }, { status: 400 });
    }

    const code = rawCode.trim().toUpperCase();
    
    if (!rooms.has(code)) {
      return NextResponse.json({ success: false, error: 'Cinema room not found. Check the 6-character code.' }, { status: 404 });
    }
    
    const room = rooms.get(code)!;
    room.lastUpdate = Date.now();
    
    // Refresh user's lastSeen timestamp
    if (user) {
      if (room.members[user]) {
        room.members[user].lastSeen = Date.now();
      }
      if (room.doc && room.doc.members && room.doc.members[user]) {
        room.doc.members[user].lastSeen = Date.now();
      }
    }

    // Return signals targeted for this user, and drain them from the queue
    let userSignals: Signal[] = [];
    if (user) {
      userSignals = room.signals.filter(s => s.to === user);
      // Remove delivered signals to prevent duplicate delivery
      room.signals = room.signals.filter(s => s.to !== user);
    }

    const now = Date.now();
    const recentReactions = room.reactions.filter(r => now - r.timestamp < 8000);

    return NextResponse.json({
      success: true,
      code: room.code,
      host: room.host,
      doc: room.doc || null,
      guests: room.guests,
      videoUrl: room.videoUrl,
      isPlaying: room.isPlaying,
      currentTime: room.currentTime,
      lastUpdate: room.lastUpdate,
      signals: userSignals,
      reactions: recentReactions,
      members: (room.doc && room.doc.members) || room.members,
      messages: (room.doc && room.doc.chat) || room.messages.slice(-60),
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    pruneRooms();
    const body = (await req.json()) as any;
    const { action, code: rawCode, state, guestName, memberData, message, reaction, doc, member, seatId, uid, partial, path, value, to, from, signal } = body;
    const cleanCode = (rawCode || (doc && doc.code) || '').trim().toUpperCase();

    // 1. Create room
    if (action === 'create' || action === 'create_room') {
      const finalCode = cleanCode || Math.floor(100000 + Math.random() * 900000).toString();
      const hostName = (doc?.members && Object.values(doc.members)[0] as any)?.name || guestName || 'Host';

      const initialDoc = doc || {
        code: finalCode,
        meta: {
          code: finalCode,
          title: 'A little movie night',
          hostId: hostName,
          online: true,
          screening: false,
          createdAt: Date.now()
        },
        media: {
          id: 'default-cinema',
          title: 'The Quiet Hours',
          kind: 'stream',
          streamUrl: '',
          posterPath: '/darling-banner.jpg'
        },
        playback: {
          playing: false,
          time: 0,
          rate: 1.0,
          updatedAt: Date.now()
        },
        seats: {},
        members: {},
        poses: {},
        chat: {},
        signals: {}
      };

      const newRoom: RoomState = {
        code: finalCode,
        host: hostName,
        guests: [],
        members: initialDoc.members || {},
        videoUrl: initialDoc.media?.streamUrl || '',
        isPlaying: !!initialDoc.playback?.playing,
        currentTime: initialDoc.playback?.time || 0,
        lastUpdate: Date.now(),
        createdAt: Date.now(),
        signals: [],
        messages: [],
        reactions: [],
        doc: initialDoc
      };

      rooms.set(finalCode, newRoom);
      return NextResponse.json({ success: true, code: finalCode, doc: initialDoc, assignedName: hostName });
    }
    
    if (!cleanCode || !rooms.has(cleanCode)) {
      return NextResponse.json({ success: false, error: 'Cinema room not found. Check the 6-character code.' }, { status: 404 });
    }
    
    const room = rooms.get(cleanCode)!;
    room.lastUpdate = Date.now();

    // 2. Join room (full document support)
    if (action === 'join_room' || action === 'join') {
      const finalMember = member || {
        id: uid || guestName || 'Guest',
        name: guestName || memberData?.name || 'Guest',
        color: memberData?.jacket || memberData?.color || '#803747',
        gender: memberData?.gender || 'Male',
        seatId: memberData?.seat || null,
        joinedAt: Date.now(),
        muted: false,
        lastSeen: Date.now()
      };

      if (!room.doc) room.doc = {};
      if (!room.doc.members) room.doc.members = {};
      room.doc.members[finalMember.id] = finalMember;
      room.members[finalMember.id] = finalMember;
      if (finalMember.name && finalMember.name !== room.host && !room.guests.includes(finalMember.name)) {
        room.guests.push(finalMember.name);
      }

      // Add system announcement
      const joinMsg: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        from: 'System',
        seat: finalMember.seatId || null,
        text: `🎟️ ${finalMember.name} joined the cinema room.`,
        timestamp: Date.now()
      };
      room.messages.push(joinMsg);
      if (!room.doc.chat) room.doc.chat = {};
      room.doc.chat[joinMsg.id] = joinMsg;

      return NextResponse.json({ success: true, doc: room.doc, assignedName: finalMember.name });
    }

    // 3. Sync full document or partial updates
    if (action === 'sync_doc') {
      if (doc) {
        room.doc = { ...room.doc, ...doc };
        if (doc.media?.streamUrl !== undefined) room.videoUrl = doc.media.streamUrl;
        if (doc.playback) {
          room.isPlaying = !!doc.playback.playing;
          room.currentTime = doc.playback.time || 0;
        }
      }
      return NextResponse.json({ success: true, doc: room.doc });
    }

    // 4. Update specific path or partial
    if (action === 'set' && path !== undefined) {
      if (!room.doc) room.doc = {};
      const parts = path.split('/').filter(Boolean);
      if (parts.length > 0) {
        let cur = room.doc;
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
      if (path === 'playback' && value) {
        room.isPlaying = !!value.playing;
        room.currentTime = value.time || 0;
      }
      if (path === 'media' && value && value.streamUrl !== undefined) {
        room.videoUrl = value.streamUrl;
      }
      return NextResponse.json({ success: true, doc: room.doc });
    }

    if (action === 'update') {
      if (state) {
        if (state.videoUrl !== undefined) room.videoUrl = state.videoUrl;
        if (state.isPlaying !== undefined) room.isPlaying = state.isPlaying;
        if (state.currentTime !== undefined) room.currentTime = state.currentTime;
      }
      if (partial && room.doc) {
        if (path) {
          room.doc[path] = { ...(room.doc[path] || {}), ...partial };
        } else {
          room.doc = { ...room.doc, ...partial };
        }
      }
      return NextResponse.json({ success: true, doc: room.doc });
    }

    // 5. Seat reservation mutex
    if (action === 'claim_seat') {
      if (!room.doc) room.doc = {};
      if (!room.doc.seats) room.doc.seats = {};
      const currentOccupant = room.doc.seats[seatId];
      if (currentOccupant && currentOccupant !== uid) {
        return NextResponse.json({ success: false, reason: `Seat ${seatId} is already occupied. Choose another recliner.` });
      }
      room.doc.seats[seatId] = uid;
      if (room.doc.members && room.doc.members[uid]) {
        room.doc.members[uid].seatId = seatId;
      }
      return NextResponse.json({ success: true, seats: room.doc.seats });
    }

    if (action === 'release_seat') {
      if (room.doc && room.doc.seats && room.doc.seats[seatId] === uid) {
        room.doc.seats[seatId] = null;
      }
      if (room.doc && room.doc.members && room.doc.members[uid]) {
        room.doc.members[uid].seatId = null;
      }
      return NextResponse.json({ success: true, seats: room.doc?.seats || {} });
    }

    // 6. WebRTC signal exchange
    if (action === 'signal') {
      const targetTo = to || body.toUid;
      const targetFrom = from || guestName || body.fromUid || 'Peer';
      const sigData = signal || body.signalData || body.data;
      const sigId = body.id || `sig-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      
      room.signals.push({
        id: sigId,
        to: targetTo,
        from: targetFrom,
        data: sigData,
        timestamp: Date.now()
      });
      return NextResponse.json({ success: true, id: sigId });
    }

    // 7. Live In-Room Chat
    if (action === 'chat') {
      if (message && message.text) {
        const msgId = message.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const newMsg: ChatMessage = {
          id: msgId,
          from: guestName || message.sender || 'Guest',
          seat: message.seatId || message.seat || null,
          text: message.text.trim().substring(0, 400),
          emoji: message.emoji,
          timestamp: Date.now(),
        };
        room.messages.push(newMsg);
        if (room.messages.length > 80) room.messages.shift();
        if (!room.doc) room.doc = {};
        if (!room.doc.chat) room.doc.chat = {};
        room.doc.chat[msgId] = newMsg;
      }
      return NextResponse.json({ success: true });
    }

    // 8. Reactions
    if (action === 'reaction') {
      if (reaction && reaction.emoji) {
        const newReaction: PartyReaction = {
          id: `react-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          from: guestName || 'Guest',
          seat: reaction.seat || null,
          emoji: reaction.emoji,
          timestamp: Date.now(),
        };
        room.reactions.push(newReaction);
        if (room.reactions.length > 40) room.reactions.shift();
      }
      return NextResponse.json({ success: true });
    }

    // 9. Leave Room
    if (action === 'leave') {
      const userToLeave = uid || guestName;
      if (userToLeave) {
        if (room.doc && room.doc.members) delete room.doc.members[userToLeave];
        delete room.members[userToLeave];
        room.guests = room.guests.filter(g => g !== userToLeave);
        // Free any held seat
        if (room.doc && room.doc.seats) {
          for (const [sId, occ] of Object.entries(room.doc.seats)) {
            if (occ === userToLeave) room.doc.seats[sId] = null;
          }
        }
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}

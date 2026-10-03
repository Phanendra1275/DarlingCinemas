import { NextResponse } from 'next/server';

// Use a global variable to persist state in development across hot reloads
const globalRooms = global as any;
if (!globalRooms.watchParties) {
  globalRooms.watchParties = new Map();
}

export type Signal = {
  to: string;
  from: string;
  data: any;
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
  host: string;
  guests: string[];
  members: Record<string, PartyMember>;
  videoUrl: string;
  isPlaying: boolean;
  currentTime: number;
  lastUpdate: number;
  signals: Signal[];
  messages: ChatMessage[];
  reactions: PartyReaction[];
};

const rooms: Map<string, RoomState> = globalRooms.watchParties;

// Prune inactive members older than 15 seconds
function cleanupInactiveMembers(room: RoomState) {
  const now = Date.now();
  for (const [name, member] of Object.entries(room.members)) {
    if (name !== room.host && now - member.lastSeen > 15000) {
      delete room.members[name];
      room.guests = room.guests.filter(g => g !== name);
    }
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const user = url.searchParams.get('user');
  
  if (!code || !rooms.has(code)) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }
  
  const room = rooms.get(code)!;
  cleanupInactiveMembers(room);
  
  // Touch user's lastSeen if present
  if (user && room.members[user]) {
    room.members[user].lastSeen = Date.now();
  }

  // Extract signals meant for this user
  let userSignals: Signal[] = [];
  if (user) {
    userSignals = room.signals.filter(s => s.to === user);
    room.signals = room.signals.filter(s => s.to !== user); // Consume signals
  }

  // Only keep recent reactions from the last 6 seconds
  const now = Date.now();
  const recentReactions = room.reactions.filter(r => now - r.timestamp < 6000);

  return NextResponse.json({
    ...room,
    signals: userSignals,
    reactions: recentReactions,
    members: room.members,
    messages: room.messages.slice(-50), // Last 50 messages
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, code, state, guestName, memberData, message, reaction } = body as any;
    
    if (action === 'create') {
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      const hostName = guestName || 'Host';
      const initialMember: PartyMember = {
        name: hostName,
        jacket: memberData?.jacket || '#d6cdb4',
        gender: memberData?.gender || 'Male',
        seat: memberData?.seat || null,
        position: memberData?.position || { x: 6.45, y: 0.32, z: 5.9 },
        rotation: memberData?.rotation || 0,
        isWalking: false,
        lastSeen: Date.now(),
      };

      rooms.set(newCode, {
        host: hostName,
        guests: [],
        members: { [hostName]: initialMember },
        videoUrl: '',
        isPlaying: false,
        currentTime: 0,
        lastUpdate: Date.now(),
        signals: [],
        messages: [
          {
            id: `sys-${Date.now()}`,
            from: 'System',
            seat: null,
            text: `Welcome to Darling Cinemas private screen! Room Code: ${newCode}`,
            timestamp: Date.now(),
          }
        ],
        reactions: [],
      });
      return NextResponse.json({ code: newCode, assignedName: hostName });
    }
    
    if (!code || !rooms.has(code)) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }
    
    const room = rooms.get(code)!;

    if (action === 'join') {
      let finalName = guestName || 'Guest';
      while (room.host === finalName || room.guests.includes(finalName)) {
        finalName = `${guestName} ${Math.floor(Math.random() * 1000)}`;
      }
      
      if (!room.guests.includes(finalName)) {
        room.guests.push(finalName);
      }

      room.members[finalName] = {
        name: finalName,
        jacket: memberData?.jacket || '#803747',
        gender: memberData?.gender || 'Male',
        seat: memberData?.seat || null,
        position: memberData?.position || { x: 6.45, y: 0.32, z: 5.9 },
        rotation: memberData?.rotation || 0,
        isWalking: false,
        lastSeen: Date.now(),
      };

      // Add join announcement to chat
      room.messages.push({
        id: `sys-${Date.now()}`,
        from: 'System',
        seat: null,
        text: `${finalName} joined the cinema room.`,
        timestamp: Date.now(),
      });

      return NextResponse.json({ ...room, assignedName: finalName });
    }
    
    if (action === 'update') {
      if (state) {
        if (state.videoUrl !== undefined) room.videoUrl = state.videoUrl;
        if (state.isPlaying !== undefined) room.isPlaying = state.isPlaying;
        if (state.currentTime !== undefined) room.currentTime = state.currentTime;
      }
      room.lastUpdate = Date.now();
      return NextResponse.json(room);
    }

    if (action === 'update_member') {
      const user = guestName;
      if (user) {
        if (!room.members[user]) {
          room.members[user] = {
            name: user,
            jacket: memberData?.jacket || '#d6cdb4',
            gender: memberData?.gender || 'Male',
            seat: null,
            lastSeen: Date.now(),
          };
        }
        if (memberData) {
          if (memberData.seat !== undefined) room.members[user].seat = memberData.seat;
          if (memberData.position !== undefined) room.members[user].position = memberData.position;
          if (memberData.rotation !== undefined) room.members[user].rotation = memberData.rotation;
          if (memberData.isWalking !== undefined) room.members[user].isWalking = memberData.isWalking;
          if (memberData.jacket !== undefined) room.members[user].jacket = memberData.jacket;
          if (memberData.gender !== undefined) room.members[user].gender = memberData.gender;
        }
        room.members[user].lastSeen = Date.now();
      }
      return NextResponse.json({ success: true, members: room.members });
    }

    if (action === 'chat') {
      if (message && message.text) {
        const newMsg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          from: guestName || 'Guest',
          seat: message.seat || null,
          text: message.text.trim().substring(0, 300),
          emoji: message.emoji,
          timestamp: Date.now(),
        };
        room.messages.push(newMsg);
        if (room.messages.length > 60) room.messages.shift();
      }
      return NextResponse.json({ success: true });
    }

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
        if (room.reactions.length > 30) room.reactions.shift();
      }
      return NextResponse.json({ success: true });
    }
    
    if (action === 'signal') {
      const { to, data } = body as any;
      room.signals.push({ to, from: guestName, data });
      return NextResponse.json({ success: true });
    }

    if (action === 'leave') {
      if (guestName === room.host) {
        // Close room if host leaves
        rooms.delete(code);
      } else {
        room.guests = room.guests.filter(g => g !== guestName);
        delete room.members[guestName];
        room.messages.push({
          id: `sys-${Date.now()}`,
          from: 'System',
          seat: null,
          text: `${guestName} left the cinema.`,
          timestamp: Date.now(),
        });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}

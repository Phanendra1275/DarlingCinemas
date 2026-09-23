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

export type RoomState = {
  host: string;
  guests: string[];
  videoUrl: string;
  isPlaying: boolean;
  currentTime: number;
  lastUpdate: number;
  signals: Signal[];
};

const rooms: Map<string, RoomState> = globalRooms.watchParties;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const user = url.searchParams.get('user');
  
  if (!code || !rooms.has(code)) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }
  
  const room = rooms.get(code)!;
  
  // Extract signals meant for this user
  let userSignals: Signal[] = [];
  if (user) {
    userSignals = room.signals.filter(s => s.to === user);
    room.signals = room.signals.filter(s => s.to !== user); // Consume signals
  }

  return NextResponse.json({ ...room, signals: userSignals });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, code, state, guestName } = body;
    
    if (action === 'create') {
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      rooms.set(newCode, {
        host: guestName || 'Host',
        guests: [],
        videoUrl: '',
        isPlaying: false,
        currentTime: 0,
        lastUpdate: Date.now(),
        signals: []
      });
      return NextResponse.json({ code: newCode });
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
      return NextResponse.json({ ...room, assignedName: finalName });
    }
    
    if (action === 'update') {
      if (state.videoUrl !== undefined) room.videoUrl = state.videoUrl;
      if (state.isPlaying !== undefined) room.isPlaying = state.isPlaying;
      if (state.currentTime !== undefined) room.currentTime = state.currentTime;
      room.lastUpdate = Date.now();
      
      return NextResponse.json(room);
    }
    
    if (action === 'signal') {
      const { to, data } = body;
      room.signals.push({ to, from: guestName, data });
      return NextResponse.json({ success: true });
    }

    if (action === 'leave') {
      if (guestName === room.host) {
        // Optional: End room if host leaves
        rooms.delete(code);
      } else {
        room.guests = room.guests.filter(g => g !== guestName);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}

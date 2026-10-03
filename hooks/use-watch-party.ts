import { useState, useEffect, useRef, useCallback } from 'react';
import type { PartyMember, ChatMessage, PartyReaction, RoomState, Signal } from '../app/api/party/route';

export type { PartyMember, ChatMessage, PartyReaction };

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

const STORAGE_ROOM_KEY = 'darling_active_party_code';
const STORAGE_HOST_KEY = 'darling_active_party_is_host';

export function useWatchParty(media: any, userName: string) {
  const [partyCode, setPartyCode] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(STORAGE_ROOM_KEY) || null;
    }
    return null;
  });
  const [isHost, setIsHost] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(STORAGE_HOST_KEY) === 'true';
    }
    return false;
  });
  const [guests, setGuests] = useState<string[]>([]);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [hostName, setHostName] = useState<string>('');
  const [hostVideoUrl, setHostVideoUrl] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<PartyReaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const mediaRef = useRef(media);
  useEffect(() => { mediaRef.current = media; }, [media]);

  const assignedName = useRef(userName);
  useEffect(() => {
    if (!partyCode) assignedName.current = userName;
  }, [userName, partyCode]);

  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const candidateQueue = useRef<Map<string, any[]>>(new Map());
  const processedSignals = useRef<Set<string>>(new Set());
  const consecutiveErrors = useRef<number>(0);

  const myPresenceRef = useRef<{
    seat: string | null;
    jacket?: string;
    gender?: 'Male' | 'Female';
    position?: { x: number; y: number; z: number };
    rotation?: number;
    isWalking?: boolean;
  }>({ seat: null });

  // Update session storage whenever partyCode changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (partyCode) {
        sessionStorage.setItem(STORAGE_ROOM_KEY, partyCode);
        sessionStorage.setItem(STORAGE_HOST_KEY, isHost ? 'true' : 'false');
      } else {
        sessionStorage.removeItem(STORAGE_ROOM_KEY);
        sessionStorage.removeItem(STORAGE_HOST_KEY);
      }
    }
  }, [partyCode, isHost]);

  const sendSignal = async (to: string, data: any) => {
    if (!partyCode) return;
    try {
      await fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signal', code: partyCode, guestName: assignedName.current, to, data })
      });
    } catch {}
  };

  const createPeerConnection = (peerName: string) => {
    // Close existing connection to peer if any
    const existing = pcs.current.get(peerName);
    if (existing) {
      try { existing.close(); } catch {}
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(peerName, { candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Soft cleanup
        pcs.current.delete(peerName);
      }
    };

    if (!isHost) {
      pc.ontrack = (event) => {
        const m = mediaRef.current;
        if (event.streams && event.streams[0]) {
          const stream = event.streams[0];
          if (m) {
            if (m.loadStream) {
              m.loadStream(stream, 'Host Cinema Screen');
            } else if (m.videoElement) {
              m.videoElement.srcObject = stream;
              m.videoElement.play().catch(() => {});
            }
          }
        }
      };
    }

    pcs.current.set(peerName, pc);
    return pc;
  };

  const createParty = async (profile?: { jacket?: string; gender?: 'Male' | 'Female'; seat?: string | null }) => {
    try {
      const res = await fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          guestName: userName,
          memberData: {
            jacket: profile?.jacket || '#d6cdb4',
            gender: profile?.gender || 'Male',
            seat: profile?.seat || null,
          }
        }),
      });
      const data = await res.json() as any;
      if (data.code) {
        setPartyCode(data.code);
        setIsHost(true);
        assignedName.current = data.assignedName || userName;
        setHostName(data.assignedName || userName);
        setGuests([]);
        setMembers([]);
        setMessages([]);
        setReactions([]);
        setError(null);
        consecutiveErrors.current = 0;
        processedSignals.current.clear();
        pcs.current.forEach(pc => pc.close());
        pcs.current.clear();
        candidateQueue.current.clear();
        return data.code;
      }
    } catch (err) {
      setError('Failed to create watch party.');
    }
    return null;
  };

  const joinParty = async (code: string, profile?: { jacket?: string; gender?: 'Male' | 'Female'; seat?: string | null }) => {
    try {
      const cleanCode = code.trim();
      const res = await fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join',
          code: cleanCode,
          guestName: userName,
          memberData: {
            jacket: profile?.jacket || '#803747',
            gender: profile?.gender || 'Male',
            seat: profile?.seat || null,
          }
        }),
      });
      if (res.ok) {
        const data = await res.json() as any;
        setPartyCode(cleanCode);
        setIsHost(false);
        assignedName.current = data.assignedName || userName;
        setHostName(data.host);
        setGuests(data.guests || []);
        if (data.members) {
          const remoteList = Object.values(data.members as Record<string, PartyMember>)
            .filter(m => m.name !== (data.assignedName || userName));
          setMembers(remoteList);
        }
        if (data.messages) setMessages(data.messages);
        setError(null);
        consecutiveErrors.current = 0;
        processedSignals.current.clear();
        pcs.current.forEach(pc => pc.close());
        pcs.current.clear();
        candidateQueue.current.clear();
        syncMediaToState(data);
        return true;
      } else {
        setError('Room not found or code invalid.');
      }
    } catch (err) {
      setError('Failed to join watch party.');
    }
    return false;
  };

  const leaveParty = async () => {
    if (partyCode) {
      await fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave', code: partyCode, guestName: assignedName.current }),
      }).catch(() => {});
    }
    setPartyCode(null);
    setIsHost(false);
    setMembers([]);
    setMessages([]);
    setReactions([]);
    processedSignals.current.clear();
    pcs.current.forEach(pc => pc.close());
    pcs.current.clear();
    candidateQueue.current.clear();
  };

  const updateMyPresence = useCallback((presence: {
    seat?: string | null;
    jacket?: string;
    gender?: 'Male' | 'Female';
    position?: { x: number; y: number; z: number };
    rotation?: number;
    isWalking?: boolean;
  }) => {
    myPresenceRef.current = { ...myPresenceRef.current, ...presence };
  }, []);

  const sendMessage = async (text: string, seat?: string | null) => {
    if (!partyCode || !text.trim()) return;
    try {
      await fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          code: partyCode,
          guestName: assignedName.current,
          message: {
            text,
            seat: seat !== undefined ? seat : myPresenceRef.current.seat,
          }
        })
      });
    } catch {}
  };

  const sendReaction = async (emoji: string, seat?: string | null) => {
    if (!partyCode || !emoji) return;
    try {
      const localReact: PartyReaction = {
        id: `react-local-${Date.now()}`,
        from: assignedName.current,
        seat: seat !== undefined ? seat : myPresenceRef.current.seat,
        emoji,
        timestamp: Date.now(),
      };
      setReactions(prev => [...prev.slice(-20), localReact]);

      await fetch('/api/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reaction',
          code: partyCode,
          guestName: assignedName.current,
          reaction: {
            emoji,
            seat: seat !== undefined ? seat : myPresenceRef.current.seat,
          }
        })
      });
    } catch {}
  };

  const processSignals = async (signals: Signal[]) => {
    if (!signals || signals.length === 0) return;
    
    for (const signal of signals) {
      if (processedSignals.current.has(signal.id)) continue;
      processedSignals.current.add(signal.id);

      const peer = signal.from;
      const data = signal.data;
      
      let pc = pcs.current.get(peer);
      
      if (data.offer) {
        if (!pc) pc = createPeerConnection(peer);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer)).catch(()=>{});
        
        // Drain any queued ICE candidates that arrived before the offer
        const q = candidateQueue.current.get(peer) || [];
        for (const c of q) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
        candidateQueue.current.set(peer, []);
        
        const answer = await pc.createAnswer().catch(()=>null);
        if (answer) {
          await pc.setLocalDescription(answer).catch(()=>{});
          sendSignal(peer, { answer });
        }
      } else if (data.answer) {
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(()=>{});
          
          const q = candidateQueue.current.get(peer) || [];
          for (const c of q) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
          candidateQueue.current.set(peer, []);
        }
      } else if (data.candidate) {
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(()=>{});
        } else {
          const q = candidateQueue.current.get(peer) || [];
          q.push(data.candidate);
          candidateQueue.current.set(peer, q);
        }
      }
    }
  };

  const syncMediaToState = (state: RoomState) => {
    const m = mediaRef.current;
    if (!m) return;
    
    // Direct link or drive stream sync
    if (state.videoUrl && (state.videoUrl.startsWith('http') || state.videoUrl.startsWith('/api/')) && m.filename !== state.videoUrl && !m.filename?.includes('blob:')) {
      if (m.loadUrl) m.loadUrl(state.videoUrl);
    }
    
    if (m.videoElement) {
      if (!m.videoElement.srcObject) {
        if (state.isPlaying && m.videoElement.paused) m.videoElement.play().catch(()=>{});
        if (!state.isPlaying && !m.videoElement.paused) m.videoElement.pause();
        
        const elapsedSinceUpdate = (Date.now() - state.lastUpdate) / 1000;
        const expectedTime = state.isPlaying ? state.currentTime + elapsedSinceUpdate : state.currentTime;
        if (Math.abs(m.videoElement.currentTime - expectedTime) > 1.8) {
          m.seek(expectedTime);
        }
      }
    }
  };

  // Host WebRTC streaming logic: continuously broadcast tracks to connected guests
  const setupHostStreams = useCallback(() => {
    if (!isHost || !partyCode) return;
    const m = mediaRef.current;
    const video = m?.videoElement as any;
    if (!video) return;

    const shouldStream = (m.filename && !m.filename.startsWith('http') && !m.filename.startsWith('/api/')) || !!video.srcObject;
    
    if (shouldStream) {
      const getStream = (): MediaStream | null => {
        if (video.srcObject instanceof MediaStream) return video.srcObject;
        if (video.captureStream) return video.captureStream();
        if (video.mozCaptureStream) return video.mozCaptureStream();
        if (video.webkitCaptureStream) return video.webkitCaptureStream();
        return null;
      };
      
      const stream = getStream();
      if (stream && stream.getTracks().length > 0) {
        guests.forEach(async (guest) => {
          let pc = pcs.current.get(guest);
          if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            pc = createPeerConnection(guest);
            stream.getTracks().forEach((track: any) => {
              try { pc!.addTrack(track, stream); } catch {}
            });
            const offer = await pc.createOffer().catch(()=>null);
            if (offer) {
              await pc.setLocalDescription(offer).catch(()=>{});
              sendSignal(guest, { offer });
            }
          }
        });
      }
    }
  }, [isHost, partyCode, guests]);

  useEffect(() => {
    setupHostStreams();
  }, [setupHostStreams, media?.filename, media?.isPlaying, guests]);

  // Robust Heartbeat & Sync Loop
  useEffect(() => {
    if (!partyCode) return;
    
    const interval = setInterval(async () => {
      try {
        const m = mediaRef.current;
        
        if (isHost) {
          const videoUrl = m.filename
            ? (m.filename.startsWith('http') || m.filename.startsWith('/api/') ? m.filename : `local:${m.filename}`)
            : '';
          await fetch('/api/party', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update',
              code: partyCode,
              state: {
                videoUrl,
                isPlaying: m.isPlaying,
                currentTime: m.progress,
              }
            })
          }).catch(()=>{});

          setupHostStreams();
        }

        // Heartbeat & Member Presence
        await fetch('/api/party', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_member',
            code: partyCode,
            guestName: assignedName.current,
            memberData: myPresenceRef.current,
          })
        }).catch(()=>{});

        // Poll Room State
        const res = await fetch(`/api/party?code=${partyCode}&user=${assignedName.current}`);
        if (res.ok) {
          consecutiveErrors.current = 0;
          const data = await res.json() as any;
          setHostName(data.host || '');
          setGuests(data.guests || []);
          if (data.members) {
            const remoteList = Object.values(data.members as Record<string, PartyMember>)
              .filter(mb => mb.name !== assignedName.current);
            setMembers(remoteList);
          }
          if (data.messages) setMessages(data.messages);
          if (data.reactions) setReactions(data.reactions);
          
          if (!isHost) {
            setHostVideoUrl(data.videoUrl || '');
            syncMediaToState(data);
          }
          if (data.signals) processSignals(data.signals);
        } else if (res.status === 404) {
          consecutiveErrors.current += 1;
          // Only leave if 8 consecutive polls fail (8+ seconds)
          if (consecutiveErrors.current >= 8) {
            leaveParty();
            setError('Party room was closed.');
          }
        }
      } catch (err) {
        // Network glitches won't terminate party
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [partyCode, isHost, setupHostStreams]);

  return {
    partyCode,
    isHost,
    hostName,
    hostVideoUrl,
    guests,
    members,
    messages,
    reactions,
    error,
    createParty,
    joinParty,
    leaveParty,
    sendMessage,
    sendReaction,
    updateMyPresence,
  };
}

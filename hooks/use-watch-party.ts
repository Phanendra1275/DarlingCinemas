import { useState, useEffect, useRef, useCallback } from 'react';
import type { PartyMember, ChatMessage, PartyReaction, RoomState } from '../app/api/party/route';

export type { PartyMember, ChatMessage, PartyReaction };

export function useWatchParty(media: any, userName: string) {
  const [partyCode, setPartyCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [guests, setGuests] = useState<string[]>([]);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [hostName, setHostName] = useState<string>('');
  const [hostVideoUrl, setHostVideoUrl] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<PartyReaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Use refs to avoid continuous re-renders on the interval loop
  const mediaRef = useRef(media);
  useEffect(() => { mediaRef.current = media; }, [media]);

  const assignedName = useRef(userName);
  useEffect(() => {
    if (!partyCode) assignedName.current = userName;
  }, [userName, partyCode]);

  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const candidateQueue = useRef<Map<string, any[]>>(new Map());
  const myPresenceRef = useRef<{
    seat: string | null;
    jacket?: string;
    gender?: 'Male' | 'Female';
    position?: { x: number; y: number; z: number };
    rotation?: number;
    isWalking?: boolean;
  }>({ seat: null });

  const sendSignal = async (to: string, data: any) => {
    if (!partyCode) return;
    await fetch('/api/party', {
      method: 'POST',
      body: JSON.stringify({ action: 'signal', code: partyCode, guestName: assignedName.current, to, data })
    }).catch(() => {});
  };

  const createPeerConnection = (peerName: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(peerName, { candidate: event.candidate });
      }
    };

    if (!isHost) {
      pc.ontrack = (event) => {
        const m = mediaRef.current;
        if (m && m.videoElement) {
          m.videoElement.srcObject = event.streams[0];
          m.videoElement.play().catch(() => {});
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
        body: JSON.stringify({ action: 'leave', code: partyCode, guestName: assignedName.current }),
      }).catch(() => {});
    }
    setPartyCode(null);
    setIsHost(false);
    setMembers([]);
    setMessages([]);
    setReactions([]);
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
      // Local optimistic reaction display
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

  const processSignals = async (signals: any[]) => {
    if (!signals || signals.length === 0) return;
    
    for (const signal of signals) {
      const peer = signal.from;
      const data = signal.data;
      
      let pc = pcs.current.get(peer);
      
      if (data.offer) {
        if (!pc) pc = createPeerConnection(peer);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Drain any queued ICE candidates that arrived before the offer
        const q = candidateQueue.current.get(peer) || [];
        for (const c of q) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
        candidateQueue.current.set(peer, []);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(peer, { answer });
      } else if (data.answer) {
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          
          // Drain any queued ICE candidates that arrived before the answer
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
    
    if (state.videoUrl && state.videoUrl.startsWith('http') && m.filename !== state.videoUrl && !m.filename?.includes('blob:')) {
      if (m.loadUrl) m.loadUrl(state.videoUrl);
    }
    
    if (m.videoElement) {
      if (!m.videoElement.srcObject) {
        if (state.isPlaying && m.videoElement.paused) m.videoElement.play().catch(()=>{});
        if (!state.isPlaying && !m.videoElement.paused) m.videoElement.pause();
        
        const elapsedSinceUpdate = (Date.now() - state.lastUpdate) / 1000;
        const expectedTime = state.isPlaying ? state.currentTime + elapsedSinceUpdate : state.currentTime;
        if (Math.abs(m.videoElement.currentTime - expectedTime) > 1.5) {
          m.seek(expectedTime);
        }
      }
    }
  };

  // Host WebRTC streaming logic
  useEffect(() => {
    if (!isHost || !partyCode) return;
    const m = mediaRef.current;
    const video = m?.videoElement as any;
    if (!video) return;

    const shouldStream = m.filename && !m.filename.startsWith('http');
    
    if (shouldStream) {
      const getStream = () => {
        if (video.captureStream) return video.captureStream();
        if (video.mozCaptureStream) return video.mozCaptureStream();
        if (video.webkitCaptureStream) return video.webkitCaptureStream();
        return null;
      };
      
      const stream = getStream();
      if (stream) {
        guests.forEach(async (guest) => {
          if (!pcs.current.has(guest)) {
            const pc = createPeerConnection(guest);
            stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendSignal(guest, { offer });
          }
        });
      }
    } else {
      pcs.current.forEach(pc => pc.close());
      pcs.current.clear();
    }
  }, [guests, isHost, partyCode]);

  // Sync Loop
  useEffect(() => {
    if (!partyCode) return;
    
    const interval = setInterval(async () => {
      try {
        const m = mediaRef.current;
        
        // Push host playback update and local member presence update
        if (isHost) {
          await fetch('/api/party', {
            method: 'POST',
            body: JSON.stringify({
              action: 'update',
              code: partyCode,
              state: {
                videoUrl: m.filename ? (m.filename.startsWith('http') ? m.filename : `local:${m.filename}`) : '',
                isPlaying: m.isPlaying,
                currentTime: m.progress,
              }
            })
          }).catch(()=>{});
        }

        // Send periodic member presence heartbeat
        await fetch('/api/party', {
          method: 'POST',
          body: JSON.stringify({
            action: 'update_member',
            code: partyCode,
            guestName: assignedName.current,
            memberData: myPresenceRef.current,
          })
        }).catch(()=>{});

        // Poll room state
        const res = await fetch(`/api/party?code=${partyCode}&user=${assignedName.current}`);
        if (res.ok) {
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
          processSignals(data.signals);
        } else if (res.status === 404) {
          leaveParty();
          setError('Party room was closed.');
        }
      } catch (err) {
        // Ignore background polling errors
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [partyCode, isHost]);

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

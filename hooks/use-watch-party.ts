import { useState, useEffect, useRef, useCallback } from 'react';
import type { PartyMember, ChatMessage, PartyReaction, RoomState } from '../app/api/party/route';

export type { PartyMember, ChatMessage, PartyReaction };

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

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

  // Keep fresh references to avoid stale closure issues in interval callbacks
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
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(peerName, { candidate: event.candidate });
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
    
    // If it is a web URL or internal streaming URL (/api/drive-stream, http...)
    if (state.videoUrl && (state.videoUrl.startsWith('http') || state.videoUrl.startsWith('/api/')) && m.filename !== state.videoUrl && !m.filename?.includes('blob:')) {
      if (m.loadUrl) m.loadUrl(state.videoUrl);
    }
    
    if (m.videoElement) {
      // If we are NOT receiving a WebRTC stream (direct URL sync)
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

  // Host WebRTC streaming logic: continuously ensures all guests receive media tracks
  const setupHostStreams = useCallback(() => {
    if (!isHost || !partyCode) return;
    const m = mediaRef.current;
    const video = m?.videoElement as any;
    if (!video) return;

    // Stream local files, blob URLs, or active screen sharing
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
          if (!pc) {
            pc = createPeerConnection(guest);
            stream.getTracks().forEach((track: any) => {
              try { pc!.addTrack(track, stream); } catch {}
            });
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendSignal(guest, { offer });
          }
        });
      }
    }
  }, [isHost, partyCode, guests]);

  // Run stream setup whenever guests list, media filename, or playing state updates
  useEffect(() => {
    setupHostStreams();
  }, [setupHostStreams, media?.filename, media?.isPlaying, guests]);

  // Sync Polling Loop
  useEffect(() => {
    if (!partyCode) return;
    
    const interval = setInterval(async () => {
      try {
        const m = mediaRef.current;
        
        // Push host playback update and local member presence update
        if (isHost) {
          const videoUrl = m.filename
            ? (m.filename.startsWith('http') || m.filename.startsWith('/api/') ? m.filename : `local:${m.filename}`)
            : '';
          await fetch('/api/party', {
            method: 'POST',
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

          // Also trigger stream check for any pending guests
          setupHostStreams();
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
        // Ignore background polling network glitches
      }
    }, 1000);

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

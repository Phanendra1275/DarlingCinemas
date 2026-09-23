import { useState, useEffect, useRef } from 'react';

type RoomState = {
  host: string;
  guests: string[];
  videoUrl: string;
  isPlaying: boolean;
  currentTime: number;
  lastUpdate: number;
  signals?: { from: string; data: any }[];
};

export function useWatchParty(media: any, userName: string) {
  const [partyCode, setPartyCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [guests, setGuests] = useState<string[]>([]);
  const [hostName, setHostName] = useState<string>('');
  const [hostVideoUrl, setHostVideoUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Use refs to avoid continuous re-renders on the interval loop
  const mediaRef = useRef(media);
  useEffect(() => { mediaRef.current = media; }, [media]);

  const assignedName = useRef(userName);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());

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

  const createParty = async () => {
    try {
      const res = await fetch('/api/party', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', guestName: userName }),
      });
      const data = await res.json();
      if (data.code) {
        setPartyCode(data.code);
        setIsHost(true);
        assignedName.current = userName;
        setHostName(userName);
        setGuests([]);
        setError(null);
        pcs.current.clear();
      }
    } catch (err) {
      setError('Failed to create party.');
    }
  };

  const joinParty = async (code: string) => {
    try {
      const res = await fetch('/api/party', {
        method: 'POST',
        body: JSON.stringify({ action: 'join', code, guestName: userName }),
      });
      if (res.ok) {
        const data = await res.json();
        setPartyCode(code);
        setIsHost(false);
        assignedName.current = data.assignedName || userName;
        setHostName(data.host);
        setGuests(data.guests);
        setError(null);
        pcs.current.clear();
        syncMediaToState(data);
      } else {
        setError('Room not found or could not join.');
      }
    } catch (err) {
      setError('Failed to join party.');
    }
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
    pcs.current.forEach(pc => pc.close());
    pcs.current.clear();
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
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(peer, { answer });
      } else if (data.answer) {
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } else if (data.candidate) {
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }
  };

  const syncMediaToState = (state: RoomState) => {
    const m = mediaRef.current;
    if (!m) return;
    
    // We only auto-load standard HTTP URLs.
    // Local streams are handled via WebRTC `srcObject`
    if (state.videoUrl && state.videoUrl.startsWith('http') && m.filename !== state.videoUrl && !m.filename?.includes('blob:')) {
      if (m.loadUrl) m.loadUrl(state.videoUrl);
    }
    
    if (m.videoElement) {
      // Don't seek if we are receiving a WebRTC stream (srcObject is set)
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

    // We stream local files or screen share (anything that isn't a direct http link)
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
        // Find guests who don't have a PC yet and create offers
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
      // Close existing PCs if we stopped streaming
      pcs.current.forEach(pc => pc.close());
      pcs.current.clear();
    }
  }, [guests, isHost, partyCode]); // React to new guests

  // Sync Loop
  useEffect(() => {
    if (!partyCode) return;
    
    const interval = setInterval(async () => {
      try {
        if (isHost) {
          const m = mediaRef.current;
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
          });
          const res = await fetch(`/api/party?code=${partyCode}&user=${assignedName.current}`);
          if (res.ok) {
            const data = await res.json();
            setGuests(data.guests);
            processSignals(data.signals);
          }
        } else {
          const res = await fetch(`/api/party?code=${partyCode}&user=${assignedName.current}`);
          if (res.ok) {
            const data = await res.json();
            setHostName(data.host);
            setGuests(data.guests);
            setHostVideoUrl(data.videoUrl || '');
            syncMediaToState(data);
            processSignals(data.signals);
          } else {
            leaveParty();
            setError('Host closed the party.');
          }
        }
      } catch (err) {
        // Ignore network errors in polling
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
    error,
    createParty,
    joinParty,
    leaveParty,
  };
}

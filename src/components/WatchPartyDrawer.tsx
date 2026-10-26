"use client";

import React, { useState, useEffect } from 'react';
import {
  Users,
  Sparkles,
  Copy,
  Check,
  Crown,
  Volume2,
  VolumeX,
  Film,
  Armchair,
  X,
  LogOut,
  MessageSquare,
  ShieldAlert
} from 'lucide-react';
import { partyService, CINEMA_SEAT_IDS } from '../services/partyService';
import type { RoomMeta, RoomMedia, RoomMember, RoomSeats } from '../types/party';

interface WatchPartyDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentMediaTitle: string;
  userName: string;
  userColor: string;
  gender: string;
  currentSeat: string | null;
  onSelectSeat: (seatId: string) => void;
  onOpenChat: () => void;
  onChangeMovie?: () => void;
  onToast: (msg: string) => void;
  onRoomChange?: (roomCode: string | null) => void;
}

export function WatchPartyDrawer({
  isOpen,
  onClose,
  currentMediaTitle,
  userName,
  userColor,
  gender,
  currentSeat,
  onSelectSeat,
  onOpenChat,
  onChangeMovie,
  onToast,
  onRoomChange
}: WatchPartyDrawerProps) {
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const [roomTitle, setRoomTitle] = useState('A little movie night');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [displayNameInput, setDisplayNameInput] = useState(userName);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Active party state
  const [activeCode, setActiveCode] = useState<string | null>(partyService.getActiveRoom());
  const [roomMeta, setRoomMeta] = useState<RoomMeta | null>(null);
  const [members, setMembers] = useState<Record<string, RoomMember>>({});
  const [seats, setSeats] = useState<RoomSeats>({});
  const [roomAudioMuted, setRoomAudioMuted] = useState(false);

  const localUid = partyService.getUid();
  const isHost = partyService.getIsHost();

  useEffect(() => {
    setDisplayNameInput(userName);
  }, [userName]);

  useEffect(() => {
    setActiveCode(partyService.getActiveRoom());
    const unsub = partyService.onRoomChange((code) => setActiveCode(code));
    return () => unsub();
  }, [isOpen]);

  // Subscribe to room updates when drawer is open
  useEffect(() => {
    if (!activeCode || !isOpen) return;

    const unsub = partyService.subscribeToRoom({
      onMeta: (meta) => {
        setRoomMeta(meta);
        setRoomAudioMuted(!!(meta as any).roomAudioMuted);
      },
      onMembers: (m) => setMembers(m || {}),
      onSeats: (s) => setSeats(s || {})
    });

    return () => {
      unsub();
    };
  }, [activeCode, isOpen]);

  if (!isOpen) return null;

  const handleCreateParty = async () => {
    setIsLoading(true);
    try {
      const code = await partyService.createRoom(
        roomTitle,
        { name: displayNameInput || userName, color: userColor, gender: gender as any },
        { title: currentMediaTitle || 'The Quiet Hours' }
      );
      setActiveCode(code);
      onRoomChange?.(code);
      onToast(`Watch party created! Room code: ${code}`);
    } catch (err: any) {
      onToast(err.message || 'Failed to create room.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinParty = async () => {
    if (joinCodeInput.trim().length !== 6) {
      onToast('Please enter a valid 6-character room code.');
      return;
    }
    setIsLoading(true);
    try {
      const res = await partyService.joinRoom(joinCodeInput, {
        name: displayNameInput || userName,
        color: userColor,
        gender: gender as any
      });
      if (res.success) {
        const cleanCode = joinCodeInput.trim().toUpperCase();
        setActiveCode(cleanCode);
        onRoomChange?.(cleanCode);
        onToast(`Joined Cinema Room ${cleanCode}!`);
      } else {
        onToast(res.error || 'Could not join room.');
      }
    } catch (err: any) {
      onToast(err.message || 'Error connecting to room.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeaveParty = async () => {
    await partyService.leaveRoom();
    setActiveCode(null);
    setRoomMeta(null);
    setMembers({});
    setSeats({});
    onRoomChange?.(null);
    onToast('You left the watch party.');
  };

  const handleCopyLink = () => {
    if (!activeCode) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?party=1&room=${activeCode}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedLink(true);
      onToast(`Invite link copied to clipboard! (Room ${activeCode})`);
      setTimeout(() => setCopiedLink(false), 3000);
    });
  };

  const handleToggleRoomAudio = async () => {
    if (!isHost) return;
    const next = !roomAudioMuted;
    setRoomAudioMuted(next);
    await partyService.setMuteRoomAudio(next);
    onToast(next ? 'Room audio muted globally for all guests.' : 'Room audio unmuted.');
  };

  const memberList = Object.values(members);
  const occupantCount = memberList.length;

  return (
    <div className="dc-backdrop" onClick={onClose} data-ui-control style={{ zIndex: 120 }}>
      <div
        className="dc-panel"
        style={{ maxWidth: '480px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="dc-close" aria-label="Close party drawer" onClick={onClose}>
          <X size={18} />
        </button>

        <span className="dc-eyebrow" style={{ color: '#ff9a4d' }}>
          SYNCHRONIZED 3D CINEMA
        </span>
        <h2 id="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Users size={24} color="#ff7a33" />
          <span>Watch Party</span>
          {activeCode && (
            <span
              style={{
                fontSize: '11px',
                background: isHost ? 'rgba(255, 180, 0, 0.2)' : 'rgba(74, 222, 128, 0.2)',
                color: isHost ? '#ffd043' : '#4ade80',
                padding: '3px 8px',
                borderRadius: '12px',
                border: '1px solid currentColor',
                fontWeight: 700
              }}
            >
              {isHost ? 'HOST 👑' : 'CONNECTED 🟢'}
            </span>
          )}
        </h2>

        {/* ACTIVE ROOM VIEW */}
        {activeCode ? (
          <div style={{ marginTop: '16px' }}>
            {/* Room Code Card */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(35, 28, 22, 0.95) 0%, rgba(20, 17, 14, 0.98) 100%)',
                border: '1px solid rgba(150, 112, 68, 0.35)',
                borderRadius: '16px',
                padding: '20px',
                textAlign: 'center',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)'
              }}
            >
              <div style={{ fontSize: '11px', letterSpacing: '2px', color: '#ffb27d', fontWeight: 700 }}>
                INVITE CODE
              </div>
              <div
                style={{
                  fontSize: '38px',
                  fontWeight: 900,
                  letterSpacing: '6px',
                  color: '#fff',
                  margin: '8px 0 14px',
                  fontFamily: 'monospace'
                }}
              >
                {activeCode}
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button
                  className="dc-pill"
                  onClick={handleCopyLink}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.2)'
                  }}
                >
                  {copiedLink ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
                  <span>{copiedLink ? 'Link Copied!' : 'Copy Link'}</span>
                </button>

                <button
                  className="dc-pill"
                  onClick={() => {
                    onOpenChat();
                    onClose();
                  }}
                  style={{
                    background: 'rgba(255, 122, 51, 0.2)',
                    color: '#ffab73',
                    borderColor: 'rgba(255, 122, 51, 0.4)'
                  }}
                >
                  <MessageSquare size={14} />
                  <span>Live Chat</span>
                </button>
              </div>
            </div>

            {/* Recliner Mutex Map */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dc-eyebrow">RECLINER SEATS OCCUPANCY</span>
                <span style={{ fontSize: '12px', color: '#d8caa5' }}>
                  {occupantCount} / 10 Occupied
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '6px',
                  marginTop: '10px'
                }}
              >
                {CINEMA_SEAT_IDS.map((sid) => {
                  const occupantUid = seats[sid];
                  const isOccupiedByOther = occupantUid && occupantUid !== localUid;
                  const isOccupiedByMe = occupantUid === localUid;
                  const occupant = occupantUid ? members[occupantUid] : null;

                  return (
                    <button
                      key={sid}
                      onClick={() => onSelectSeat(sid)}
                      title={
                        isOccupiedByMe
                          ? `You are sitting in ${sid}`
                          : occupant
                          ? `Occupied by ${occupant.name}`
                          : `Reserve recliner ${sid}`
                      }
                      style={{
                        padding: '10px 4px',
                        borderRadius: '8px',
                        border: isOccupiedByMe
                          ? '2px solid #ff7a33'
                          : isOccupiedByOther
                          ? '1px solid rgba(220, 60, 60, 0.5)'
                          : '1px solid rgba(150, 112, 68, 0.3)',
                        background: isOccupiedByMe
                          ? 'rgba(255, 122, 51, 0.25)'
                          : isOccupiedByOther
                          ? 'rgba(132, 49, 61, 0.35)'
                          : 'rgba(255, 255, 255, 0.04)',
                        color: isOccupiedByMe ? '#ffab73' : isOccupiedByOther ? '#ff9999' : '#e8dcba',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <Armchair size={15} />
                      <span style={{ fontSize: '11px', fontWeight: 700 }}>{sid}</span>
                      <span
                        style={{
                          fontSize: '8px',
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%'
                        }}
                      >
                        {isOccupiedByMe ? 'You' : occupant ? occupant.name : 'Free'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Connected Audience List */}
            <div style={{ marginTop: '20px' }}>
              <span className="dc-eyebrow">
                MEMBERS ({memberList.length} / 10)
              </span>
              <div
                style={{
                  maxHeight: '130px',
                  overflowY: 'auto',
                  marginTop: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                {memberList.map((mem) => {
                  const isMemberHost = roomMeta?.hostId === mem.id;
                  const isMe = mem.id === localUid;

                  return (
                    <div
                      key={mem.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.06)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            background: mem.color || '#c8bea9',
                            display: 'inline-block'
                          }}
                        />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#f5eedc' }}>
                          {mem.name} {isMe && '(You)'}
                        </span>
                        {isMemberHost && (
                          <span
                            style={{
                              fontSize: '9px',
                              color: '#ffc83b',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px'
                            }}
                          >
                            <Crown size={11} /> HOST
                          </span>
                        )}
                      </div>

                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: mem.seatId ? 'rgba(255, 122, 51, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                          color: mem.seatId ? '#ffab73' : 'rgba(255, 255, 255, 0.5)',
                          border: '1px solid rgba(255, 255, 255, 0.1)'
                        }}
                      >
                        {mem.seatId ? `Seat ${mem.seatId}` : 'Exploring'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Host Controls */}
            {isHost && (
              <div
                style={{
                  marginTop: '20px',
                  padding: '14px',
                  background: 'rgba(255, 180, 0, 0.06)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 180, 0, 0.2)'
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#ffd043', letterSpacing: '1px' }}>
                  👑 HOST SCREEN CONTROLS
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button
                    className="dc-pill"
                    onClick={handleToggleRoomAudio}
                    style={{
                      flex: 1,
                      justifyContent: 'center',
                      background: roomAudioMuted ? 'rgba(220, 60, 60, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                      color: roomAudioMuted ? '#ff8080' : '#fff'
                    }}
                  >
                    {roomAudioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    <span>{roomAudioMuted ? 'Room Audio Muted' : 'Mute Room Audio'}</span>
                  </button>

                  {onChangeMovie && (
                    <button
                      className="dc-pill"
                      onClick={() => {
                        onChangeMovie();
                        onClose();
                      }}
                      style={{
                        flex: 1,
                        justifyContent: 'center',
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: '#fff'
                      }}
                    >
                      <Film size={14} />
                      <span>Change Movie</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Leave Room Button */}
            <button
              className="dc-wide secondary"
              onClick={handleLeaveParty}
              style={{
                marginTop: '20px',
                color: '#ff6b6b',
                background: 'rgba(220, 40, 40, 0.1)',
                borderColor: 'rgba(220, 40, 40, 0.25)',
                justifyContent: 'center'
              }}
            >
              <LogOut size={16} />
              <span>Leave Watch Party</span>
            </button>
          </div>
        ) : (
          /* CREATE / JOIN TABS VIEW */
          <div style={{ marginTop: '16px' }}>
            <div className="dc-tabs">
              <button
                className={activeTab === 'create' ? 'selected' : ''}
                onClick={() => setActiveTab('create')}
              >
                Host Screen
              </button>
              <button
                className={activeTab === 'join' ? 'selected' : ''}
                onClick={() => setActiveTab('join')}
              >
                Join with Code
              </button>
            </div>

            {activeTab === 'create' ? (
              <div style={{ marginTop: '16px' }}>
                <p style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.75)', lineHeight: 1.6 }}>
                  Host a private virtual theatre screening. Up to 10 viewers can sit together, see each other in 3D, and watch synchronized video.
                </p>

                <label className="dc-field" style={{ marginTop: '16px' }}>
                  PARTY TITLE
                  <input
                    type="text"
                    value={roomTitle}
                    maxLength={40}
                    onChange={(e) => setRoomTitle(e.target.value)}
                    placeholder="e.g. A little movie night"
                  />
                </label>

                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    margin: '16px 0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                >
                  <Film size={20} color="#ff7a33" />
                  <div>
                    <div style={{ fontSize: '11px', color: '#ffb27d' }}>CURRENT SCREEN MEDIA</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>
                      {currentMediaTitle || 'The Quiet Hours (Ambient)'}
                    </div>
                  </div>
                </div>

                <button
                  className="dc-wide"
                  disabled={isLoading}
                  onClick={handleCreateParty}
                  style={{
                    background: 'linear-gradient(135deg, rgba(255, 122, 51, 0.95) 0%, rgba(220, 60, 15, 0.9) 100%)',
                    justifyContent: 'center',
                    marginTop: '8px'
                  }}
                >
                  <Sparkles size={16} />
                  <span>{isLoading ? 'Creating Room…' : 'Create Watch Party →'}</span>
                </button>
              </div>
            ) : (
              <div style={{ marginTop: '16px' }}>
                <p style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.75)', lineHeight: 1.6 }}>
                  Enter the 6-character code provided by your host to enter their cinema room.
                </p>

                <label className="dc-field" style={{ marginTop: '16px' }}>
                  6-CHARACTER ROOM CODE
                  <input
                    type="text"
                    value={joinCodeInput}
                    maxLength={6}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="e.g. AFX7B2"
                    style={{
                      letterSpacing: '4px',
                      fontSize: '18px',
                      textAlign: 'center',
                      fontWeight: 700
                    }}
                  />
                </label>

                <label className="dc-field" style={{ marginTop: '12px' }}>
                  YOUR DISPLAY NAME
                  <input
                    type="text"
                    value={displayNameInput}
                    maxLength={24}
                    onChange={(e) => setDisplayNameInput(e.target.value)}
                    placeholder="Guest"
                  />
                </label>

                <button
                  className="dc-wide"
                  disabled={isLoading || joinCodeInput.length !== 6}
                  onClick={handleJoinParty}
                  style={{
                    background: 'linear-gradient(135deg, rgba(255, 122, 51, 0.95) 0%, rgba(220, 60, 15, 0.9) 100%)',
                    justifyContent: 'center',
                    marginTop: '16px'
                  }}
                >
                  <Users size={16} />
                  <span>{isLoading ? 'Connecting…' : 'Join Cinema →'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        <button
          className="dc-wide secondary"
          onClick={onClose}
          style={{ marginTop: '14px', justifyContent: 'center' }}
        >
          Back to the Cinema →
        </button>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Send,
  X,
  ChevronDown,
  ChevronUp,
  Smile,
  Sparkles
} from 'lucide-react';
import { partyService } from '../services/partyService';
import type { ChatMessage } from '../types/party';

interface TheatreChatHudProps {
  isOpen: boolean;
  onToggle: () => void;
  onToast: (msg: string) => void;
}

const QUICK_EMOJIS = ['🍿', '❤️', '😂', '👏', '😮', '🔥'];

export function TheatreChatHud({ isOpen, onToggle, onToast }: TheatreChatHudProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const activeRoomCode = partyService.getActiveRoom();
  const localUid = partyService.getUid();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to chat messages
  useEffect(() => {
    if (!activeRoomCode) {
      setMessages([]);
      return;
    }

    const unsub = partyService.subscribeToRoom({
      onChat: (chatList) => {
        setMessages(chatList);
        if (!isOpen || isMinimized) {
          const lastMsg = chatList[chatList.length - 1];
          // Only increment unread if it wasn't sent right now by us
          if (lastMsg && Date.now() - lastMsg.ts < 4000) {
            setUnreadCount((c) => c + 1);
          }
        }
      }
    });

    return () => {
      unsub();
    };
  }, [activeRoomCode, isOpen, isMinimized]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isOpen && !isMinimized && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
    }
  }, [messages, isOpen, isMinimized]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;
    const text = inputText;
    setInputText('');

    try {
      await partyService.sendChatMessage(text);
    } catch {
      onToast('Failed to send message.');
    }
  };

  const handleQuickEmoji = async (emoji: string) => {
    try {
      await partyService.sendChatMessage(emoji);
    } catch {
      onToast('Failed to send reaction.');
    }
  };

  // If chat is not open in the HUD, render the floating trigger badge in the bottom right corner
  if (!isOpen) {
    return (
      <div
        data-ui-control
        style={{
          position: 'fixed',
          bottom: '84px',
          right: '24px',
          zIndex: 90
        }}
      >
        <button
          onClick={onToggle}
          title="Open Theatre Chat"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            background: 'rgba(20, 18, 15, 0.88)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(150, 112, 68, 0.45)',
            borderRadius: '24px',
            color: '#f5eedc',
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            transition: 'transform 0.15s ease'
          }}
        >
          <MessageSquare size={16} color="#ff7a33" />
          <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px' }}>Chat</span>
          {activeRoomCode && (
            <span
              style={{
                fontSize: '10px',
                background: 'rgba(255, 122, 51, 0.25)',
                color: '#ffab73',
                padding: '2px 6px',
                borderRadius: '8px',
                fontWeight: 700
              }}
            >
              {activeRoomCode}
            </span>
          )}
          {unreadCount > 0 && (
            <span
              style={{
                background: '#ff4d4d',
                color: '#fff',
                fontSize: '10px',
                fontWeight: 800,
                padding: '2px 6px',
                borderRadius: '10px',
                minWidth: '16px',
                textAlign: 'center'
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  // Floating Chat Box in the bottom right corner of the 3D theatre
  return (
    <div
      data-ui-control
      style={{
        position: 'fixed',
        bottom: '84px',
        right: '24px',
        width: '320px',
        maxWidth: 'calc(100vw - 48px)',
        zIndex: 95,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        background: 'rgba(18, 16, 14, 0.92)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(150, 112, 68, 0.4)',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65)',
        overflow: 'hidden',
        transition: 'height 0.25s ease'
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: isMinimized ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.03)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquare size={16} color="#ff7a33" />
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#f5eedc' }}>
            In-Theatre Chat
          </span>
          {activeRoomCode && (
            <span
              style={{
                fontSize: '9px',
                background: 'rgba(255, 122, 51, 0.2)',
                color: '#ffab73',
                padding: '2px 6px',
                borderRadius: '8px',
                fontWeight: 700
              }}
            >
              {activeRoomCode}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.6)',
              cursor: 'pointer',
              padding: '4px'
            }}
            title={isMinimized ? 'Expand Chat' : 'Minimize Chat'}
          >
            {isMinimized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={onToggle}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.6)',
              cursor: 'pointer',
              padding: '4px'
            }}
            title="Close Chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Quick Emoji Toolbar */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              padding: '6px 12px',
              background: 'rgba(0, 0, 0, 0.25)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              justifyContent: 'space-between'
            }}
          >
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleQuickEmoji(emoji)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '16px',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '6px',
                  transition: 'transform 0.1s ease'
                }}
                title={`Send ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Messages Stream */}
          <div
            style={{
              height: '220px',
              overflowY: 'auto',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            {messages.length === 0 ? (
              <div
                style={{
                  margin: 'auto',
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'rgba(255, 255, 255, 0.45)',
                  lineHeight: 1.5,
                  padding: '0 12px'
                }}
              >
                🎬 Room chat is quiet.<br />
                Say hello or react with an emoji!
              </div>
            ) : (
              messages.map((msg) => {
                const isSystem = msg.sender === 'System';
                const timeStr = new Date(msg.ts).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                });

                if (isSystem) {
                  return (
                    <div
                      key={msg.id}
                      style={{
                        textAlign: 'center',
                        fontSize: '11px',
                        color: 'rgba(255, 178, 125, 0.85)',
                        background: 'rgba(255, 122, 51, 0.08)',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        margin: '2px 0'
                      }}
                    >
                      {msg.text}
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'rgba(255, 255, 255, 0.04)',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 255, 255, 0.06)'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '3px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#ffc83b'
                          }}
                        >
                          {msg.sender}
                        </span>
                        {msg.seatId && (
                          <span
                            style={{
                              fontSize: '9px',
                              background: 'rgba(255, 122, 51, 0.2)',
                              color: '#ffab73',
                              padding: '1px 5px',
                              borderRadius: '6px',
                              fontWeight: 700
                            }}
                          >
                            {msg.seatId}
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: '9px',
                          color: 'rgba(255, 255, 255, 0.35)'
                        }}
                      >
                        {timeStr}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: '13px',
                        color: '#f5eedc',
                        lineHeight: 1.4,
                        wordBreak: 'break-word'
                      }}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input form */}
          <form
            onSubmit={handleSend}
            style={{
              display: 'flex',
              padding: '8px 10px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(0, 0, 0, 0.3)'
            }}
          >
            <input
              type="text"
              placeholder="Chat with the cinema…"
              value={inputText}
              maxLength={200}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                // Stop WASD propagation to Three.js controls
                e.stopPropagation();
              }}
              style={{
                flex: 1,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: '#fff',
                fontSize: '12px',
                outline: 'none'
              }}
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              style={{
                marginLeft: '6px',
                background: inputText.trim() ? '#ff7a33' : 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                padding: '0 12px',
                cursor: inputText.trim() ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Send size={14} />
            </button>
          </form>
        </>
      )}
    </div>
  );
}

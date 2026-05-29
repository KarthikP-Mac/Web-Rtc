package com.example.webrtc.handler;

import com.example.webrtc.model.SignalMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;

import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SignalingHandler extends TextWebSocketHandler {

    private final ObjectMapper mapper = new ObjectMapper();

    // roomId -> sessions
    private final Map<String, Set<WebSocketSession>> rooms =
            new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        System.out.println("Connected: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session,
                                     TextMessage message) {
        try {
            SignalMessage signal =
                    mapper.readValue(message.getPayload(), SignalMessage.class);

            String roomId = signal.getRoomId();
            if (roomId == null) {
                System.out.println("Received message without roomId from session: " + session.getId());
                return;
            }

            rooms.putIfAbsent(roomId, ConcurrentHashMap.newKeySet());

            if (signal.getType().equals("join")) {
                Set<WebSocketSession> sessions = rooms.get(roomId);
                sessions.removeIf(s -> !s.isOpen());
                if (sessions.size() >= 2) {
                    System.out.println("Session " + session.getId() + " rejected from room " + roomId + " (room is full).");
                    SignalMessage fullMsg = new SignalMessage();
                    fullMsg.setType("full");
                    fullMsg.setRoomId(roomId);
                    fullMsg.setSender("server");
                    fullMsg.setData("Room is full");
                    session.sendMessage(new TextMessage(mapper.writeValueAsString(fullMsg)));
                    return;
                }
                sessions.add(session);
                System.out.println("Session " + session.getId() + " joined room " + roomId + ". Total sessions in room: " + sessions.size());
                return;
            }

            if (signal.getType().equals("ping")) {
                SignalMessage pongMsg = new SignalMessage();
                pongMsg.setType("pong");
                pongMsg.setRoomId(roomId);
                pongMsg.setSender("server");
                session.sendMessage(new TextMessage(mapper.writeValueAsString(pongMsg)));
                return;
            }

            System.out.println("Processing message type '" + signal.getType() + "' from session " + session.getId() + " in room " + roomId);
            int forwardedCount = 0;
            for (WebSocketSession s : rooms.get(roomId)) {
                if (!s.getId().equals(session.getId())
                        && s.isOpen()) {
                    s.sendMessage(message);
                    forwardedCount++;
                }
            }
            System.out.println("Forwarded message '" + signal.getType() + "' to " + forwardedCount + " other sessions.");
        } catch (Exception e) {
            System.err.println("Error processing signaling message: " + e.getMessage());
            e.printStackTrace();
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session,
                                      CloseStatus status) {

        rooms.values().forEach(sessions -> sessions.remove(session));

        System.out.println("Disconnected: " + session.getId());
    }
}
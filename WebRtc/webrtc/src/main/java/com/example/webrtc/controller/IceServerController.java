package com.example.webrtc.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Provides ICE server configuration (STUN/TURN) to the frontend dynamically.
 * Centralizing this here means TURN credentials can be updated without redeploying the frontend.
 */
@RestController
@RequestMapping("/api")
public class IceServerController {

    @GetMapping("/ice-servers")
    public List<Map<String, Object>> getIceServers() {
        return List.of(
            // Google STUN servers (very reliable)
            Map.of("urls", List.of(
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302",
                "stun:stun3.l.google.com:19302",
                "stun:stun4.l.google.com:19302"
            )),
            // Cloudflare STUN (extremely reliable)
            Map.of("urls", List.of(
                "stun:stun.cloudflare.com:3478"
            )),
            // Open Relay STUN fallback
            Map.of("urls", List.of(
                "stun:openrelay.metered.ca:80",
                "stun:openrelay.metered.ca:443"
            )),
            // Open Relay TURN — port 80 (UDP, most permissive)
            Map.of(
                "urls", "turn:openrelay.metered.ca:80",
                "username", "openrelayproject",
                "credential", "openrelayproject"
            ),
            // Open Relay TURN — port 443 (TCP, bypasses most firewalls)
            Map.of(
                "urls", "turn:openrelay.metered.ca:443",
                "username", "openrelayproject",
                "credential", "openrelayproject"
            ),
            Map.of(
                "urls", "turn:openrelay.metered.ca:443?transport=tcp",
                "username", "openrelayproject",
                "credential", "openrelayproject"
            ),
            // Open Relay TURNS — TLS-wrapped (required for HTTPS/Render deployments)
            Map.of(
                "urls", "turns:openrelay.metered.ca:443",
                "username", "openrelayproject",
                "credential", "openrelayproject"
            ),
            Map.of(
                "urls", "turns:openrelay.metered.ca:443?transport=tcp",
                "username", "openrelayproject",
                "credential", "openrelayproject"
            ),
            // Metered free TURN (alternate hostname)
            Map.of(
                "urls", "turn:relay.metered.ca:80",
                "username", "openrelayproject",
                "credential", "openrelayproject"
            ),
            Map.of(
                "urls", "turn:relay.metered.ca:443",
                "username", "openrelayproject",
                "credential", "openrelayproject"
            ),
            Map.of(
                "urls", "turns:relay.metered.ca:443",
                "username", "openrelayproject",
                "credential", "openrelayproject"
            )
        );
    }
}

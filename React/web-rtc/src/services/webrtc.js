// webrtc.js

export class WebRTCService {
  constructor(roomId, socket, localVideoRef, remoteVideoRef, username, onConnectionStateChange, onRemoteUsername) {
    this.roomId = roomId;
    this.socket = socket;
    this.localVideoRef = localVideoRef;
    this.remoteVideoRef = remoteVideoRef;
    this.username = username || "Guest";
    this.onConnectionStateChange = onConnectionStateChange;
    this.onRemoteUsername = onRemoteUsername;

    this.peer = null;
    this.localStream = null;
    this.myId = this.generateUUID();
    this.messageQueue = [];
    this.remoteIceCandidatesQueue = [];
    this.remoteDescriptionSet = false;
    this.boundHandleMessage = null;
    this.onOpenHandler = null;
    this.pingInterval = null;
    this.iceServers = null;

    // Negotiation role — only the initiator (offer sender) drives ICE restarts
    this.isInitiator = false;
    this.iceRestartTimeout = null;
    this.iceRestartCount = 0;
    this.MAX_ICE_RESTARTS = 2;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  async init() {
    let constraints = { video: true, audio: true };
    let errorMsg = null;

    if (!navigator.mediaDevices) {
      errorMsg = "Media devices API not supported in this browser/environment (requires HTTPS/localhost).";
      console.error(errorMsg);
    } else {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideoDevice = devices.some(d => d.kind === "videoinput");
        const hasAudioDevice = devices.some(d => d.kind === "audioinput");
        constraints.video = hasVideoDevice;
        constraints.audio = hasAudioDevice;
        if (!hasVideoDevice && !hasAudioDevice) throw new Error("No camera or microphone devices found.");
      } catch (e) {
        console.warn("Could not check devices or none found. Attempting default access...", e);
      }

      try {
        if (constraints.video || constraints.audio) {
          this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        }
      } catch (error) {
        console.error("Failed to get media with constraints:", constraints, error);
        errorMsg = error.message || String(error);
        if (constraints.video && constraints.audio) {
          try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            errorMsg = "Camera not found or blocked. Joined with microphone only.";
          } catch {
            try {
              this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
              errorMsg = "Microphone not found or blocked. Joined with camera only.";
            } catch {
              errorMsg = "Could not access camera or microphone. Joined in passive view-only mode.";
              this.localStream = null;
            }
          }
        } else {
          errorMsg = "Could not access required media devices. Joined in passive view-only mode.";
          this.localStream = null;
        }
      }
    }

    if (this.localStream && this.localVideoRef?.current) {
      this.localVideoRef.current.srcObject = this.localStream;
    }

    await this.fetchIceServers();
    this.createPeer();

    this.boundHandleMessage = this.handleMessage.bind(this);
    this.socket.addEventListener("message", this.boundHandleMessage);

    this.onOpenHandler = () => {
      this.send("join", {});
      this.sendUsername(true);
      this.flushQueue();

      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => {
        if (this.socket.readyState === WebSocket.OPEN) {
          this.send("ping", {});
        }
      }, 15000);
    };

    if (this.socket.readyState === WebSocket.OPEN) {
      this.onOpenHandler();
    } else {
      this.socket.addEventListener("open", this.onOpenHandler);
    }

    const videoActive = this.localStream ? this.localStream.getVideoTracks().length > 0 : false;
    const audioActive = this.localStream ? this.localStream.getAudioTracks().length > 0 : false;

    return { success: !!this.localStream, video: videoActive, audio: audioActive, error: errorMsg };
  }

  // ─── ICE Server Config ─────────────────────────────────────────────────────

  async fetchIceServers() {
    try {
      const res = await fetch("/api/ice-servers");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.iceServers = await res.json();
      console.log(`Fetched ${this.iceServers.length} ICE servers from backend.`);
    } catch (err) {
      console.warn("Could not fetch ICE servers from backend, using hardcoded defaults.", err);
      this.iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "turn:openrelay.metered.ca:80",              username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443",             username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turns:openrelay.metered.ca:443",            username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
      ];
    }
  }

  // ─── Peer Connection ───────────────────────────────────────────────────────

  createPeer() {
    this.peer = new RTCPeerConnection({
      iceServers: this.iceServers || [{ urls: "stun:stun.l.google.com:19302" }],
      iceCandidatePoolSize: 10,
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => this.peer.addTrack(track, this.localStream));
    }

    this.peer.ontrack = (event) => {
      if (this.remoteVideoRef?.current && event.streams[0]) {
        this.remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    this.peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.send("candidate", event.candidate.toJSON());
      }
    };

    // ── ICE connection state: only the INITIATOR drives restarts ──────────────
    this.peer.oniceconnectionstatechange = () => {
      const iceState = this.peer?.iceConnectionState;
      console.log(`ICE connection state: ${iceState} (isInitiator=${this.isInitiator})`);

      if (iceState === "connected" || iceState === "completed") {
        if (this.iceRestartTimeout) { clearTimeout(this.iceRestartTimeout); this.iceRestartTimeout = null; }
        this.iceRestartCount = 0;
        console.log("ICE connection established successfully.");
      }

      if (!this.isInitiator) return; // Responder never drives restarts

      if (iceState === "failed") {
        if (this.iceRestartTimeout) clearTimeout(this.iceRestartTimeout);
        this.iceRestartTimeout = setTimeout(() => this._attemptIceRestart(), 1000);
      } else if (iceState === "disconnected") {
        if (this.iceRestartTimeout) clearTimeout(this.iceRestartTimeout);
        this.iceRestartTimeout = setTimeout(() => {
          if (this.peer?.iceConnectionState === "disconnected") {
            this._attemptIceRestart();
          }
        }, 4000);
      }
    };

    this.peer.onconnectionstatechange = () => {
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.peer.connectionState);
      }
    };
  }

  /**
   * Attempts an ICE restart if we are the initiator.
   * After MAX_ICE_RESTARTS failures, does a full peer reset instead.
   */
  async _attemptIceRestart() {
    if (!this.peer || this.peer.signalingState === "closed") return;
    if (this.iceRestartCount >= this.MAX_ICE_RESTARTS) {
      console.warn(`ICE restart limit (${this.MAX_ICE_RESTARTS}) reached. Doing full peer reset...`);
      this.iceRestartCount = 0;
      this._resetPeer();
      await this.createOffer(false); // fresh offer, not a restart
      return;
    }
    this.iceRestartCount++;
    console.log(`ICE restart attempt ${this.iceRestartCount}/${this.MAX_ICE_RESTARTS}...`);
    // ICE restart: new offer with iceRestart flag keeps same peer connection
    await this.createOffer(true);
  }

  /**
   * Closes and recreates the peer connection, resetting all ICE/negotiation state.
   */
  _resetPeer() {
    if (this.peer) {
      this.peer.onicecandidate = null;
      this.peer.oniceconnectionstatechange = null;
      this.peer.onconnectionstatechange = null;
      this.peer.ontrack = null;
      this.peer.close();
    }
    this.remoteDescriptionSet = false;
    this.remoteIceCandidatesQueue = [];
    this.createPeer();
  }

  // ─── Offer / Answer ────────────────────────────────────────────────────────

  /**
   * Creates and sends an SDP offer.
   * @param {boolean} iceRestart - If true, triggers an ICE restart (same peer, new credentials).
   */
  async createOffer(iceRestart = false) {
    if (!this.peer || this.peer.signalingState === "closed") {
      console.warn("createOffer called on closed/null peer. Aborting.");
      return;
    }

    console.log(`Creating ${iceRestart ? "ICE-restart" : "initial"} offer...`);
    this.isInitiator = true; // Mark self as initiator

    const offer = await this.peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
      iceRestart,
    });
    await this.peer.setLocalDescription(offer);
    this.send("offer", offer);
  }

  // ─── Message Handling ──────────────────────────────────────────────────────

  async handleMessage(message) {
    if (!this.peer || this.peer.signalingState === "closed") {
      console.warn("Ignoring message: peer is closed or null.", message.data?.substring?.(0, 80));
      return;
    }

    const signal = JSON.parse(message.data);

    try {
      switch (signal.type) {

        case "username": {
          console.log(`Remote username: ${signal.data.username} (ID: ${signal.data.id})`);
          if (this.onRemoteUsername) this.onRemoteUsername(signal.data.username);

          // Reply with our username if requested (new peer joined)
          if (signal.data.reply) this.sendUsername(false);

          // Initiator decision: smaller UUID string = initiator
          if (this.myId < signal.data.id) {
            const connState = this.peer.connectionState;
            // Only auto-offer if not already negotiated
            if (connState === "new" || connState === "failed" || connState === "disconnected") {
              console.log("Acting as initiator. Scheduling auto-offer in 600ms...");
              setTimeout(() => {
                if (!this.peer || this.peer.signalingState === "closed") return;
                const cs = this.peer.connectionState;
                if (this.remoteDescriptionSet || cs === "connecting" || cs === "connected") {
                  console.log(`Skipping auto-offer: already negotiated (state=${cs}, remoteSet=${this.remoteDescriptionSet}).`);
                  return;
                }
                // Reset if peer is in a stale signaling state
                if (this.peer.signalingState !== "stable") {
                  console.log(`Signaling state '${this.peer.signalingState}' is not stable — resetting peer.`);
                  this._resetPeer();
                }
                this.createOffer(false);
              }, 600);
            } else {
              console.log(`Skipping auto-offer: connectionState is '${connState}'.`);
            }
          } else {
            console.log("Acting as responder. Waiting for remote offer...");
          }
          break;
        }

        case "full":
          console.error("Room is full. Cannot join.");
          if (this.onConnectionStateChange) this.onConnectionStateChange("failed", "Room is full (max 2 participants).");
          this.stop();
          break;

        case "offer": {
          if (this.peer.signalingState === "closed") return;
          console.log("Received remote offer.");

          this.isInitiator = false; // We are the responder for this negotiation

          // If we are in a bad state, reset before processing the offer
          const sigState = this.peer.signalingState;
          const connState = this.peer.connectionState;
          if (sigState !== "stable" || connState === "failed" || connState === "closed") {
            console.log(`Resetting peer (signalingState=${sigState}, connectionState=${connState}) to process incoming offer cleanly.`);
            this._resetPeer();
          }

          await this.peer.setRemoteDescription(new RTCSessionDescription(signal.data));
          const answer = await this.peer.createAnswer();
          await this.peer.setLocalDescription(answer);
          this.send("answer", answer);
          await this.processBufferedCandidates();
          break;
        }

        case "answer": {
          if (this.peer.signalingState === "closed") return;
          if (this.peer.signalingState !== "have-local-offer") {
            console.warn(`Ignoring answer: unexpected signalingState '${this.peer.signalingState}'.`);
            return;
          }
          console.log("Received remote answer.");
          await this.peer.setRemoteDescription(new RTCSessionDescription(signal.data));
          await this.processBufferedCandidates();
          break;
        }

        case "candidate": {
          if (this.peer.signalingState === "closed") return;
          if (!signal.data || !signal.data.candidate) break; // Null candidate = end-of-candidates
          const candidate = new RTCIceCandidate(signal.data);
          if (this.remoteDescriptionSet) {
            await this.peer.addIceCandidate(candidate);
          } else {
            this.remoteIceCandidatesQueue.push(candidate);
          }
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error(`Error processing signaling message '${signal?.type}':`, err);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  async processBufferedCandidates() {
    this.remoteDescriptionSet = true;
    while (this.remoteIceCandidatesQueue.length > 0) {
      const c = this.remoteIceCandidatesQueue.shift();
      try {
        if (this.peer && this.peer.signalingState !== "closed") {
          await this.peer.addIceCandidate(c);
        }
      } catch (e) {
        console.error("Error adding buffered ICE candidate:", e);
      }
    }
  }

  sendUsername(needsReply = true) {
    this.send("username", { username: this.username, id: this.myId, reply: needsReply });
  }

  generateUUID() {
    if (typeof window !== "undefined" && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  send(type, data) {
    const payload = JSON.stringify({ type, roomId: this.roomId, sender: this.myId, data });
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      this.messageQueue.push(payload);
    } else {
      console.error(`WebSocket not open (state: ${this.socket.readyState}). Cannot send type '${type}'.`);
    }
  }

  flushQueue() {
    while (this.messageQueue.length > 0 && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(this.messageQueue.shift());
    }
  }

  // ─── Media Controls ────────────────────────────────────────────────────────

  toggleMic() {
    if (!this.localStream) return false;
    const tracks = this.localStream.getAudioTracks();
    let state = false;
    tracks.forEach(t => { t.enabled = !t.enabled; state = t.enabled; });
    return state;
  }

  toggleCamera() {
    if (!this.localStream) return false;
    const tracks = this.localStream.getVideoTracks();
    let state = false;
    tracks.forEach(t => { t.enabled = !t.enabled; state = t.enabled; });
    return state;
  }

  // ─── Stop / Cleanup ────────────────────────────────────────────────────────

  stop() {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.iceRestartTimeout) { clearTimeout(this.iceRestartTimeout); this.iceRestartTimeout = null; }

    // Stop every media track so the browser releases the camera/mic hardware
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;

    // Detach streams from video elements — this is critical:
    // the browser keeps the camera/mic indicator active as long as a video
    // element's srcObject holds a reference to the stream, even if all
    // tracks have been stopped. Nulling srcObject forces immediate release.
    if (this.localVideoRef?.current) {
      this.localVideoRef.current.srcObject = null;
    }
    if (this.remoteVideoRef?.current) {
      this.remoteVideoRef.current.srcObject = null;
    }

    if (this.peer) {
      this.peer.onicecandidate = null;
      this.peer.oniceconnectionstatechange = null;
      this.peer.onconnectionstatechange = null;
      this.peer.ontrack = null;
      this.peer.close();
      this.peer = null;
    }

    if (this.socket) {
      if (this.boundHandleMessage) this.socket.removeEventListener("message", this.boundHandleMessage);
      if (this.onOpenHandler) this.socket.removeEventListener("open", this.onOpenHandler);
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
    }

    this.remoteIceCandidatesQueue = [];
    this.remoteDescriptionSet = false;
    this.isInitiator = false;
    this.iceRestartCount = 0;
  }

  // ─── Camera Switch ─────────────────────────────────────────────────────────

  async switchCamera(currentFacingMode) {
    if (!this.localStream) return currentFacingMode;
    const newFacingMode = currentFacingMode === "user" ? "environment" : "user";
    const videoTracks = this.localStream.getVideoTracks();
    videoTracks.forEach(t => t.stop());

    const tryGetStream = async (constraints) => {
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      return s.getVideoTracks()[0];
    };

    let newTrack;
    try {
      newTrack = await tryGetStream({ video: { facingMode: { exact: newFacingMode } }, audio: false });
    } catch {
      try {
        newTrack = await tryGetStream({ video: { facingMode: newFacingMode }, audio: false });
      } catch (err) {
        console.error("Camera switch failed:", err);
        try {
          const recovery = await tryGetStream({ video: { facingMode: currentFacingMode }, audio: false });
          this.localStream.addTrack(recovery);
          if (this.localVideoRef?.current) this.localVideoRef.current.srcObject = this.localStream;
        } catch {}
        throw err;
      }
    }

    videoTracks.forEach(t => this.localStream.removeTrack(t));
    this.localStream.addTrack(newTrack);

    if (this.peer) {
      const sender = this.peer.getSenders().find(s => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(newTrack);
    }

    if (this.localVideoRef?.current) this.localVideoRef.current.srcObject = this.localStream;
    return newFacingMode;
  }
}
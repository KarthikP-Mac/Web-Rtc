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
    this.myId = this.generateUUID(); // Unique local connection ID
    this.messageQueue = []; // Queue to buffer WebSocket messages if connection is still establishing
    this.remoteIceCandidatesQueue = []; // Buffer incoming ICE candidates if they arrive before remote description
    this.remoteDescriptionSet = false;
    this.boundHandleMessage = null;
    this.onOpenHandler = null;
    this.pingInterval = null;
  }

  async init() {
    let constraints = { video: true, audio: true };
    let errorMsg = null;

    if (!navigator.mediaDevices) {
      errorMsg = "Media devices API not supported in this browser/environment (requires HTTPS/localhost).";
      console.error(errorMsg);
    } else {
      try {
        // Enumerate devices to see what is connected
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasVideoDevice = devices.some(d => d.kind === "videoinput");
        const hasAudioDevice = devices.some(d => d.kind === "audioinput");

        constraints.video = hasVideoDevice;
        constraints.audio = hasAudioDevice;

        if (!hasVideoDevice && !hasAudioDevice) {
          throw new Error("No camera or microphone devices found.");
        }
      } catch (e) {
        console.warn("Could not check devices or none found. Attempting default access...", e);
      }

      // Try acquiring stream based on constraints
      try {
        if (constraints.video || constraints.audio) {
          this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        }
      } catch (error) {
        console.error("Failed to get media with constraints:", constraints, error);
        errorMsg = error.message || String(error);

        // Fallback: If we tried both, try audio-only or video-only
        if (constraints.video && constraints.audio) {
          try {
            console.log("Retrying with audio-only...");
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            errorMsg = "Camera not found or blocked. Joined with microphone only.";
          } catch (audioErr) {
            try {
              console.log("Retrying with video-only...");
              this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
              errorMsg = "Microphone not found or blocked. Joined with camera only.";
            } catch (videoErr) {
              console.error("All media capture attempts failed.");
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

    this.createPeer();

    this.boundHandleMessage = this.handleMessage.bind(this);
    this.socket.addEventListener("message", this.boundHandleMessage);

    this.onOpenHandler = () => {
      this.send("join", {});
      this.sendUsername(true);
      this.flushQueue();

      // Start client-side heartbeat to keep Render proxy connection active
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

    return {
      success: !!this.localStream,
      video: videoActive,
      audio: audioActive,
      error: errorMsg,
    };
  }

  createPeer() {
    this.peer = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        // Open Relay Project TURN Fallback (for symmetric NATs & mobile networks on Render)
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ],
    });

    // Add tracks if local stream exists
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peer.addTrack(track, this.localStream);
      });
    }

    // Remote stream
    this.peer.ontrack = (event) => {
      if (this.remoteVideoRef?.current && event.streams[0]) {
        this.remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // ICE candidates
    this.peer.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`Generated local ICE candidate: ${event.candidate.candidate.substring(0, 60)}...`);
        this.send("candidate", event.candidate);
      }
    };

    // Connection state change
    this.peer.onconnectionstatechange = () => {
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.peer.connectionState);
      }
    };
  }

  async createOffer() {
    const offer = await this.peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this.peer.setLocalDescription(offer);

    this.send("offer", offer);
  }

  async handleMessage(message) {
    if (!this.peer || this.peer.signalingState === "closed") {
      console.warn("RTCPeerConnection is closed or null. Ignoring incoming message:", message.data);
      return;
    }

    const signal = JSON.parse(message.data);

    try {
      switch (signal.type) {
        case "username":
          console.log(`Remote username received: ${signal.data.username} (ID: ${signal.data.id})`);
          if (this.onRemoteUsername) {
            this.onRemoteUsername(signal.data.username);
          }
          // Handshake: If the remote peer requested a reply, it means they just joined (or rejoined)!
          // We reply with our name and metadata.
          if (signal.data.reply) {
            this.sendUsername(false);
          }

          if (this.myId < signal.data.id) {
            const state = this.peer ? this.peer.connectionState : "new";
            if (state === "new" || state === "failed" || state === "disconnected") {
              console.log("Local ID is smaller. Acting as initiator. Initiating WebRTC call offer...");
              setTimeout(() => {
                if (!this.peer || this.peer.signalingState === "closed") return;

                // If peer is stuck in a non-stable state from a previous attempt, reset it
                if (this.peer.signalingState !== "stable") {
                  console.log(`Peer in '${this.peer.signalingState}' state. Resetting for fresh negotiation...`);
                  this.peer.close();
                  this.createPeer();
                  this.remoteDescriptionSet = false;
                  this.remoteIceCandidatesQueue = [];
                }

                console.log("Auto-initiating WebRTC offer to new/rejoined participant...");
                this.createOffer();
              }, 600);
            } else {
              console.log(`Local ID is smaller but connectionState is '${state}'. Skipping auto-offer.`);
            }
          } else {
            console.log("Local ID is larger. Acting as responder. Waiting for remote WebRTC offer...");
          }
          break;

        case "full":
          console.error("Room is full. Cannot join.");
          if (this.onConnectionStateChange) {
            this.onConnectionStateChange("failed", "Room is full (max 2 participants).");
          }
          this.stop();
          break;

        case "offer":
          if (this.peer.signalingState === "closed") return;
          console.log("Received remote WebRTC offer, processing...");
          await this.peer.setRemoteDescription(
            new RTCSessionDescription(signal.data)
          );

          const answer = await this.peer.createAnswer();
          await this.peer.setLocalDescription(answer);

          this.send("answer", answer);
          await this.processBufferedCandidates();
          break;

        case "answer":
          if (this.peer.signalingState === "closed") return;
          console.log("Received remote WebRTC answer, processing...");
          await this.peer.setRemoteDescription(
            new RTCSessionDescription(signal.data)
          );
          await this.processBufferedCandidates();
          break;

        case "candidate":
          if (this.peer.signalingState === "closed") return;
          const candidate = new RTCIceCandidate(signal.data);
          if (this.remoteDescriptionSet) {
            console.log(`Adding remote ICE candidate: ${candidate.candidate.substring(0, 60)}...`);
            await this.peer.addIceCandidate(candidate);
          } else {
            console.log(`Queueing remote ICE candidate until remote description is set: ${candidate.candidate.substring(0, 60)}...`);
            this.remoteIceCandidatesQueue.push(candidate);
          }
          break;

        default:
          console.log(`Received unknown signaling message type: ${signal.type}`);
          break;
      }
    } catch (err) {
      console.error("Error processing WebRTC signaling message:", signal?.type, err);
    }
  }

  sendUsername(needsReply = true) {
    this.send("username", { username: this.username, id: this.myId, reply: needsReply });
  }

  generateUUID() {
    if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  send(type, data) {
    const payload = JSON.stringify({
      type,
      roomId: this.roomId,
      sender: this.generateUUID(),
      data,
    });

    console.log(`Sending WebRTC signaling message: ${type}`);
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      console.warn(`WebSocket still connecting. Queueing message type: ${type}`);
      this.messageQueue.push(payload);
    } else {
      console.error(`WebSocket is not open (state: ${this.socket.readyState}). Cannot send message type: ${type}`);
    }
  }

  flushQueue() {
    if (this.messageQueue.length > 0) {
      console.log(`Flushing ${this.messageQueue.length} buffered WebSocket messages...`);
      while (this.messageQueue.length > 0 && this.socket.readyState === WebSocket.OPEN) {
        const payload = this.messageQueue.shift();
        this.socket.send(payload);
      }
    }
  }

  async processBufferedCandidates() {
    this.remoteDescriptionSet = true;
    if (this.remoteIceCandidatesQueue.length > 0) {
      console.log(`Processing ${this.remoteIceCandidatesQueue.length} buffered remote ICE candidates...`);
      while (this.remoteIceCandidatesQueue.length > 0) {
        const candidate = this.remoteIceCandidatesQueue.shift();
        try {
          if (this.peer && this.peer.signalingState !== "closed") {
            console.log(`Adding buffered remote ICE candidate: ${candidate.candidate.substring(0, 60)}...`);
            await this.peer.addIceCandidate(candidate);
          }
        } catch (e) {
          console.error("Error adding buffered remote ICE candidate:", e);
        }
      }
    }
  }

  toggleMic() {
    if (!this.localStream) return false;
    const audioTracks = this.localStream.getAudioTracks();
    let state = false;
    audioTracks.forEach((track) => {
      track.enabled = !track.enabled;
      state = track.enabled;
    });
    return state;
  }

  toggleCamera() {
    if (!this.localStream) return false;
    const videoTracks = this.localStream.getVideoTracks();
    let state = false;
    videoTracks.forEach((track) => {
      track.enabled = !track.enabled;
      state = track.enabled;
    });
    return state;
  }

  stop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.localStream?.getTracks().forEach((t) => t.stop());
    
    if (this.peer) {
      this.peer.close();
      this.peer = null;
    }

    if (this.socket) {
      if (this.boundHandleMessage) {
        this.socket.removeEventListener("message", this.boundHandleMessage);
      }
      if (this.onOpenHandler) {
        this.socket.removeEventListener("open", this.onOpenHandler);
      }
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
    }

    this.remoteIceCandidatesQueue = [];
    this.remoteDescriptionSet = false;
  }

  async switchCamera(currentFacingMode) {
    if (!this.localStream) return currentFacingMode;

    const newFacingMode = currentFacingMode === "user" ? "environment" : "user";
    
    const videoTracks = this.localStream.getVideoTracks();
    videoTracks.forEach((track) => track.stop());

    const constraints = {
      video: { facingMode: { exact: newFacingMode } },
      audio: false,
    };

    try {
      console.log(`Attempting to switch camera to: ${newFacingMode}`);
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVideoTrack = newStream.getVideoTracks()[0];

      videoTracks.forEach((track) => this.localStream.removeTrack(track));
      this.localStream.addTrack(newVideoTrack);

      if (this.peer) {
        const senders = this.peer.getSenders();
        const videoSender = senders.find(
          (sender) => sender.track && sender.track.kind === "video"
        );
        if (videoSender) {
          console.log("Replacing video track on existing peer connection...");
          await videoSender.replaceTrack(newVideoTrack);
        }
      }

      if (this.localVideoRef?.current) {
        this.localVideoRef.current.srcObject = this.localStream;
      }

      return newFacingMode;
    } catch (error) {
      console.warn(`Failed exact constraints for facingMode: ${newFacingMode}. Retrying with loose constraints...`, error);
      
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: newFacingMode },
          audio: false,
        });
        const fallbackVideoTrack = fallbackStream.getVideoTracks()[0];

        videoTracks.forEach((track) => this.localStream.removeTrack(track));
        this.localStream.addTrack(fallbackVideoTrack);

        if (this.peer) {
          const senders = this.peer.getSenders();
          const videoSender = senders.find(
            (sender) => sender.track && sender.track.kind === "video"
          );
          if (videoSender) {
            await videoSender.replaceTrack(fallbackVideoTrack);
          }
        }

        if (this.localVideoRef?.current) {
          this.localVideoRef.current.srcObject = this.localStream;
        }

        return newFacingMode;
      } catch (err) {
        console.error("Camera switch completely failed:", err);

        try {
          const recoveryStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: false,
          });
          const recoveryTrack = recoveryStream.getVideoTracks()[0];
          this.localStream.addTrack(recoveryTrack);
          
          if (this.localVideoRef?.current) {
            this.localVideoRef.current.srcObject = this.localStream;
          }
        } catch (recoveryErr) {
          console.error("Failed to recover original camera track:", recoveryErr);
        }
        
        throw err;
      }
    }
  }
}
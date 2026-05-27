import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { WebRTCService } from "../services/webrtc";

function MeetingPage() {
  const rawRoomId = useParams().roomId || "";
  const roomId = rawRoomId.trim().toLowerCase();
  const navigate = useNavigate();

  const localVideo = useRef();
  const remoteVideo = useRef();
  const socket = useRef();
  const rtcService = useRef(null);

  // States
  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [tempUsername, setTempUsername] = useState("");
  const [modalError, setModalError] = useState("");

  const [remoteUsername, setRemoteUsername] = useState("Remote Participant");
  const [deviceInfo, setDeviceInfo] = useState({
    hasCamera: false,
    hasMic: false,
    warning: null,
  });
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState("new");
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const initialized = useRef(false);
  const connectionId = useRef(0);

  useEffect(() => {
    if (username && !initialized.current) {
      initialized.current = true;
      initMeeting(username);
    }

    return () => {
      // Invalidate any active connection attempts
      // eslint-disable-next-line react-hooks/exhaustive-deps
      connectionId.current++;

      // Close active socket
      if (socket.current) {
        socket.current.onclose = null;
        socket.current.onerror = null;
        socket.current.onmessage = null;
        if (socket.current.readyState === WebSocket.OPEN || socket.current.readyState === WebSocket.CONNECTING) {
          socket.current.close();
        }
        socket.current = null;
      }

      if (initialized.current) {
        rtcService.current?.stop();
        rtcService.current = null;
        initialized.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function initMeeting(currentUsername) {
    const currentId = ++connectionId.current;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;

    // Build the primary (same-origin proxy) and fallback (direct port 8080) URLs
    const primaryWsUrl = `${protocol}//${host}/signal`;

    let fallbackWsUrl;
    const devtunnelMatch = host.match(/^(.+)-3000(\..*\.devtunnels\.ms)$/);
    if (devtunnelMatch) {
      fallbackWsUrl = `${protocol}//${devtunnelMatch[1]}-8080${devtunnelMatch[2]}/signal`;
    } else if (host.startsWith("localhost:3000") || host.startsWith("127.0.0.1:3000")) {
      fallbackWsUrl = `ws://localhost:8080/signal`;
    } else {
      fallbackWsUrl = primaryWsUrl; // No fallback needed in production
    }

    let isUsingFallback = false;

    const establishConnection = (wsUrl) => {
      if (currentId !== connectionId.current) return;

      console.log(`Connecting to WebSocket signaling at: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      socket.current = ws;

      let connectionTimeout = null;
      let hasFailedOrClosed = false;
      let wasOpened = false; // Guard: only fallback if socket never opened

      const triggerFallback = () => {
        if (wasOpened) return; // Connection already succeeded — don't fallback on later closes
        if (currentId !== connectionId.current) return;
        if (!isUsingFallback && fallbackWsUrl !== wsUrl && !hasFailedOrClosed) {
          hasFailedOrClosed = true;
          console.warn(`WebSocket to ${wsUrl} failed/timed-out before opening. Attempting fallback...`);
          isUsingFallback = true;

          try { ws.close(); } catch (e) { }
          rtcService.current?.stop();

          if (connectionTimeout) clearTimeout(connectionTimeout);

          establishConnection(fallbackWsUrl);
        }
      };

      // If socket hasn't opened within 2 seconds, trigger fallback
      connectionTimeout = setTimeout(() => {
        if (!wasOpened) triggerFallback();
      }, 2000);

      ws.addEventListener("open", () => {
        wasOpened = true; // Mark as successfully opened
        if (currentId !== connectionId.current) return;
        if (connectionTimeout) clearTimeout(connectionTimeout);
        console.log(`WebSocket successfully opened: ${wsUrl}`);
      });

      ws.addEventListener("error", () => {
        if (!wasOpened) triggerFallback();
      });

      ws.addEventListener("close", () => {
        // Only fallback if the socket never successfully opened
        if (!wasOpened) triggerFallback();
      });

      const onConnectionChange = (state, customWarning = null) => {
        if (currentId !== connectionId.current) return;
        console.log("WebRTC Connection State changed to:", state);
        setConnectionState(state);
        if (state === "disconnected" || state === "closed" || state === "failed") {
          setRemoteUsername("Remote Participant");
        }
        if (customWarning) {
          setDeviceInfo(prev => ({
            ...prev,
            warning: customWarning
          }));
        }
      };

      const onRemoteUserReceived = (name) => {
        if (currentId !== connectionId.current) return;
        console.log("Received remote participant name:", name);
        setRemoteUsername(name);
      };

      rtcService.current = new WebRTCService(
        roomId,
        ws,
        localVideo,
        remoteVideo,
        currentUsername,
        onConnectionChange,
        onRemoteUserReceived
      );

      rtcService.current.init().then((status) => {
        if (currentId !== connectionId.current) return;
        console.log("WebRTC Init status:", status);
        setDeviceInfo({
          hasCamera: status.video,
          hasMic: status.audio,
          warning: status.error,
        });
        setCameraEnabled(status.video);
        setMicEnabled(status.audio);
      }).catch((e) => {
        if (currentId !== connectionId.current) return;
        console.error("WebRTC Init failed:", e);
        setDeviceInfo({
          hasCamera: false,
          hasMic: false,
          warning: "Could not access media devices. Placed in Passive Mode.",
        });
        setCameraEnabled(false);
        setMicEnabled(false);
      });
    };

    // Begin by trying the primary same-origin / proxy URL first
    establishConnection(primaryWsUrl);
  }

  function handleJoinLobby(e) {
    e.preventDefault();
    if (!tempUsername.trim()) {
      setModalError("Please enter your name to enter the meeting.");
      return;
    }
    const name = tempUsername.trim();
    localStorage.setItem("username", name);
    setUsername(name);
    initialized.current = true;
    initMeeting(name);
  }

  function startCall() {
    if (rtcService.current) {
      console.log("Manually initiating WebRTC call offer...");
      setConnectionState("connecting");
      rtcService.current.createOffer();
    } else {
      console.warn("Cannot start call: WebRTC service is not initialized yet.");
    }
  }

  function toggleMic() {
    if (rtcService.current && deviceInfo.hasMic) {
      const state = rtcService.current.toggleMic();
      setMicEnabled(state);
    }
  }

  function toggleCamera() {
    if (rtcService.current && deviceInfo.hasCamera) {
      const state = rtcService.current.toggleCamera();
      setCameraEnabled(state);
    }
  }

  function endCall() {
    rtcService.current?.stop();
    navigate("/");
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyRoomId() {
    navigator.clipboard.writeText(roomId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  // Icons Helpers
  const MicIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );

  const MicOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 11v-1" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <path d="M15 9.34V5a3 3 0 0 0-5.94-.6" />
      <path d="M5 10v1a7 7 0 0 0 8 6.92" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );

  const CameraIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
      <path d="m22 8-6 4 6 4V8Z" />
      <rect x="2" y="6" width="14" height="12" rx="2" ry="2" />
    </svg>
  );

  const CameraOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="m22 8-6 4 6 4V8Z" />
      <rect x="2" y="6" width="14" height="12" rx="2" ry="2" style={{ clipPath: "polygon(0 0, 100% 0, 100% 35%, 0 35%)" }} />
      <path d="M2 10v6a2 2 0 0 0 2 2h8" />
    </svg>
  );

  const PhoneOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
      <path d="m3 21 1.9-1.9a16 16 0 0 0 18-18L21 3" />
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67 19.42 19.42 0 0 1-2.67-3.33 19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.18 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );

  const ShareIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon-small">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );

  const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="btn-icon-small text-emerald">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  const WarningIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="warning-icon">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );

  // If no username exists (direct link access), display the lobby join card first
  if (!username) {
    return (
      <div className="home">
        <div className="card">
          <h1>Join Meeting</h1>
          <p>You have been invited to a video call</p>

          <form onSubmit={handleJoinLobby} className="lobby-form">
            <div className="input-group">
              <label htmlFor="modal-username" className="input-label">Your Name</label>
              <input
                type="text"
                id="modal-username"
                placeholder="e.g. Karthik"
                value={tempUsername}
                onChange={(e) => {
                  setTempUsername(e.target.value);
                  if (e.target.value.trim()) setModalError("");
                }}
                className="lobby-input"
                maxLength={20}
              />
            </div>

            {modalError && (
              <div className="error-message">
                <WarningIcon />
                <span>{modalError}</span>
              </div>
            )}

            <button type="submit" title="Join the meeting" className="btn-primary-glow">
              Enter Room
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="meeting-container">
      {/* Dynamic Warning Notification Banner */}
      {deviceInfo.warning && (
        <div className="warning-banner">
          <div className="warning-content">
            <WarningIcon />
            <span>{deviceInfo.warning}</span>
          </div>
        </div>
      )}

      {/* Top Header Panel */}
      <header className="top-bar">
        <div
          className={`room-info clickable ${copiedId ? "copied" : ""}`}
          onClick={copyRoomId}
          title="Click to copy Room ID"
        >
          <span className="room-title">Meeting Room</span>
          <span className="room-id">
            #{roomId.length > 12 ? `${roomId.substring(0, 8)}...` : roomId}
            {copiedId ? (
              <span className="copy-status-tag">Copied!</span>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="copy-small-icon">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            )}
          </span>
        </div>

        <div className="top-actions">
          {/* Status Indicator */}
          <div className={`status-badge ${connectionState}`}>
            <span className="pulse-dot"></span>
            <span className="status-text">{connectionState === "connected" ? "LIVE" : connectionState.toUpperCase()}</span>
          </div>

          <button onClick={copyLink} title="Share meeting invite via link" className={`btn-secondary ${copied ? "copied" : ""}`}>
            {copied ? <CheckIcon /> : <ShareIcon />}
            <span>{copied ? "Copied!" : "Share Link"}</span>
          </button>
        </div>
      </header>

      {/* Video Streams Container */}
      <main className="videos-arena">
        {/* Local Stream Panel */}
        <div className="video-card">
          <div className="card-label">You ({username})</div>

          <video
            ref={localVideo}
            autoPlay
            muted
            playsInline
            className={`video-feed ${(!deviceInfo.hasCamera || !cameraEnabled) ? "hidden" : ""}`}
          />

          {(!deviceInfo.hasCamera || !cameraEnabled) && (
            <div className="video-placeholder">
              <div className="avatar-orb">
                <span>{username.substring(0, 2).toUpperCase()}</span>
              </div>
              <div className="placeholder-label">
                {!deviceInfo.hasCamera ? "Camera not found" : "Camera turned off"}
              </div>
            </div>
          )}

          {/* Mini mic state tag */}
          <div className="media-state-tag">
            {!micEnabled || !deviceInfo.hasMic ? (
              <span className="mic-muted-badge">
                <MicOffIcon />
              </span>
            ) : (
              <span className="mic-active-badge">
                <MicIcon />
              </span>
            )}
          </div>
        </div>

        {/* Remote Stream Panel */}
        <div className="video-card">
          <div className="card-label">{remoteUsername}</div>

          <video
            ref={remoteVideo}
            autoPlay
            playsInline
            className={`video-feed ${connectionState !== "connected" ? "hidden" : ""}`}
          />

          {connectionState !== "connected" && (
            <div className="video-placeholder remote-waiting">
              <div className="pulse-rings">
                <div className="ring ring1"></div>
                <div className="ring ring2"></div>
                <div className="ring ring3"></div>
              </div>
              <div className="avatar-orb loading">
                <span>{remoteUsername.substring(0, 2).toUpperCase()}</span>
              </div>
              <div className="placeholder-label animate-pulse">
                {connectionState === "connecting"
                  ? "Establishing peer connection..."
                  : `Waiting for ${remoteUsername} to connect...`}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Conference Controls Deck */}
      <footer className="controls-deck">
        <div className="controls-group">
          {/* Microphone Toggle */}
          <button
            onClick={toggleMic}
            className={`control-btn ${!micEnabled || !deviceInfo.hasMic ? "muted" : "active"}`}
            disabled={!deviceInfo.hasMic}
            title={!deviceInfo.hasMic ? "No microphone detected" : micEnabled ? "Mute Microphone" : "Unmute Microphone"}
          >
            {!micEnabled || !deviceInfo.hasMic ? <MicOffIcon /> : <MicIcon />}
          </button>


          {/* Connection Trigger / Status indicator */}
          {connectionState === "connected" ? (
            <div className="connection-active-indicator">
              <span className="dot animate-glowing"></span>
              <span>Connected</span>
            </div>
          ) : (
            <button onClick={startCall} className={`control-btn call-trigger ${connectionState === "connecting" ? "connecting" : "ready"}`} title="Start Connection">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span className="btn-text">{connectionState === "connecting" ? "Connecting..." : "Connect"}</span>
            </button>
          )}

          {/* Camera Toggle */}
          <button
            onClick={toggleCamera}
            className={`control-btn ${!cameraEnabled || !deviceInfo.hasCamera ? "muted" : "active"}`}
            disabled={!deviceInfo.hasCamera}
            title={!deviceInfo.hasCamera ? "No camera detected" : cameraEnabled ? "Turn Off Camera" : "Turn On Camera"}
          >
            {!cameraEnabled || !deviceInfo.hasCamera ? <CameraOffIcon /> : <CameraIcon />}
          </button>

          {/* End Call / Leave Room */}
          <button onClick={endCall} className="control-btn end-call" title="Leave Meeting">
            <PhoneOffIcon />
          </button>
        </div>
      </footer>
    </div>
  );
}

export default MeetingPage;
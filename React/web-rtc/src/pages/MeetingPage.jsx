import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { WebRTCService } from "../services/webrtc";
import VideoPlayer from "../components/VideoPlayer";
import Controls from "../components/Controls";

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
  const [isBluetoothConnected, setIsBluetoothConnected] = useState(false);
  const [facingMode, setFacingMode] = useState("user");
  const initialized = useRef(false);
  const connectionId = useRef(0);

  useEffect(() => {
    if (username && !initialized.current) {
      initialized.current = true;
      initMeeting(username);
    }

    checkBluetoothDevices();

    const handleDeviceChange = () => {
      checkBluetoothDevices();
    };

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    }

    return () => {
      connectionId.current++;

      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      }

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

      // If socket hasn't opened within 5 seconds, trigger fallback (giving Render instances more time to establish connection)
      connectionTimeout = setTimeout(() => {
        if (!wasOpened) triggerFallback();
      }, 5000);

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
        checkBluetoothDevices();
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
      if (connectionState === "connecting" || connectionState === "connected") {
        console.warn("Call connection already in progress or connected. Ignoring manual connect request.");
        return;
      }
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
    // 1. Stop all media tracks immediately so the OS releases the camera/mic hardware.
    //    We do this BEFORE navigate() because navigate() will unmount the component,
    //    which can cause the video element refs to become null/stale before stop()
    //    gets to null their srcObject — leaving the browser indicator active.
    const svc = rtcService.current;
    if (svc) {
      // Directly stop every track on the live stream
      if (svc.localStream) {
        svc.localStream.getTracks().forEach((t) => t.stop());
        svc.localStream = null;
      }
      // Detach the stream from both video elements right now, while refs are still valid
      if (localVideo.current) {
        localVideo.current.srcObject = null;
      }
      if (remoteVideo.current) {
        remoteVideo.current.srcObject = null;
      }
      // Full teardown of peer + socket
      svc.stop();
      rtcService.current = null;
    }

    // 2. Navigate away after hardware has been released
    navigate("/");
  }

  async function checkBluetoothDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Strict matching to prevent false positives on motherboard/virtual wireless controllers
      const bluetoothKeywords = ["bluetooth", "airpods", "buds", "sony wh-", "sony wf-", "freebuds", "beatspill", "powerbeats", "earset", "hfp", "a2dp"];
      const hasBluetooth = devices.some(device => {
        if (device.kind === "audioinput" || device.kind === "audiooutput") {
          const label = device.label.toLowerCase();
          return bluetoothKeywords.some(keyword => label.includes(keyword));
        }
        return false;
      });
      setIsBluetoothConnected(hasBluetooth);
    } catch (error) {
      console.warn("Error scanning Bluetooth devices:", error);
    }
  }

  async function handleSwitchCamera() {
    if (rtcService.current && deviceInfo.hasCamera && cameraEnabled) {
      try {
        const nextMode = await rtcService.current.switchCamera(facingMode);
        setFacingMode(nextMode);
      } catch (err) {
        console.error("Error switching camera:", err);
      }
    }
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
        <VideoPlayer
          videoRef={localVideo}
          username={username}
          isLocal={true}
          hasCamera={deviceInfo.hasCamera}
          cameraEnabled={cameraEnabled}
          micEnabled={micEnabled}
          hasMic={deviceInfo.hasMic}
        />

        {/* Remote Stream Panel */}
        <VideoPlayer
          videoRef={remoteVideo}
          username={remoteUsername}
          isLocal={false}
          connectionState={connectionState}
        />
      </main>

      {/* Conference Controls Deck */}
      <Controls
        micEnabled={micEnabled}
        cameraEnabled={cameraEnabled}
        deviceInfo={deviceInfo}
        connectionState={connectionState}
        isBluetoothConnected={isBluetoothConnected}
        toggleMic={toggleMic}
        toggleCamera={toggleCamera}
        startCall={startCall}
        handleSwitchCamera={handleSwitchCamera}
        endCall={endCall}
      />
    </div>
  );
}

export default MeetingPage;
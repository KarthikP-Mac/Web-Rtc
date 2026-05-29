import React from "react";

function Controls({
  micEnabled,
  cameraEnabled,
  deviceInfo,
  connectionState,
  isBluetoothConnected,
  toggleMic,
  toggleCamera,
  startCall,
  handleSwitchCamera,
  endCall,
}) {
  // SVG Icons
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

  const BluetoothIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
      <path d="m7 7 10 10-5 5V2l5 5L7 17" />
    </svg>
  );

  const SwitchCameraIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="btn-icon">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );

  return (
    <footer className="controls-deck">
      <div className="controls-group">
        {/* Bluetooth Icon Symbol (Only shown at the bottom beside other controls when connected) */}
        {isBluetoothConnected && (
          <div className="control-btn bluetooth-control-btn active" title="Bluetooth Audio Connected">
            <BluetoothIcon />
          </div>
        )}

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

        {/* Switch Camera (Mobile Front/Rear) */}
        {deviceInfo.hasCamera && cameraEnabled && (
          <button
            onClick={handleSwitchCamera}
            className="control-btn active switch-camera-btn"
            title="Switch Camera (Front/Rear)"
          >
            <SwitchCameraIcon />
          </button>
        )}

        {/* End Call / Leave Room */}
        <button onClick={endCall} className="control-btn end-call" title="Leave Meeting">
          <PhoneOffIcon />
        </button>
      </div>
    </footer>
  );
}

export default Controls;

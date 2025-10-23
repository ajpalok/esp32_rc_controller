// State management
let state = {
    leftMotor: 0,       // -255 to 255 (left motor speed)
    rightMotor: 0,      // -255 to 255 (right motor speed)
    speed: 0,           // Calculated average for backend compatibility
    steering: 0,        // Calculated differential for backend compatibility
    light: false,
    leftIndicator: false,
    rightIndicator: false,
    hazard: false,
    horn: false
};

let settings = {
    targetIp: '',              // ESP32 IP (empty = same origin)
    targetPort: ''             // ESP32 port (empty = same origin)
};

let joystickActive = {
    left: false,
    right: false
};
let updateInterval = null;

// Build API base URL from settings
function getApiBase() {
    if (settings.targetIp && settings.targetPort) {
        return `http://${settings.targetIp}:${settings.targetPort}`;
    } else if (settings.targetIp) {
        return `http://${settings.targetIp}`;
    }
    // Default: same origin (works when hosted from ESP32)
    return '';
}

// Update derived values for backend compatibility
function updateDerivedValues() {
    // Calculate speed as average of both motors (absolute values)
    state.speed = Math.round((Math.abs(state.leftMotor) + Math.abs(state.rightMotor)) / 2);
    
    // Calculate steering as differential (right - left)
    state.steering = Math.round((state.rightMotor - state.leftMotor) / 2);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initJoysticks();
    initButtons();
    initSettings();
    initFullscreen();
    startStatusUpdate();
    updateSpeedometers();
    handleOrientationChange();
    
    // Listen for orientation changes
    window.addEventListener('resize', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);
});

// Joystick control - Dual vertical joysticks for tank control
function initJoysticks() {
    initVerticalJoystick('left', 'leftJoystick');
    initVerticalJoystick('right', 'rightJoystick');
}

function initVerticalJoystick(side, elementId) {
    const joystickElement = document.getElementById(elementId);
    if (!joystickElement) return;
    
    const container = joystickElement;
    const handle = joystickElement.querySelector('.joystick-handle');
    if (!handle) return;
    
    // Each joystick tracks its own state independently
    let isDragging = false;
    let activeTouchId = null;

    function updateJoystickPosition(clientY) {
        const rect = container.getBoundingClientRect();
        const centerY = rect.height / 2;
        const maxRadius = (rect.height / 2) * 0.75;
        const y = clientY - rect.top - centerY;
        const limitedY = Math.max(-maxRadius, Math.min(maxRadius, y));
        
        // Update handle position
        const topPercent = ((centerY + limitedY) / rect.height) * 100;
        handle.style.top = `${topPercent}%`;
        
        // Calculate motor speed (inverted: up is positive/forward)
        const motorSpeed = Math.round((-limitedY / maxRadius) * 255);
        
        if (side === 'left') {
            state.leftMotor = Math.max(-255, Math.min(255, motorSpeed));
        } else {
            state.rightMotor = Math.max(-255, Math.min(255, motorSpeed));
        }
        
        updateSpeedometers();
        sendControl();
    }

    function resetJoystick() {
        isDragging = false;
        joystickActive[side] = false;
        handle.classList.remove('dragging');
        activeTouchId = null;
        handle.style.top = '50%';
        
        if (side === 'left') {
            state.leftMotor = 0;
        } else {
            state.rightMotor = 0;
        }
        
        updateSpeedometers();
        sendControl();
    }

    // Touch event handlers
    function onTouchStart(e) {
        // Only handle if we don't already have an active touch
        if (activeTouchId !== null) return;
        
        // Find a touch that started on this container
        for (let i = 0; i < e.touches.length; i++) {
            const touch = e.touches[i];
            const rect = container.getBoundingClientRect();
            if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
                touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
                
                e.preventDefault();
                isDragging = true;
                joystickActive[side] = true;
                activeTouchId = touch.identifier;
                handle.classList.add('dragging');
                updateJoystickPosition(touch.clientY);
                break;
            }
        }
    }

    function onTouchMove(e) {
        if (!isDragging || activeTouchId === null) return;
        
        // Find our specific touch
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === activeTouchId) {
                e.preventDefault();
                updateJoystickPosition(e.touches[i].clientY);
                break;
            }
        }
    }

    function onTouchEnd(e) {
        if (!isDragging || activeTouchId === null) return;
        
        // Check if our touch ended
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                e.preventDefault();
                resetJoystick();
                break;
            }
        }
    }

    // Mouse event handlers
    function onMouseDown(e) {
        e.preventDefault();
        isDragging = true;
        joystickActive[side] = true;
        handle.classList.add('dragging');
        updateJoystickPosition(e.clientY);
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        if (!isDragging) return;
        e.preventDefault();
        updateJoystickPosition(e.clientY);
    }

    function onMouseUp(e) {
        if (!isDragging) return;
        e.preventDefault();
        resetJoystick();
        
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    // Attach mouse events to handle
    handle.addEventListener('mousedown', onMouseDown);

    // Attach touch events to container (to catch touches anywhere in joystick area)
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: false });
    container.addEventListener('touchcancel', onTouchEnd, { passive: false });
}

// Update speedometers for both motors
function updateSpeedometers() {
    updateSpeedometer('left', Math.abs(state.leftMotor));
    updateSpeedometer('right', Math.abs(state.rightMotor));
}

function updateSpeedometer(side, speed) {
    const circle = document.getElementById(`${side}SpeedCircle`);
    const valueElement = document.getElementById(`${side}SpeedValue`);
    
    if (!circle || !valueElement) return;
    
    const maxValue = 255;
    const normalizedSpeed = Math.min(speed, maxValue);
    const circumference = 2 * Math.PI * 40; // radius is 40
    const offset = circumference - (normalizedSpeed / maxValue) * circumference;
    
    circle.style.strokeDashoffset = offset;
    valueElement.textContent = Math.round(normalizedSpeed);
}

// Update derived values for backend compatibility
function updateDerivedValues() {
    // Speed is the average of both motors
    state.speed = Math.round((state.leftMotor + state.rightMotor) / 2);
    
    // Steering is the difference (for differential drive)
    state.steering = Math.round((state.rightMotor - state.leftMotor) / 2);
    
    // Clamp values
    state.speed = Math.max(-255, Math.min(255, state.speed));
    state.steering = Math.max(-255, Math.min(255, state.steering));
}

// Button controls
function initButtons() {
    // Light toggle
    document.getElementById('lightBtn').addEventListener('click', () => {
        state.light = !state.light;
        updateButtonState('lightBtn', state.light);
        sendControl();
    });

    // Brake - stop both motors
    document.getElementById('brakeBtn').addEventListener('click', () => {
        sendBrake();
    });

    // Horn
    document.getElementById('hornBtn').addEventListener('mousedown', () => {
        state.horn = true;
        updateButtonState('hornBtn', true);
        sendControl();
    });
    
    document.getElementById('hornBtn').addEventListener('mouseup', () => {
        state.horn = false;
        updateButtonState('hornBtn', false);
        sendControl();
    });
    
    document.getElementById('hornBtn').addEventListener('touchstart', (e) => {
        e.preventDefault();
        state.horn = true;
        updateButtonState('hornBtn', true);
        sendControl();
    });
    
    document.getElementById('hornBtn').addEventListener('touchend', (e) => {
        e.preventDefault();
        state.horn = false;
        updateButtonState('hornBtn', false);
        sendControl();
    });

    // Hazard lights toggle
    document.getElementById('hazardBtn').addEventListener('click', () => {
        state.hazard = !state.hazard;
        if (state.hazard) {
            state.leftIndicator = false;
            state.rightIndicator = false;
            updateButtonState('leftIndBtn', false);
            updateButtonState('rightIndBtn', false);
        }
        updateButtonState('hazardBtn', state.hazard);
        sendControl();
    });

    // Left indicator toggle
    document.getElementById('leftIndBtn').addEventListener('click', () => {
        state.leftIndicator = !state.leftIndicator;
        if (state.leftIndicator) {
            state.rightIndicator = false;
            state.hazard = false;
            updateButtonState('rightIndBtn', false);
            updateButtonState('hazardBtn', false);
        } else {
            state.hazard = false;
            updateButtonState('hazardBtn', false);
        }
        updateButtonState('leftIndBtn', state.leftIndicator);
        sendControl();
    });

    // Right indicator toggle
    document.getElementById('rightIndBtn').addEventListener('click', () => {
        state.rightIndicator = !state.rightIndicator;
        if (state.rightIndicator) {
            state.leftIndicator = false;
            state.hazard = false;
            updateButtonState('leftIndBtn', false);
            updateButtonState('hazardBtn', false);
        } else {
            state.hazard = false;
            updateButtonState('hazardBtn', false);
        }
        updateButtonState('rightIndBtn', state.rightIndicator);
        sendControl();
    });
}

// Send brake command
function sendBrake() {
    state.leftMotor = 0;
    state.rightMotor = 0;
    updateDerivedValues();
    updateSpeedometers();
    sendControl();
}

// Update button visual state
function updateButtonState(buttonId, active) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    
    if (active) {
        btn.classList.add('active');
        if (buttonId === 'leftIndBtn' || buttonId === 'rightIndBtn') {
            btn.classList.add('blinking');
        }
    } else {
        btn.classList.remove('active');
        btn.classList.remove('blinking');
    }
}

// Send control data to ESP32
function sendControl() {
    const apiUrl = getApiBase() + '/api/control';
    fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(state)
    })
    .catch(error => console.error('Error sending control:', error));
}

// Start periodic status updates
function startStatusUpdate() {
    updateInterval = setInterval(() => {
        // Only poll status if joysticks are not active
        if (!joystickActive.left && !joystickActive.right) {
            const apiUrl = getApiBase() + '/api/status';
            fetch(apiUrl)
                .then(response => response.json())
                .then(data => {
                    // Sync UI state with ESP32 state
                    if (data.leftIndicator !== state.leftIndicator) {
                        state.leftIndicator = data.leftIndicator;
                        updateButtonState('leftIndBtn', state.leftIndicator);
                    }
                    if (data.rightIndicator !== state.rightIndicator) {
                        state.rightIndicator = data.rightIndicator;
                        updateButtonState('rightIndBtn', state.rightIndicator);
                    }
                    if (data.light !== state.light) {
                        state.light = data.light;
                        updateButtonState('lightBtn', state.light);
                    }
                    if (data.hazard !== state.hazard) {
                        state.hazard = data.hazard;
                        updateButtonState('hazardBtn', state.hazard);
                    }
                    
                    // Update speedometers with motor values from ESP32
                    if (data.leftMotor !== undefined) state.leftMotor = data.leftMotor;
                    if (data.rightMotor !== undefined) state.rightMotor = data.rightMotor;
                    updateSpeedometers();
                })
                .catch(error => console.error('Error fetching status:', error));
        }
    }, 500); // Poll every 500ms
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});

// Settings Management
function loadSettings() {
    const saved = localStorage.getItem('rcCarSettings');
    if (saved) {
        try {
            settings = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading settings:', e);
        }
    }
}

function saveSettings() {
    localStorage.setItem('rcCarSettings', JSON.stringify(settings));
}

function handleOrientationChange() {
    // Responsive layout is handled by CSS
    updateSpeedometers();
}

// Settings UI
function initSettings() {
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettings = document.getElementById('closeSettings');
    const modal = document.getElementById('settingsModal');
    const modalOverlay = modal.querySelector('.modal-overlay');
    const targetIpInput = document.getElementById('targetIp');
    const targetPortInput = document.getElementById('targetPort');
    const saveTargetBtn = document.getElementById('saveTargetBtn');
    
    // Load saved target settings
    targetIpInput.value = settings.targetIp || '';
    targetPortInput.value = settings.targetPort || '';
    
    // Save ESP32 target
    saveTargetBtn.addEventListener('click', () => {
        settings.targetIp = targetIpInput.value.trim();
        settings.targetPort = targetPortInput.value.trim();
        saveSettings();
        alert(`Target saved: ${settings.targetIp || 'same-origin'}${settings.targetPort ? ':' + settings.targetPort : ''}`);
    });
    
    // Open modal
    settingsBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
    });
    
    // Close modal
    const closeModal = () => {
        modal.classList.add('hidden');
    };
    
    closeSettings.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', closeModal);
}

// Fullscreen toggle
function initFullscreen() {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const body = document.body;
    
    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            // Enter fullscreen
            if (body.requestFullscreen) {
                body.requestFullscreen();
            } else if (body.webkitRequestFullscreen) { // Safari
                body.webkitRequestFullscreen();
            } else if (body.msRequestFullscreen) { // IE11
                body.msRequestFullscreen();
            }
        } else {
            // Exit fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) { // Safari
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) { // IE11
                document.msExitFullscreen();
            }
        }
    });
    
    // Update button icon based on fullscreen state
    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
    document.addEventListener('msfullscreenchange', updateFullscreenIcon);
}

function updateFullscreenIcon() {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const isFullscreen = !!document.fullscreenElement || !!document.webkitFullscreenElement || !!document.msFullscreenElement;
    
    if (isFullscreen) {
        // Exit fullscreen icon
        fullscreenBtn.innerHTML = `
            <svg class="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        `;
        fullscreenBtn.title = 'Exit Fullscreen';
    } else {
        // Enter fullscreen icon
        fullscreenBtn.innerHTML = `
            <svg class="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
            </svg>
        `;
        fullscreenBtn.title = 'Fullscreen';
    }
}

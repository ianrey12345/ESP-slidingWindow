// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCA7QhE7fMkdCpOnmANBGXKNDy3HXCtAo0",
    authDomain: "esp-slidingwindow.firebaseapp.com",
    databaseURL: "https://esp-slidingwindow-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "esp-slidingwindow",
    storageBucket: "esp-slidingwindow.firebasestorage.app",
    messagingSenderId: "745762327246",
    appId: "1:745762327246:web:5ef34612c7b060d57ade9f"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const auth = firebase.auth();

// Global variables
let isConnected = false;
let currentUser = null;
let realtimeListeners = {};
let inactivityTimer = null;
const INACTIVITY_TIMEOUT = 60 * 60 * 1000; // 1hr minutes of inactivity

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const connectionStatus = document.getElementById('connectionStatus');
const connectionText = document.getElementById('connectionText');
const realtimeIndicator = document.getElementById('realtimeIndicator');
const notification = document.getElementById('notification');

// Notification System
function showNotification(message, type = 'info', duration = 3000) {
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.add('show');

    setTimeout(() => {
        notification.classList.remove('show');
    }, duration);
}

// Inactivity Timer Management
function resetInactivityTimer() {
    // Clear existing timer
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    
    // Only set timer if user is logged in
    if (currentUser) {
        inactivityTimer = setTimeout(() => {
            showNotification('Session timed out due to inactivity', 'warning', 5000);
            // Auto logout after inactivity
            auth.signOut().then(() => {
                currentUser = null;
                removeRealtimeListeners();
                hideDashboard();
            });
        }, INACTIVITY_TIMEOUT);
    }
}

function stopInactivityTimer() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
    }
}

// Track user activity
function setupActivityTracking() {
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    activityEvents.forEach(event => {
        document.addEventListener(event, () => {
            if (currentUser) {
                resetInactivityTimer();
            }
        }, true);
    });
}

// Connection Status Management
function updateConnectionStatus(connected) {
    isConnected = connected;
    const indicator = document.getElementById('realtimeIndicator');
    const dashboardIndicator = document.getElementById('dashboardIndicator');
    
    if (connected) {
        connectionStatus.className = 'connection-status connected';
        connectionText.textContent = 'Connected';
        indicator.className = 'realtime-indicator active';
        if (dashboardIndicator) dashboardIndicator.className = 'realtime-indicator active';
    } else {
        connectionStatus.className = 'connection-status disconnected';
        connectionText.textContent = 'Disconnected';
        indicator.className = 'realtime-indicator inactive';
        if (dashboardIndicator) dashboardIndicator.className = 'realtime-indicator inactive';
        showNotification('Connection lost. Attempting to reconnect...', 'warning');
    }
}

// Firebase Connection Monitoring
const connectedRef = database.ref('.info/connected');
connectedRef.on('value', (snapshot) => {
    updateConnectionStatus(snapshot.val() === true);
});

// Initialize Firebase Database Structure
function initializeFirebaseDatabase() {
    if (!isConnected) {
        showNotification('No internet connection. Please check your network.', 'error');
        return;
    }

    const initialData = {
        windowPosition: 50,
        motorStatus: "idle",
        temperatureIndoor: 0.0,
        temperatureOutdoor: 0.0,
        windowCommand: "none",
        targetPosition: 50,
        lightLevel: 50,
        lightRawValue: 512,
        lightCondition: "moderate",
        dhtIndoorAvailable: false,
        dhtOutdoorAvailable: false,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
    };

    // Set initial data only if values don't exist
    Object.keys(initialData).forEach(key => {
        database.ref(`/${key}`).transaction(currentValue => {
            if (currentValue === null) {
                console.log(`Initializing ${key} with value:`, initialData[key]);
                return initialData[key];
            }
            return undefined; // Keep existing value
        });
    });

    showNotification('Firebase database initialized successfully!', 'success');
    console.log('Firebase database structure initialized!');
}

// Activity Log Management
let activityLog = [];

function addActivityLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
        time: timestamp,
        message: message,
        type: type
    };
    
    activityLog.unshift(logEntry);
    if (activityLog.length > 20) activityLog.pop();
    
    updateActivityLogDisplay();
}

function updateActivityLogDisplay() {
    const logContainer = document.getElementById('activityLog');
    if (!logContainer) return;
    
    if (activityLog.length === 0) {
        logContainer.innerHTML = '<div style="color: #999; text-align: center;">No recent activity</div>';
        return;
    }
    
    logContainer.innerHTML = activityLog.map(entry => {
        const colors = {
            info: '#667eea',
            success: '#48bb78',
            warning: '#ed8936',
            error: '#f56565'
        };
        return `
            <div style="padding: 8px; margin-bottom: 5px; border-left: 3px solid ${colors[entry.type]}; background: white; border-radius: 5px;">
                <span style="color: #999; font-size: 0.85rem;">${entry.time}</span>
                <span style="margin-left: 10px;">${entry.message}</span>
            </div>
        `;
    }).join('');
}

// Real-time Data Listeners
function setupRealtimeListeners() {
    if (!isConnected) return;

    // Window Position Listener
    realtimeListeners.position = database.ref('/windowPosition').on('value', (snapshot) => {
        const position = snapshot.val();
        if (position !== null) {
            updateWindowPosition(position);
        }
    }, (error) => {
        console.error('Position listener error:', error);
        showNotification('Failed to get position updates', 'error');
    });

    // Motor Status Listener
    realtimeListeners.motor = database.ref('/motorStatus').on('value', (snapshot) => {
        const status = snapshot.val();
        if (status) {
            updateMotorStatus(status);
            if (status === 'moving') {
                showNotification('Motor started moving', 'info', 2000);
            } else if (status === 'idle') {
                showNotification('Motor stopped', 'success', 2000);
            }
        }
    });

    // Temperature Thresholds Listeners
    realtimeListeners.tempClose = database.ref('/tempCloseThreshold').on('value', (snapshot) => {
        const value = snapshot.val();
        const input = document.getElementById('tempCloseThreshold');
        if (input && value) input.value = value;
    });

    realtimeListeners.tempOpen = database.ref('/tempOpenThreshold').on('value', (snapshot) => {
        const value = snapshot.val();
        const input = document.getElementById('tempOpenThreshold');
        if (input && value) input.value = value;
    });

    // Servo Angle Listener
    realtimeListeners.servo = database.ref('/servoAngle').on('value', (snapshot) => {
        const angle = snapshot.val();
        if (angle !== null) {
            updateServoAngle(angle);
        }
    });

    // Indoor Temperature Listener
    realtimeListeners.tempIndoor = database.ref('/temperatureIndoor').on('value', (snapshot) => {
        const temp = snapshot.val();
        if (temp !== null) {
            updateTemperatureIndoor(temp);
        }
    });

    // Outdoor Temperature Listener
    realtimeListeners.tempOutdoor = database.ref('/temperatureOutdoor').on('value', (snapshot) => {
        const temp = snapshot.val();
        if (temp !== null) {
            updateTemperatureOutdoor(temp);
        }
    });

    // Indoor Sensor Status Listener
    realtimeListeners.indoorAvail = database.ref('/dhtIndoorAvailable').on('value', (snapshot) => {
        const available = snapshot.val();
        updateSensorStatus('indoor', available);
    });

    // Outdoor Sensor Status Listener
    realtimeListeners.outdoorAvail = database.ref('/dhtOutdoorAvailable').on('value', (snapshot) => {
        const available = snapshot.val();
        updateSensorStatus('outdoor', available);
    });

    // Light Level Listener (0-100%)
    realtimeListeners.light = database.ref('/lightLevel').on('value', (snapshot) => {
        const lightLevel = snapshot.val();
        if (lightLevel !== null) {
            updateLightLevel(lightLevel);
        }
    });

    // Light Condition Listener
    realtimeListeners.lightCondition = database.ref('/lightCondition').on('value', (snapshot) => {
        const condition = snapshot.val();
        if (condition) {
            updateLightCondition(condition);
        }
    });

    // Auto Control Listeners
    realtimeListeners.autoTemp = database.ref('/autoTempControl').on('value', (snapshot) => {
        const enabled = snapshot.val();
        const toggle = document.getElementById('autoTempToggle');
        if (toggle) toggle.checked = enabled;
    });

    realtimeListeners.autoLight = database.ref('/autoLightControl').on('value', (snapshot) => {
        const enabled = snapshot.val();
        const toggle = document.getElementById('autoLightToggle');
        if (toggle) toggle.checked = enabled;
    });

    realtimeListeners.controlMode = database.ref('/controlMode').on('value', (snapshot) => {
        const mode = snapshot.val();
        const display = document.getElementById('controlModeDisplay');
        if (display && mode) {
            display.textContent = `Mode: ${mode.replace('_', ' ').toUpperCase()}`;
        }
    });

    console.log('Real-time listeners setup complete');
}

// Remove listeners when logging out
function removeRealtimeListeners() {
    const refPaths = {
        position: '/windowPosition',
        motor: '/motorStatus',
        tempIndoor: '/temperatureIndoor',
        tempOutdoor: '/temperatureOutdoor',
        indoorAvail: '/dhtIndoorAvailable',
        outdoorAvail: '/dhtOutdoorAvailable',
        light: '/lightLevel',
        lightCondition: '/lightCondition',
        tempClose: '/tempCloseThreshold',
        tempOpen: '/tempOpenThreshold',
        servo: '/servoAngle',
        autoTemp: '/autoTempControl',
        autoLight: '/autoLightControl',
        controlMode: '/controlMode'
    };

    Object.keys(realtimeListeners).forEach(key => {
        if (realtimeListeners[key]) {
            database.ref(refPaths[key]).off('value', realtimeListeners[key]);
        }
    });
    realtimeListeners = {};
}

// Update Functions
function updateWindowPosition(position) {
    const positionElement = document.getElementById('windowPosition');
    const slider = document.getElementById('positionSlider');
    const sliderValue = document.getElementById('sliderValue');
    
    if (positionElement) positionElement.textContent = position + '%';
    if (slider) slider.value = position;
    if (sliderValue) sliderValue.textContent = position + '%';
    
    updateSliderGradient(position);
}

function updateMotorStatus(status) {
    const statusElement = document.getElementById('motorStatus');
    if (statusElement) {
        statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
    
    // Update button states
    const isMoving = status === 'moving';
    const buttons = ['openBtn', 'closeBtn', 'applyBtn'];
    buttons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = isMoving;
            btn.style.opacity = isMoving ? '0.6' : '1';
        }
    });
}

function updateTemperatureIndoor(temp) {
    const tempElement = document.getElementById('temperatureIndoor');
    if (tempElement) {
        if (temp > 0) {
            tempElement.textContent = parseFloat(temp).toFixed(1) + '°C';
        } else {
            tempElement.textContent = '--°C';
        }
    }
}

function updateTemperatureOutdoor(temp) {
    const tempElement = document.getElementById('temperatureOutdoor');
    if (tempElement) {
        if (temp > 0) {
            tempElement.textContent = parseFloat(temp).toFixed(1) + '°C';
        } else {
            tempElement.textContent = '--°C';
        }
    }
}

function updateSensorStatus(type, available) {
    const statusElement = document.getElementById(type + 'SensorStatus');
    if (statusElement) {
        if (available) {
            statusElement.textContent = '✓ Connected';
            statusElement.style.color = '#48bb78';
        } else {
            statusElement.textContent = '✗ Not Available';
            statusElement.style.color = '#f56565';
        }
    }
}

function updateLightLevel(lightValue) {
    const lightElement = document.getElementById('lightLevel');
    if (lightElement) {
        lightElement.textContent = lightValue + '%';
    }
}

function updateLightCondition(condition) {
    const conditionElement = document.getElementById('lightCondition');
    if (conditionElement) {
        conditionElement.textContent = condition.charAt(0).toUpperCase() + condition.slice(1);
    }
}

function updateSliderGradient(value) {
    const slider = document.getElementById('positionSlider');
    if (slider) {
        const percentage = (value / 100) * 100;
        slider.style.background = `linear-gradient(to right, #667eea 0%, #667eea ${percentage}%, #e2e8f0 ${percentage}%, #e2e8f0 100%)`;
    }
}

function updateServoAngle(angle) {
    const servoElement = document.getElementById('servoAngleValue');
    const slider = document.getElementById('servoSlider');
    
    if (servoElement) servoElement.textContent = angle + '°';
    if (slider) slider.value = angle;
    
    updateServoSliderGradient(angle);
}

function updateServoSliderGradient(value) {
    const slider = document.getElementById('servoSlider');
    if (slider) {
        const percentage = (value / 720) * 100;
        slider.style.background = `linear-gradient(to right, #667eea 0%, #667eea ${percentage}%, #e2e8f0 ${percentage}%, #e2e8f0 100%)`;
    }
}

// Command Functions
function sendCommand(command) {
    if (!isConnected) {
        showNotification('No connection to Firebase', 'error');
        return;
    }

    database.ref('/windowCommand').set(command)
        .then(() => {
            showNotification(`Command sent: ${command.toUpperCase()}`, 'success');
            addActivityLog(`Window command: ${command.toUpperCase()}`, 'success');
        })
        .catch((error) => {
            showNotification('Failed to send command: ' + error.message, 'error');
            addActivityLog(`Failed: ${error.message}`, 'error');
        });
}

function sendManualCommand(position) {
    if (!isConnected) {
        showNotification('No connection to Firebase', 'error');
        return;
    }

    Promise.all([
        database.ref('/windowCommand').set('manual'),
        database.ref('/targetPosition').set(position)
    ]).then(() => {
        showNotification(`Moving to position: ${position}%`, 'success');
        addActivityLog(`Manual position set: ${position}%`, 'success');
    }).catch((error) => {
        showNotification('Failed to send position: ' + error.message, 'error');
        addActivityLog(`Failed: ${error.message}`, 'error');
    });
}

function sendServoCommand(angle) {
    if (!isConnected) {
        showNotification('No connection to Firebase', 'error');
        return;
    }

    database.ref('/targetServoAngle').set(angle)
        .then(() => {
            showNotification(`Servo moving to: ${angle}°`, 'success');
            addActivityLog(`Servo angle set: ${angle}°`, 'success');
        })
        .catch((error) => {
            showNotification('Failed to send servo command: ' + error.message, 'error');
            addActivityLog(`Servo failed: ${error.message}`, 'error');
        });
}

// Authentication
document.getElementById('loginBtn').addEventListener('click', () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
        showNotification('Please enter email and password', 'error');
        return;
    }

    if (!isConnected) {
        showNotification('No internet connection', 'error');
        return;
    }

    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            currentUser = userCredential.user;
            showNotification('Login successful!', 'success');
            showDashboard();
            initializeFirebaseDatabase();
            setupRealtimeListeners();
            resetInactivityTimer(); // Start inactivity timer
            addActivityLog('User logged in', 'info');
        })
        .catch((error) => {
            showNotification('Login failed: ' + error.message, 'error');
        });
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    auth.signOut().then(() => {
        currentUser = null;
        stopInactivityTimer(); // Stop the timer on logout
        removeRealtimeListeners();
        showNotification('Logged out successfully', 'info');
        hideDashboard();
        addActivityLog('User logged out', 'info');
    }).catch((error) => {
        showNotification('Logout failed: ' + error.message, 'error');
    });
});

function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    setupControlListeners();
}

function hideDashboard() {
    dashboard.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
}

// Control Functions
function setupControlListeners() {
    // Window Control Buttons
    document.getElementById('openBtn').addEventListener('click', () => {
        sendCommand('open');
    });

    document.getElementById('closeBtn').addEventListener('click', () => {
        sendCommand('close');
    });

    document.getElementById('applyBtn').addEventListener('click', () => {
        const targetPosition = parseInt(document.getElementById('positionSlider').value);
        sendManualCommand(targetPosition);
    });

    // Slider Updates
    document.getElementById('positionSlider').addEventListener('input', (e) => {
        const value = e.target.value;
        document.getElementById('sliderValue').textContent = value + '%';
        updateSliderGradient(value);
    });

    // Servo Control
    document.getElementById('applyServoBtn').addEventListener('click', () => {
        const targetAngle = parseInt(document.getElementById('servoSlider').value);
        sendServoCommand(targetAngle);
    });

    document.getElementById('servoSlider').addEventListener('input', (e) => {
        const value = e.target.value;
        document.getElementById('servoAngleValue').textContent = value + '°';
        updateServoSliderGradient(value);
    });

    // Temperature Thresholds
    document.getElementById('applyThresholdsBtn').addEventListener('click', () => {
        const closeThreshold = parseFloat(document.getElementById('tempCloseThreshold').value);
        const openThreshold = parseFloat(document.getElementById('tempOpenThreshold').value);
        
        if (closeThreshold <= openThreshold) {
            showNotification('Close threshold must be higher than open threshold', 'error');
            return;
        }
        
        Promise.all([
            database.ref('/tempCloseThreshold').set(closeThreshold),
            database.ref('/tempOpenThreshold').set(openThreshold)
        ]).then(() => {
            showNotification('Temperature thresholds updated', 'success');
            addActivityLog(`Thresholds: Close>${closeThreshold}°C, Open<${openThreshold}°C`, 'success');
        });
    });

    // Auto Control Toggles
    document.getElementById('autoTempToggle').addEventListener('change', (e) => {
        database.ref('/autoTempControl').set(e.target.checked);
        if (e.target.checked) {
            database.ref('/windowCommand').set('auto_temp');
            showNotification('Temperature control enabled', 'success');
            addActivityLog('Auto temperature control enabled', 'info');
        } else {
            showNotification('Temperature control disabled', 'info');
            addActivityLog('Auto temperature control disabled', 'info');
        }
    });

    document.getElementById('autoLightToggle').addEventListener('change', (e) => {
        database.ref('/autoLightControl').set(e.target.checked);
        if (e.target.checked) {
            database.ref('/windowCommand').set('auto_light');
            showNotification('Light control enabled', 'success');
            addActivityLog('Auto light control enabled', 'info');
        } else {
            showNotification('Light control disabled', 'info');
            addActivityLog('Auto light control disabled', 'info');
        }
    });
}

// Initialize on page load
window.addEventListener('load', () => {
    connectionStatus.className = 'connection-status connecting';
    connectionText.textContent = 'Connecting...';
    
    // Setup activity tracking for inactivity detection
    setupActivityTracking();
    
    // Check authentication state
    auth.onAuthStateChanged((user) => {
        if (user) {
            currentUser = user;
            showDashboard();
            initializeFirebaseDatabase();
            setupRealtimeListeners();
            resetInactivityTimer(); // Start timer for existing session
        } else {
            currentUser = null;
            stopInactivityTimer(); // Stop timer when logged out
            hideDashboard();
        }
    });
});
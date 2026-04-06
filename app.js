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
let onlineUsersCount = 0;
let isConnected = false;
let currentUser = null;
let realtimeListeners = {};
let inactivityTimer = null;
const INACTIVITY_TIMEOUT = 15 * 60 * 60 * 1000; // 1hr of inactivity

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
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);
    }
    
    if (currentUser) {
        inactivityTimer = setTimeout(() => {
            showNotification('Session timed out due to inactivity', 'warning', 5000);
            removeUserPresence();
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

function setupUserPresence() {
    if (!currentUser) return;
    
    // Reference to the user's presence in the database
    const userPresenceRef = database.ref(`/onlineUsers/${currentUser.uid}`);
    const connectedRef = database.ref('.info/connected');
    
    // Monitor connection status
    connectedRef.on('value', (snapshot) => {
        if (snapshot.val() === true) {
            // User is connected
            const userInfo = {
                email: currentUser.email,
                loginTime: firebase.database.ServerValue.TIMESTAMP,
                lastActive: firebase.database.ServerValue.TIMESTAMP
            };
            
            // Set user as online
            userPresenceRef.set(userInfo);
            
            // Remove user when they disconnect
            userPresenceRef.onDisconnect().remove();
            
            console.log('User presence set');
        }
    });
    
    // Update last active time every 30 seconds
    const activeInterval = setInterval(() => {
        if (currentUser) {
            userPresenceRef.update({
                lastActive: firebase.database.ServerValue.TIMESTAMP
            });
        } else {
            clearInterval(activeInterval);
        }
    }, 30000); // 30 seconds
}

function monitorOnlineUsers() {
    const onlineUsersRef = database.ref('/onlineUsers');
    
    onlineUsersRef.on('value', (snapshot) => {
        const users = snapshot.val();
        onlineUsersCount = users ? Object.keys(users).length : 0;
        
        console.log('Online users:', onlineUsersCount);
        updateOnlineUsersDisplay();
        
        // Log user details (optional - for debugging)
        if (users) {
            console.log('User details:', Object.values(users).map(u => u.email));
        }
    });
}

function updateOnlineUsersDisplay() {
    const userCountElement = document.getElementById('onlineUsersCount');
    if (userCountElement) {
        userCountElement.textContent = onlineUsersCount;
        
        // Change color based on count
        if (onlineUsersCount === 0) {
            userCountElement.style.color = '#999';
        } else if (onlineUsersCount === 1) {
            userCountElement.style.color = '#667eea';
        } else {
            userCountElement.style.color = '#48bb78';
        }
    }
}

function removeUserPresence() {
    if (currentUser) {
        const userPresenceRef = database.ref(`/onlineUsers/${currentUser.uid}`);
        userPresenceRef.remove()
            .then(() => {
                console.log('User presence removed');
            })
            .catch((error) => {
                console.error('Error removing presence:', error);
            });
    }
}

// Connection Status Management
function updateConnectionStatus(connected) {
    isConnected = connected;
    const indicator = document.getElementById('realtimeIndicator');
    const dashboardIndicator = document.getElementById('dashboardIndicator');
    
    console.log('Connection status changed:', connected); // Debug log
    
    if (connected) {
        connectionStatus.className = 'connection-status connected';
        connectionText.textContent = 'Connected';
        if (indicator) indicator.className = 'realtime-indicator active';
        if (dashboardIndicator) dashboardIndicator.className = 'realtime-indicator active';
        
        // Reload data when connection is restored
        if (currentUser) {
            console.log('Connection restored, reloading data...');
            loadInitialData();
        }
    } else {
        connectionStatus.className = 'connection-status disconnected';
        connectionText.textContent = 'Disconnected';
        if (indicator) indicator.className = 'realtime-indicator inactive';
        if (dashboardIndicator) dashboardIndicator.className = 'realtime-indicator inactive';
        showNotification('Connection lost. Attempting to reconnect...', 'warning');
    }
}

// Firebase Connection Monitoring
const connectedRef = database.ref('.info/connected');
connectedRef.on('value', (snapshot) => {
    updateConnectionStatus(snapshot.val() === true);
});

// Load Initial Data - reads each key individually to avoid max size exceeded error
function loadInitialData() {
    console.log('Loading initial data from Firebase (per-key reads)...');

    const keyHandlers = {
        windowPosition:      (v) => updateWindowPosition(v),
        motorStatus:         (v) => updateMotorStatus(v),
        temperatureIndoor:   (v) => updateTemperatureIndoor(v),
        temperatureOutdoor:  (v) => updateTemperatureOutdoor(v),
        lightLevel:          (v) => updateLightLevel(v),
        lightCondition:      (v) => updateLightCondition(v),
        dhtIndoorAvailable:  (v) => updateSensorStatus('indoor', v),
        dhtOutdoorAvailable: (v) => updateSensorStatus('outdoor', v),
        tiltPosition:        (v) => updateTiltPosition(v),
        tempCloseThreshold:  (v) => { const el = document.getElementById('tempCloseThreshold'); if (el) el.value = v; },
        tempOpenThreshold:   (v) => { const el = document.getElementById('tempOpenThreshold');  if (el) el.value = v; },
        autoTempControl:     (v) => { const el = document.getElementById('autoTempToggle');     if (el) el.checked = v; },
        autoLightControl:    (v) => { const el = document.getElementById('autoLightToggle');    if (el) el.checked = v; },
        controlMode:         (v) => { const el = document.getElementById('controlModeDisplay'); if (el) el.textContent = "Mode: " + v.replace("_"," ").toUpperCase(); }
    };

    const promises = Object.entries(keyHandlers).map(([key, handler]) =>
        database.ref("/" + key).once("value")
            .then(snapshot => {
                const val = snapshot.val();
                if (val !== null && val !== undefined) {
                    handler(val);
                    console.log("Loaded " + key + ":", val);
                }
            })
            .catch(err => console.warn("Could not load " + key + ":", err.message))
    );

    Promise.all(promises)
        .then(() => {
            console.log("All keys loaded successfully");
            showNotification("Data loaded successfully", "success", 2000);
        })
        .catch((error) => {
            console.error("Error during initial load:", error);
            showNotification("Some data failed to load: " + error.message, "warning");
        });
}

// Initialize Firebase Database Structure
function initializeFirebaseDatabase() {
    if (!isConnected) {
        console.log('Cannot initialize - not connected');
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
        tiltPosition: 50,
        targetTiltSteps: 750,  // 50% of 1500 steps
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
    };

    // Set initial data only if values don't exist
    const promises = Object.keys(initialData).map(key => {
        return database.ref(`/${key}`).once('value').then(snapshot => {
            if (snapshot.val() === null) {
                console.log(`Initializing ${key} with value:`, initialData[key]);
                return database.ref(`/${key}`).set(initialData[key]);
            }
        });
    });

    Promise.all(promises)
        .then(() => {
            console.log('Firebase database structure initialized!');
            showNotification('Firebase database initialized successfully!', 'success');
            // Load initial data after initialization
            loadInitialData();
        })
        .catch((error) => {
            console.error('Error initializing database:', error);
            showNotification('Failed to initialize database: ' + error.message, 'error');
        });
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

// Real-time Data Listeners - IMPROVED ERROR HANDLING
function setupRealtimeListeners() {
    if (!isConnected) {
        console.log('Cannot setup listeners - not connected');
        return;
    }

    console.log('Setting up real-time listeners...');

    // Window Position Listener
    realtimeListeners.position = database.ref('/windowPosition').on('value', (snapshot) => {
        const position = snapshot.val();
        console.log('Position update:', position);
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
        console.log('Motor status update:', status);
        if (status) {
            updateMotorStatus(status);
            if (status === 'moving') {
                showNotification('Motor started moving', 'info', 2000);
            } else if (status === 'idle') {
                showNotification('Motor stopped', 'success', 2000);
            }
        }
    }, (error) => {
        console.error('Motor status listener error:', error);
    });

    // Temperature Thresholds Listeners
    realtimeListeners.tempClose = database.ref('/tempCloseThreshold').on('value', (snapshot) => {
        const value = snapshot.val();
        console.log('Temp close threshold:', value);
        const input = document.getElementById('tempCloseThreshold');
        if (input && value !== null) input.value = value;
    });

    realtimeListeners.tempOpen = database.ref('/tempOpenThreshold').on('value', (snapshot) => {
        const value = snapshot.val();
        console.log('Temp open threshold:', value);
        const input = document.getElementById('tempOpenThreshold');
        if (input && value !== null) input.value = value;
    });

    // Tilt Position Listener
    realtimeListeners.tilt = database.ref('/tiltPosition').on('value', (snapshot) => {
    const percent = snapshot.val();
    console.log('Tilt position update:', percent);
    if (percent !== null) {
        updateTiltPosition(percent);
    }
    });


    // Indoor Temperature Listener
    realtimeListeners.tempIndoor = database.ref('/temperatureIndoor').on('value', (snapshot) => {
        const temp = snapshot.val();
        console.log('Indoor temp update:', temp);
        if (temp !== null) {
            updateTemperatureIndoor(temp);
        }
    });

    // Outdoor Temperature Listener
    realtimeListeners.tempOutdoor = database.ref('/temperatureOutdoor').on('value', (snapshot) => {
        const temp = snapshot.val();
        console.log('Outdoor temp update:', temp);
        if (temp !== null) {
            updateTemperatureOutdoor(temp);
        }
    });

    // Indoor Sensor Status Listener
    realtimeListeners.indoorAvail = database.ref('/dhtIndoorAvailable').on('value', (snapshot) => {
        const available = snapshot.val();
        console.log('Indoor sensor status:', available);
        if (available !== null) {
            updateSensorStatus('indoor', available);
        }
    });

    // Outdoor Sensor Status Listener
    realtimeListeners.outdoorAvail = database.ref('/dhtOutdoorAvailable').on('value', (snapshot) => {
        const available = snapshot.val();
        console.log('Outdoor sensor status:', available);
        if (available !== null) {
            updateSensorStatus('outdoor', available);
        }
    });

    // Light Level Listener
    realtimeListeners.light = database.ref('/lightLevel').on('value', (snapshot) => {
        const lightLevel = snapshot.val();
        console.log('Light level update:', lightLevel);
        if (lightLevel !== null) {
            updateLightLevel(lightLevel);
        }
    });

    // Light Condition Listener
    realtimeListeners.lightCondition = database.ref('/lightCondition').on('value', (snapshot) => {
        const condition = snapshot.val();
        console.log('Light condition update:', condition);
        if (condition) {
            updateLightCondition(condition);
        }
    });

    // Auto Control Listeners
    realtimeListeners.autoTemp = database.ref('/autoTempControl').on('value', (snapshot) => {
        const enabled = snapshot.val();
        console.log('Auto temp control:', enabled);
        const toggle = document.getElementById('autoTempToggle');
        if (toggle && enabled !== null) toggle.checked = enabled;
    });

    realtimeListeners.autoLight = database.ref('/autoLightControl').on('value', (snapshot) => {
        const enabled = snapshot.val();
        console.log('Auto light control:', enabled);
        const toggle = document.getElementById('autoLightToggle');
        if (toggle && enabled !== null) toggle.checked = enabled;
    });

    realtimeListeners.controlMode = database.ref('/controlMode').on('value', (snapshot) => {
        const mode = snapshot.val();
        console.log('Control mode:', mode);
        const display = document.getElementById('controlModeDisplay');
        if (display && mode) {
            display.textContent = `Mode: ${mode.replace('_', ' ').toUpperCase()}`;
        }
    });

    console.log('Real-time listeners setup complete');
    addActivityLog('Real-time listeners activated', 'success');
}

// Remove listeners when logging out
function removeRealtimeListeners() {
    console.log('Removing real-time listeners...');
    
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
        tilt: '/tiltPosition',
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
    console.log('Listeners removed');
}

// Update Functions - IMPROVED NULL CHECKS
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

function updateSensorStatus(type, available) {
    const statusElement = document.getElementById(type + 'SensorStatus');
    if (!statusElement) return;
    if (available) {
        statusElement.textContent = '✓ Connected';
        statusElement.style.color = '#48bb78';
    } else {
        statusElement.textContent = '✗ Not Available';
        statusElement.style.color = '#f56565';
    }
}

// NOTE: updateTemperatureIndoor, updateTemperatureOutdoor, updateLightLevel
// are defined in the Statistics Chart Module below, which also feeds the charts.

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

function updateTiltPosition(percent) {
    const tiltElement = document.getElementById('tiltPercentValue');
    const slider = document.getElementById('tiltSlider');
    
    if (tiltElement) tiltElement.textContent = percent + '%';
    if (slider) slider.value = percent;
    
    updateTiltSliderGradient(percent);
}

function updateTiltSliderGradient(value) {
    const slider = document.getElementById('tiltSlider');
    if (slider) {
        const percentage = (value / 100) * 100;
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
            console.error('Command error:', error);
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
        console.error('Manual command error:', error);
        showNotification('Failed to send position: ' + error.message, 'error');
        addActivityLog(`Failed: ${error.message}`, 'error');
    });
}

function sendTiltCommand(percent) {
    if (!isConnected) {
        showNotification('No connection to Firebase', 'error');
        return;
    }

    // Calculate steps based on percentage (1500 steps = 100%)
    const targetSteps = Math.round((percent / 100) * 2600);

    Promise.all([
        database.ref('/tiltPosition').set(percent),
        database.ref('/targetTiltSteps').set(targetSteps)
    ]).then(() => {
        showNotification(`Tilting to: ${percent}% (${targetSteps} steps)`, 'success');
        addActivityLog(`Tilt position set: ${percent}% (${targetSteps} steps)`, 'success');
    }).catch((error) => {
        console.error('Tilt command error:', error);
        showNotification('Failed to send tilt command: ' + error.message, 'error');
        addActivityLog(`Tilt failed: ${error.message}`, 'error');
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
            console.log('User logged in:', currentUser.email);
            showNotification('Login successful!', 'success');
            showDashboard();
            
            setupUserPresence();
            monitorOnlineUsers();
            
            // Wait a moment for connection to stabilize, then load data
            setTimeout(() => {
                initializeFirebaseDatabase();
                setupRealtimeListeners();
            }, 500);
            
            resetInactivityTimer();
            addActivityLog('User logged in', 'info');
        })
        .catch((error) => {
            console.error('Login error:', error);
            showNotification('Login failed: ' + error.message, 'error');
        });
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    removeUserPresence();
    auth.signOut().then(() => {
        currentUser = null;
        stopInactivityTimer();
        removeRealtimeListeners();
        showNotification('Logged out successfully', 'info');
        hideDashboard();
        addActivityLog('User logged out', 'info');
    }).catch((error) => {
        console.error('Logout error:', error);
        showNotification('Logout failed: ' + error.message, 'error');
    });
});

function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    setupControlListeners();
    // Small delay so canvas elements are fully visible before Chart.js measures them
    setTimeout(() => initCharts(), 100);
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

    // Tilt Control
    document.getElementById('applyTiltBtn').addEventListener('click', () => {
    const targetPercent = parseInt(document.getElementById('tiltSlider').value);
    sendTiltCommand(targetPercent);
    });

    document.getElementById('tiltSlider').addEventListener('input', (e) => {
    const value = e.target.value;
    document.getElementById('tiltPercentValue').textContent = value + '%';
    updateTiltSliderGradient(value);
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

// =====================================================================
// STATISTICS CHART MODULE  — with Firebase daily history log
// =====================================================================

// ---------- In-memory live buffer ----------
const chartHistory = { labels: [], indoorTemp: [], outdoorTemp: [], lightLevel: [] };
let tempChartInstance = null;
let lightChartInstance = null;
let viewingHistorical = false;   // true when showing a past day

// ---------- Firebase history save (every 30 s) ----------
let lastFirebaseSave = 0;
let latestSensorState = { indoor: null, outdoor: null, light: null };
let lastChartPush = 0;

const SAVE_INTERVAL_MS  = 30000;   // save to Firebase every 30 s
const CHART_PUSH_MS     = 5000;    // update live chart every 5 s
const HISTORY_MAX_DAYS  = 7;       // keep 7 days of history

function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth()+1).padStart(2,'0') + '-' +
           String(d.getDate()).padStart(2,'0');
}

function saveReadingToFirebase() {
    if (!isConnected || !currentUser) return;
    if (latestSensorState.indoor === null) return;

    const now   = Date.now();
    const key   = todayKey();
    const entry = {
        ts:      now,
        indoor:  latestSensorState.indoor,
        outdoor: latestSensorState.outdoor,
        light:   latestSensorState.light
    };

    database.ref('/sensorHistory/' + key + '/' + now).set(entry)
        .catch(err => console.warn('History save failed:', err.message));
}

function pruneOldHistory() {
    if (!isConnected || !currentUser) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_MAX_DAYS);

    database.ref('/sensorHistory').once('value').then(snap => {
        if (!snap.val()) return;
        const removes = [];
        snap.forEach(daySnap => {
            const parts = daySnap.key.split('-').map(Number);
            const dayDate = new Date(parts[0], parts[1]-1, parts[2]);
            if (dayDate < cutoff) {
                removes.push(database.ref('/sensorHistory/' + daySnap.key).remove());
            }
        });
        if (removes.length) Promise.all(removes).then(() =>
            console.log('Pruned', removes.length, 'old history day(s)'));
    }).catch(err => console.warn('Prune check failed:', err.message));
}

// Called every time a sensor value changes
function onSensorUpdate(type, value) {
    if (!isNaN(value) && value !== null) latestSensorState[type] = value;
    const now = Date.now();

    // Live chart push (every 5 s)
    if (!viewingHistorical && now - lastChartPush >= CHART_PUSH_MS) {
        lastChartPush = now;
        pushChartPoint(
            latestSensorState.indoor,
            latestSensorState.outdoor,
            latestSensorState.light,
            new Date()
        );
    }

    // Firebase save (every 30 s)
    if (now - lastFirebaseSave >= SAVE_INTERVAL_MS) {
        lastFirebaseSave = now;
        saveReadingToFirebase();
    }
}

// ---------- Available days list ----------
function loadAvailableDays(callback) {
    database.ref('/sensorHistory').once('value').then(snap => {
        const days = [];
        if (snap.val()) snap.forEach(d => days.push(d.key));
        days.sort((a,b) => b.localeCompare(a)); // newest first
        callback(days);
    }).catch(() => callback([]));
}

// ---------- Load a specific day from Firebase ----------
function loadDayHistory(dateKey) {
    const loadingEl = document.getElementById('historyLoading');
    if (loadingEl) { loadingEl.style.display = 'block'; loadingEl.textContent = 'Loading ' + dateKey + '...'; }

    database.ref('/sensorHistory/' + dateKey)
        .orderByKey()
        .once('value')
        .then(snap => {
            if (loadingEl) loadingEl.style.display = 'none';
            if (!snap.val()) {
                showNotification('No data found for ' + dateKey, 'warning');
                return;
            }

            const labels = [], indoor = [], outdoor = [], light = [];
            snap.forEach(entry => {
                const e = entry.val();
                const t = new Date(e.ts);
                labels.push(t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                indoor.push(e.indoor !== null && !isNaN(e.indoor) ? parseFloat(e.indoor.toFixed(1)) : null);
                outdoor.push(e.outdoor !== null && !isNaN(e.outdoor) ? parseFloat(e.outdoor.toFixed(1)) : null);
                light.push(e.light !== null && !isNaN(e.light) ? parseFloat(e.light) : null);
            });

            viewingHistorical = true;
            renderChartsWithData(labels, indoor, outdoor, light);

            // Update summary with historical data
            updateStatsSummary(indoor, outdoor, light, labels.length);

            // Show banner
            const banner = document.getElementById('historyBanner');
            if (banner) {
                banner.style.display = 'block';
                banner.textContent = '📅 Viewing history: ' + dateKey + '  (' + labels.length + ' readings)';
            }
        })
        .catch(err => {
            if (loadingEl) loadingEl.style.display = 'none';
            showNotification('Failed to load history: ' + err.message, 'error');
        });
}

function switchToLive() {
    viewingHistorical = false;
    const banner = document.getElementById('historyBanner');
    if (banner) banner.style.display = 'none';
    renderChartsWithData(
        chartHistory.labels.slice(-getMaxPoints()),
        chartHistory.indoorTemp.slice(-getMaxPoints()),
        chartHistory.outdoorTemp.slice(-getMaxPoints()),
        chartHistory.lightLevel.slice(-getMaxPoints())
    );
    updateStatsSummary(chartHistory.indoorTemp, chartHistory.outdoorTemp, chartHistory.lightLevel, chartHistory.labels.length);
}

// ---------- Day picker UI ----------
function renderDayPicker(days) {
    const container = document.getElementById('dayPickerContainer');
    if (!container) return;
    if (!days.length) {
        container.innerHTML = '<span style="color:#aaa;font-size:0.8rem;">No history yet — data saves every 30 s</span>';
        return;
    }

    container.innerHTML = days.map(day => {
        const d = new Date(day + 'T00:00:00');
        const today = new Date(); today.setHours(0,0,0,0);
        const diff  = Math.round((today - d) / 86400000);
        const label = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : day;
        return '<button class="day-pill" data-day="' + day + '" style="' +
            'padding:5px 11px;margin:3px;border:none;border-radius:20px;cursor:pointer;font-size:0.78rem;font-weight:600;' +
            'background:rgba(102,126,234,0.12);color:#667eea;transition:all 0.2s;">' +
            label + '</button>';
    }).join('');

    container.querySelectorAll('.day-pill').forEach(btn => {
        btn.addEventListener('mouseover', () => btn.style.background = '#667eea', false);
        btn.addEventListener('mouseout',  () => {
            btn.style.background = btn.classList.contains('active-day')
                ? '#667eea' : 'rgba(102,126,234,0.12)';
        }, false);
        btn.addEventListener('click', () => {
            container.querySelectorAll('.day-pill').forEach(b => {
                b.classList.remove('active-day');
                b.style.background = 'rgba(102,126,234,0.12)';
                b.style.color = '#667eea';
            });
            btn.classList.add('active-day');
            btn.style.background = '#667eea';
            btn.style.color = 'white';
            loadDayHistory(btn.dataset.day);
        }, false);
    });
}

// ---------- Chart helpers ----------
function getMaxPoints() {
    const sel = document.getElementById('chartTimeWindow');
    return sel ? parseInt(sel.value) : 30;
}

function pushChartPoint(indoorTemp, outdoorTemp, lightLevel, dateObj) {
    if (viewingHistorical) return;
    const label = (dateObj || new Date()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    chartHistory.labels.push(label);
    chartHistory.indoorTemp.push(!isNaN(indoorTemp) && indoorTemp !== null ? parseFloat(indoorTemp.toFixed(1)) : null);
    chartHistory.outdoorTemp.push(!isNaN(outdoorTemp) && outdoorTemp !== null ? parseFloat(outdoorTemp.toFixed(1)) : null);
    chartHistory.lightLevel.push(!isNaN(lightLevel) && lightLevel !== null ? parseFloat(lightLevel) : null);

    const BUFFER = 500;
    if (chartHistory.labels.length > BUFFER) {
        chartHistory.labels.shift(); chartHistory.indoorTemp.shift();
        chartHistory.outdoorTemp.shift(); chartHistory.lightLevel.shift();
    }
    refreshChartView();
    updateStatsSummary(chartHistory.indoorTemp, chartHistory.outdoorTemp, chartHistory.lightLevel, chartHistory.labels.length);
}

function renderChartsWithData(labels, indoor, outdoor, light) {
    if (!tempChartInstance || !lightChartInstance) return;
    tempChartInstance.data.labels = labels;
    tempChartInstance.data.datasets[0].data = indoor;
    tempChartInstance.data.datasets[1].data = outdoor;
    tempChartInstance.update('none');
    lightChartInstance.data.labels = labels;
    lightChartInstance.data.datasets[0].data = light;
    lightChartInstance.update('none');
}

function refreshChartView() {
    if (viewingHistorical || !tempChartInstance) return;
    const max = getMaxPoints();
    renderChartsWithData(
        chartHistory.labels.slice(-max),
        chartHistory.indoorTemp.slice(-max),
        chartHistory.outdoorTemp.slice(-max),
        chartHistory.lightLevel.slice(-max)
    );
}

function updateStatsSummary(indoor, outdoor, light, count) {
    const validNums = arr => (arr||[]).filter(v => v !== null && !isNaN(v));
    const setMinMax = (id, arr, unit) => {
        const el = document.getElementById(id); if (!el) return;
        const nums = validNums(arr);
        if (!nums.length) { el.textContent = '-- / --' + unit; return; }
        el.textContent = Math.min(...nums).toFixed(1) + ' / ' + Math.max(...nums).toFixed(1) + unit;
    };
    setMinMax('statIndoorMinMax',  indoor,  '°C');
    setMinMax('statOutdoorMinMax', outdoor, '°C');
    setMinMax('statLightMinMax',   light,   '%');
    const el = document.getElementById('statReadingsCount');
    if (el) el.textContent = (count || 0);
}

// ---------- Chart initialisation ----------
function initCharts() {
    const tempCtx  = document.getElementById('tempChart');
    const lightCtx = document.getElementById('lightChart');
    if (!tempCtx || !lightCtx) return;

    // ---- Toggle / Close panel ----
    const panel     = document.getElementById('statsFloatingPanel');
    const toggleBtn = document.getElementById('statsToggleBtn');
    const closeBtn  = document.getElementById('statsCloseBtn');
    const arrow     = document.getElementById('statsToggleArrow');

    function openPanel() {
        panel.style.display = 'block';
        requestAnimationFrame(() => { panel.style.opacity = '1'; panel.style.transform = 'translateY(0)'; });
        arrow.style.transform = 'rotate(180deg)';
        setTimeout(() => {
            if (tempChartInstance) tempChartInstance.resize();
            if (lightChartInstance) lightChartInstance.resize();
        }, 50);
        // Refresh day picker each time panel opens
        if (isConnected) loadAvailableDays(renderDayPicker);
        // Run initial prune
        pruneOldHistory();
    }

    function closePanel() {
        panel.style.opacity = '0'; panel.style.transform = 'translateY(-8px)';
        arrow.style.transform = 'rotate(0deg)';
        setTimeout(() => { panel.style.display = 'none'; }, 250);
    }

    let panelOpen = false;
    toggleBtn.addEventListener('click', () => { panelOpen = !panelOpen; panelOpen ? openPanel() : closePanel(); });
    closeBtn.addEventListener('click', () => { panelOpen = false; closePanel(); });

    // Live button
    const liveBtn = document.getElementById('goLiveBtn');
    if (liveBtn) liveBtn.addEventListener('click', () => {
        document.querySelectorAll('.day-pill').forEach(b => {
            b.classList.remove('active-day');
            b.style.background = 'rgba(102,126,234,0.12)';
            b.style.color = '#667eea';
        });
        switchToLive();
    });

    // Time window selector
    const sel = document.getElementById('chartTimeWindow');
    if (sel) sel.addEventListener('change', refreshChartView);

    // Clear live buffer
    const clearBtn = document.getElementById('clearChartBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
        if (viewingHistorical) { switchToLive(); return; }
        chartHistory.labels = []; chartHistory.indoorTemp = [];
        chartHistory.outdoorTemp = []; chartHistory.lightLevel = [];
        refreshChartView();
        updateStatsSummary([], [], [], 0);
    });

    // ---- Drag to reposition ----
    const header = document.getElementById('statsPanelHeader');
    let dragging = false, startX, startY, origLeft, origTop;
    header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
        dragging = true; startX = e.clientX; startY = e.clientY;
        const rect = panel.getBoundingClientRect(); origLeft = rect.left; origTop = rect.top;
        panel.style.transition = 'none'; document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        panel.style.left = Math.max(0, origLeft + e.clientX - startX) + 'px';
        panel.style.top  = Math.max(0, origTop  + e.clientY - startY) + 'px';
    });
    document.addEventListener('mouseup', () => {
        dragging = false; panel.style.transition = 'opacity 0.25s, transform 0.25s';
        document.body.style.userSelect = '';
    });
    header.addEventListener('touchstart', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
        const t = e.touches[0]; dragging = true; startX = t.clientX; startY = t.clientY;
        const rect = panel.getBoundingClientRect(); origLeft = rect.left; origTop = rect.top;
        panel.style.transition = 'none';
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        const t = e.touches[0];
        panel.style.left = Math.max(0, origLeft + t.clientX - startX) + 'px';
        panel.style.top  = Math.max(0, origTop  + t.clientY - startY) + 'px';
    }, { passive: true });
    document.addEventListener('touchend', () => {
        dragging = false; panel.style.transition = 'opacity 0.25s, transform 0.25s';
    });

    // ---- Build charts ----
    const commonOptions = {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: {
            legend: { display: false },
            tooltip: { mode: 'index', intersect: false,
                backgroundColor: 'rgba(0,0,0,0.75)',
                titleFont: { size: 11 }, bodyFont: { size: 11 } }
        },
        scales: {
            x: { ticks: { maxTicksLimit: 8, font: { size: 10 }, color: '#555' }, grid: { color: 'rgba(0,0,0,0.05)' } },
            y: { ticks: { font: { size: 10 }, color: '#555' }, grid: { color: 'rgba(0,0,0,0.07)' } }
        },
        elements: { point: { radius: 2, hoverRadius: 5 }, line: { tension: 0.35, borderWidth: 2 } }
    };

    tempChartInstance = new Chart(tempCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Indoor (°C)',  data: [], borderColor: '#667eea', backgroundColor: 'rgba(102,126,234,0.12)', fill: true },
                { label: 'Outdoor (°C)', data: [], borderColor: '#f6ad55', backgroundColor: 'rgba(246,173,85,0.10)',  fill: true }
            ]
        },
        options: { ...commonOptions, scales: { ...commonOptions.scales,
            y: { ...commonOptions.scales.y, title: { display: true, text: '°C', font: { size: 10 } } } } }
    });

    lightChartInstance = new Chart(lightCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{ label: 'Light Level (%)', data: [], borderColor: '#ecc94b', backgroundColor: 'rgba(236,201,75,0.15)', fill: true }]
        },
        options: { ...commonOptions, scales: { ...commonOptions.scales,
            y: { ...commonOptions.scales.y, min: 0, max: 100, title: { display: true, text: '%', font: { size: 10 } } } } }
    });
}

// Override update functions — feed display + charts + Firebase
function updateTemperatureIndoor(temp) {
    const el = document.getElementById('temperatureIndoor');
    if (!el) return;
    const parsed = parseFloat(temp);
    el.textContent = (!isNaN(parsed) && temp !== null && temp !== undefined) ? parsed.toFixed(1) + '°C' : '--°C';
    onSensorUpdate('indoor', parsed);
}

function updateTemperatureOutdoor(temp) {
    const el = document.getElementById('temperatureOutdoor');
    if (!el) return;
    const parsed = parseFloat(temp);
    el.textContent = (!isNaN(parsed) && temp !== null && temp !== undefined) ? parsed.toFixed(1) + '°C' : '--°C';
    onSensorUpdate('outdoor', parsed);
}

function updateLightLevel(lightValue) {
    const el = document.getElementById('lightLevel');
    if (!el) return;
    const parsed = parseFloat(lightValue);
    el.textContent = (!isNaN(parsed) && lightValue !== null && lightValue !== undefined) ? parsed.toFixed(0) + '%' : '--';
    onSensorUpdate('light', parsed);
}

// =====================================================================
// END STATISTICS CHART MODULE
// =====================================================================

// Initialize on page load
window.addEventListener('load', () => {
    console.log('Application loading...');
    connectionStatus.className = 'connection-status connecting';
    connectionText.textContent = 'Connecting...';
    
    // Setup activity tracking for inactivity detection
    setupActivityTracking();
    
    // Check authentication state
    auth.onAuthStateChanged((user) => {
        if (user) {
            console.log('User authenticated:', user.email);
            currentUser = user;
            showDashboard();

            setupUserPresence();
            monitorOnlineUsers();
            
            // Wait for connection before loading data
            setTimeout(() => {
                if (isConnected) {
                    initializeFirebaseDatabase();
                    setupRealtimeListeners();
                } else {
                    console.log('Waiting for connection...');
                    // Wait for connection callback to trigger data loading
                }
            }, 1000);
            
            resetInactivityTimer();
        } else {
            console.log('No authenticated user');
            currentUser = null;
            stopInactivityTimer();
            hideDashboard();
        }
    });
});

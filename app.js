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

// Load Initial Data - NEW FUNCTION
function loadInitialData() {
    console.log('Loading initial data from Firebase...');
    
    // Fetch all current values at once
    database.ref('/').once('value')
        .then((snapshot) => {
            const data = snapshot.val();
            console.log('Firebase data received:', data);
            
            if (data) {
                // Update all UI elements with current values
                if (data.windowPosition !== undefined) updateWindowPosition(data.windowPosition);
                if (data.motorStatus) updateMotorStatus(data.motorStatus);
                if (data.temperatureIndoor !== undefined) updateTemperatureIndoor(data.temperatureIndoor);
                if (data.temperatureOutdoor !== undefined) updateTemperatureOutdoor(data.temperatureOutdoor);
                if (data.lightLevel !== undefined) updateLightLevel(data.lightLevel);
                if (data.lightCondition) updateLightCondition(data.lightCondition);
                if (data.dhtIndoorAvailable !== undefined) updateSensorStatus('indoor', data.dhtIndoorAvailable);
                if (data.dhtOutdoorAvailable !== undefined) updateSensorStatus('outdoor', data.dhtOutdoorAvailable);
                if (data.tiltPosition !== undefined) updateTiltPosition(data.tiltPosition);
                if (data.tempCloseThreshold !== undefined) {
                    const input = document.getElementById('tempCloseThreshold');
                    if (input) input.value = data.tempCloseThreshold;
                }
                if (data.tempOpenThreshold !== undefined) {
                    const input = document.getElementById('tempOpenThreshold');
                    if (input) input.value = data.tempOpenThreshold;
                }
                if (data.autoTempControl !== undefined) {
                    const toggle = document.getElementById('autoTempToggle');
                    if (toggle) toggle.checked = data.autoTempControl;
                }
                if (data.autoLightControl !== undefined) {
                    const toggle = document.getElementById('autoLightToggle');
                    if (toggle) toggle.checked = data.autoLightControl;
                }
                if (data.controlMode) {
                    const display = document.getElementById('controlModeDisplay');
                    if (display) display.textContent = `Mode: ${data.controlMode.replace('_', ' ').toUpperCase()}`;
                }
                
                console.log('Initial data loaded successfully');
                showNotification('Data loaded successfully', 'success', 2000);
            } else {
                console.warn('No data found in Firebase');
                showNotification('No data found in database', 'warning');
            }
        })
        .catch((error) => {
            console.error('Error loading initial data:', error);
            showNotification('Failed to load data: ' + error.message, 'error');
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
    const targetSteps = Math.round((percent / 100) * 30000);

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


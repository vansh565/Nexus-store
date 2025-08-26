// WebSocket Connection with Reconnection Logic
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 5000;
let cartItems = [];
let sessionToken = null;
let user = { name: 'Guest', email: null };
let hasShownLoginPrompt = false;
const cartCount = document.querySelector('.cart-count');

// Cookie Handling
function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    return parts.length === 2 ? decodeURIComponent(parts.pop().split(';').shift()) : null;
}

// Check if user is logged in
function isLoggedIn() {
    return !!sessionToken;
}

// Connect to WebSocket
function connectWebSocket() {
    ws = new WebSocket('ws://localhost:8080');
    console.log('Attempting WebSocket connection...');

    ws.onopen = () => {
        console.log('Connected to WebSocket server');
        reconnectAttempts = 0;
        // Validate session if token exists
        sessionToken = getCookie('sessionToken');
        if (sessionToken) {
            ws.send(JSON.stringify({ type: 'validateSession', payload: { sessionToken } }));
        } else {
            updateUIForGuest();
            if (!hasShownLoginPrompt) {
                showNotification('Please log in to access cart features', 'warning');
                hasShownLoginPrompt = true;
            }
        }
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message:', data);
        const { status, message, user: userData, type, sessionToken: newToken, cart } = data;
        showNotification(message, status);

        if (status === 'success') {
            if (type === 'login' || type === 'signup') {
                sessionToken = newToken;
                setCookie('sessionToken', sessionToken, 4); // Store for 1 day
                user = userData || { name: 'Guest', email: null };
                cartItems = cart || [];
                updateUIForUser();
                closeModal(type === 'login' ? loginModal : signupModal);
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 1000);
            } else if (type === 'validateSession') {
                user = userData || { name: 'Guest', email: null };
                cartItems = cart || [];
                updateUIForUser();
            } else if (type === 'logout') {
                sessionToken = null;
                setCookie('sessionToken', '', -1); // Clear cookie
                user = { name: 'Guest', email: null };
                cartItems = [];
                updateUIForGuest();
            } else if (type === 'cartUpdate') {
                cartItems = cart || [];
                updateCartCount();
            }
        } else if (status === 'error' && message.includes('session')) {
            sessionToken = null;
            setCookie('sessionToken', '', -1);
            user = { name: 'Guest', email: null };
            cartItems = [];
            updateUIForGuest();
            openModal(loginModal);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showNotification('Connection error. Please try again.', 'error');
    };

    ws.onclose = () => {
        console.log('Disconnected from WebSocket server');
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`Reconnecting in ${reconnectDelay / 1000}s... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
            setTimeout(connectWebSocket, reconnectDelay);
        } else {
            showNotification('Unable to connect to server after multiple attempts', 'error');
            hasShownLoginPrompt = false;
        }
    };
}

// Update cart count
function updateCartCount() {
    if (cartCount) {
        cartCount.textContent = cartItems.reduce((total, item) => total + item.quantity, 0) || 0;
        cartCount.style.animation = 'bounce 0.5s ease';
        setTimeout(() => {
            cartCount.style.animation = '';
        }, 500);
    }
}

// Update UI for logged-in user
function updateUIForUser() {
    const profileName = document.getElementById('profile-name');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    if (profileName && loginBtn && logoutBtn) {
        profileName.textContent = user.name || user.email.split('@')[0];
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        updateCartCount();
    }
}

// Update UI for guest
function updateUIForGuest() {
    const profileName = document.getElementById('profile-name');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    if (profileName && loginBtn && logoutBtn) {
        profileName.textContent = 'Guest';
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        if (cartCount) {
            cartCount.textContent = '0';
        }
    }
}

// Initial WebSocket connection
connectWebSocket();

// DOM Elements
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const ctaBtn = document.getElementById('ctaBtn');
const loginModal = document.getElementById('loginModal');
const signupModal = document.getElementById('signupModal');
const closeLogin = document.getElementById('closeLogin');
const closeSignup = document.getElementById('closeSignup');
const switchToSignup = document.getElementById('switchToSignup');
const switchToLogin = document.getElementById('switchToLogin');
const loginForm = loginModal?.querySelector('.modal-form');
const signupForm = signupModal?.querySelector('.modal-form');
const logoutBtn = document.getElementById('logoutBtn');

// Modal Functions
function openModal(modal) {
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        const modalContent = modal.querySelector('.modal');
        if (modalContent) {
            modalContent.style.animation = 'modalEnter 0.4s ease-out forwards';
        }
    }
}

function closeModal(modal) {
    if (modal) {
        const modalContent = modal.querySelector('.modal');
        if (modalContent) {
            modalContent.style.animation = 'modalExit 0.3s ease-in forwards';
        }
        setTimeout(() => {
            modal.classList.remove('active');
            document.body.style.overflow = 'auto';
            if (modalContent) {
                modalContent.style.animation = '';
            }
        }, 300);
    }
}

function switchModals(fromModal, toModal) {
    closeModal(fromModal);
    setTimeout(() => {
        openModal(toModal);
    }, 400);
}

// Event Listeners
if (loginBtn) {
    loginBtn.addEventListener('click', () => openModal(loginModal));
}
if (signupBtn) {
    signupBtn.addEventListener('click', () => openModal(signupModal));
}
if (ctaBtn) {
    ctaBtn.addEventListener('click', () => {
        if (isLoggedIn()) {
            ctaBtn.style.transform = 'scale(0.95)';
            setTimeout(() => {
                ctaBtn.style.transform = 'scale(1)';
                window.location.href = 'dashboard.html';
            }, 150);
        } else {
            openModal(signupModal);
        }
    });
}
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'logout', payload: { sessionToken } }));
        } else {
            showNotification('Cannot logout: Server not connected', 'error');
        }
    });
}
if (closeLogin) {
    closeLogin.addEventListener('click', () => closeModal(loginModal));
}
if (closeSignup) {
    closeSignup.addEventListener('click', () => closeModal(signupModal));
}
if (switchToSignup) {
    switchToSignup.addEventListener('click', (e) => {
        e.preventDefault();
        switchModals(loginModal, signupModal);
    });
}
if (switchToLogin) {
    switchToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        switchModals(signupModal, loginModal);
    });
}
if (loginModal) {
    loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) {
            closeModal(loginModal);
        }
    });
}
if (signupModal) {
    signupModal.addEventListener('click', (e) => {
        if (e.target === signupModal) {
            closeModal(signupModal);
        }
    });
}
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (loginModal?.classList.contains('active')) {
            closeModal(loginModal);
        }
        if (signupModal?.classList.contains('active')) {
            closeModal(signupModal);
        }
    }
});

// Form Handling
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showNotification('Cannot sign in: Server not connected', 'error');
            return;
        }
        const submitBtn = loginForm.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Signing In...';
        submitBtn.disabled = true;

        const email = document.getElementById('loginEmail')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;

        ws.send(JSON.stringify({
            type: 'login',
            payload: { email, password }
        }));

        setTimeout(() => {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }, 2000);
    });
}

if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showNotification('Cannot create account: Server not connected', 'error');
            return;
        }
        const password = document.getElementById('signupPassword')?.value;
        const confirmPassword = document.getElementById('confirmPassword')?.value;

        if (password !== confirmPassword) {
            showNotification('Passwords do not match!', 'error');
            return;
        }

        const submitBtn = signupForm.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Creating Account...';
        submitBtn.disabled = true;

        const name = document.getElementById('signupName')?.value.trim();
        const email = document.getElementById('signupEmail')?.value.trim();

        ws.send(JSON.stringify({
            type: 'signup',
            payload: { name, email, password }
        }));

        setTimeout(() => {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }, 2000);
    });
}

// Search Functionality
const searchInput = document.querySelector('.search-input');
const searchBtn = document.querySelector('.search-btn');
if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
}

function performSearch() {
    const query = searchInput.value.trim();
    if (query) {
        searchBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            searchBtn.style.transform = 'scale(1)';
            showNotification(`Searching for "${query}"...`, 'info');
            setTimeout(() => {
                window.location.href = `electronics.html?search=${encodeURIComponent(query)}`;
            }, 1000);
        }, 150);
    }
}

// Cart Button Navigation
const cartBtn = document.querySelector('.cart-btn');
if (cartBtn) {
    cartBtn.addEventListener('click', () => {
        if (!isLoggedIn()) {
            showNotification('Please log in to view your cart', 'warning');
            openModal(loginModal);
            return;
        }
        cartBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            cartBtn.style.transform = 'scale(1)';
            window.location.href = 'cart.html';
        }, 150);
    });
}

// Notification System
function showNotification(message, type = 'info') {
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${getNotificationIcon(type)}</span>
            <span class="notification-message">${message}</span>
            <button class="notification-close">&times;</button>
        </div>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 100);

    const autoRemove = setTimeout(() => {
        removeNotification(notification);
    }, 5000);

    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        clearTimeout(autoRemove);
        removeNotification(notification);
    });
}

function getNotificationIcon(type) {
    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ',
        warning: '⚠'
    };
    return icons[type] || icons.info;
}

function removeNotification(notification) {
    notification.classList.add('hide');
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
}

// Smooth Scrolling for Learn More Button
const learnMoreBtn = document.querySelector('.btn-ghost');
if (learnMoreBtn) {
    learnMoreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const featuresSection = document.querySelector('.features-grid');
        if (featuresSection) {
            featuresSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
}

// Ripple Effect
function createRipple(event) {
    const button = event.currentTarget;
    const circle = document.createElement('span');
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;
    
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${event.clientX - button.offsetLeft - radius}px`;
    circle.style.top = `${event.clientY - button.offsetTop - radius}px`;
    circle.classList.add('ripple');
    
    const ripple = button.getElementsByClassName('ripple')[0];
    if (ripple) {
        ripple.remove();
    }
    
    button.appendChild(circle);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.btn-primary, .btn-cta, .btn-submit, .login-btn, .logout-btn');
    buttons.forEach(button => {
        button.addEventListener('click', createRipple);
    });
});

console.log('🚀 NEXUS Store Landing Page Loaded Successfully!');
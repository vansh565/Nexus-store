// Initialize cart count and WebSocket variables
const cartCount = document.querySelector('.cart-count');
let cartItems = [];
let userEmail = localStorage.getItem('userEmail') || null;
let hasShownLoginPrompt = false;
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 5000; // 5 seconds

// Check if user is logged in
function isLoggedIn() {
    const email = localStorage.getItem('userEmail');
    return email && email.trim() !== '' && email !== 'null';
}

// Connect to WebSocket with reconnection logic
function connectWebSocket() {
    ws = new WebSocket('ws://localhost:8080');
    console.log('Attempting WebSocket connection...');

    ws.onopen = () => {
        console.log('Connected to WebSocket server');
        console.log('userEmail:', userEmail, 'localStorage.userEmail:', localStorage.getItem('userEmail'));
        reconnectAttempts = 0; // Reset reconnection attempts
        if (isLoggedIn()) {
            userEmail = localStorage.getItem('userEmail');
            console.log('Sending getCart for:', userEmail);
            ws.send(JSON.stringify({ type: 'getCart', payload: { userEmail } }));
        } else if (!hasShownLoginPrompt) {
            showNotification('Please log in to view your cart', 'warning');
            hasShownLoginPrompt = true;
        }
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message:', data);
        if (data.type === 'cartUpdate') {
            cartItems = data.cart;
            if (cartCount) {
                cartCount.textContent = cartItems.reduce((total, item) => total + item.quantity, 0) || 0;
                cartCount.style.animation = 'bounce 0.5s ease';
                setTimeout(() => {
                    cartCount.style.animation = '';
                }, 500);
            }
        } else if (data.status === 'error') {
            showNotification(data.message, 'error');
            if (data.message === 'Invalid session') {
                userEmail = null;
                localStorage.removeItem('userEmail');
                showNotification('Session expired. Please log in again.', 'warning');
                window.location.href = 'login.html';
            }
        } else if (data.status === 'success' && data.message === 'Login successful') {
            console.log('Login response:', data);
            userEmail = data.user.email;
            console.log('Setting userEmail:', userEmail);
            localStorage.setItem('userEmail', userEmail);
            console.log('localStorage after login:', localStorage.getItem('userEmail'));
            ws.send(JSON.stringify({ type: 'getCart', payload: { userEmail } }));
        }
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        showNotification('Failed to connect to server', 'error');
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed');
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`Reconnecting in ${reconnectDelay / 1000}s... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
            setTimeout(connectWebSocket, reconnectDelay);
        } else {
            showNotification('Unable to connect to server after multiple attempts', 'error');
            hasShownLoginPrompt = false; // Allow login prompt on manual retry
        }
    };
}

// Initial WebSocket connection
connectWebSocket();

// Smooth scrolling for navigation links
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        this.classList.add('active');
        const targetId = this.getAttribute('href');
        if (targetId.includes('.html')) {
            window.location.href = targetId;
        } else {
            const targetSection = document.querySelector(targetId);
            if (targetSection) {
                targetSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        }
    });
});

// Search functionality
const searchInput = document.querySelector('.search-input');
const searchBtn = document.querySelector('.search-btn');

if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', function(e) {
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
        }, 150);
        showNotification(`Searching for "${query}"...`, 'info');
        filterProducts(query);
    }
}

function filterProducts(query) {
    const productCards = document.querySelectorAll('.product-card');
    const lowerQuery = query.toLowerCase();
    productCards.forEach(card => {
        const title = card.querySelector('.product-title')?.textContent.toLowerCase() || '';
        const description = card.querySelector('.product-description')?.textContent.toLowerCase() || '';
        if (title.includes(lowerQuery) || description.includes(lowerQuery)) {
            card.style.display = 'block';
            card.style.animation = 'fadeInUp 0.5s ease-out';
        } else {
            card.style.display = 'none';
        }
    });
    document.querySelector('#products')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

// Cart functionality
const cartBtn = document.querySelector('.cart-btn');
if (cartBtn) {
    cartBtn.addEventListener('click', function() {
        this.style.transform = 'scale(0.95)';
        setTimeout(() => {
            this.style.transform = 'scale(1)';
        }, 150);
        window.location.href = 'cart.html';
    });
}

// Add to cart functionality
if (window.location.pathname.includes('index.html') || window.location.pathname.includes('products') || window.location.pathname.includes('electronics') || window.location.pathname.includes('fashion') || window.location.pathname.includes('home') || window.location.pathname.includes('sports')) {
    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!isLoggedIn()) {
                showNotification('Please log in to add items to cart', 'warning');
                return;
            }
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                showNotification('Cannot add to cart: Server not connected', 'error');
                return;
            }
            const originalText = this.textContent;
            this.textContent = 'Adding...';
            this.disabled = true;
            const productCard = this.closest('.product-card');
            if (!productCard) {
                console.error('No parent product-card found for this button:', this);
                this.textContent = originalText;
                this.disabled = false;
                showNotification('Error: Product not found', 'error');
                return;
            }
            const product = {
                name: productCard.querySelector('.product-title')?.textContent || 'Unknown Product',
                price: productCard.querySelector('.current-price')?.textContent || '0.00',
                image: productCard.querySelector('.product-image img')?.src || '',
                quantity: 1
            };
            ws.send(JSON.stringify({ type: 'addToCart', product, payload: { userEmail } }));
            setTimeout(() => {
                this.textContent = originalText;
                this.disabled = false;
                showNotification(`${product.name} added to cart!`, 'success');
            }, 1000);
        });
    });
}

// Quick view functionality
document.querySelectorAll('.quick-view-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const productCard = this.closest('.product-card');
        if (!productCard) {
            console.error('No parent product-card found for quick-view button:', this);
            showNotification('Error: Product not found', 'error');
            return;
        }
        const product = {
            name: productCard.querySelector('.product-title')?.textContent || 'Unknown Product',
            description: productCard.querySelector('.product-description')?.textContent || '',
            image: productCard.querySelector('.product-image img')?.src || '',
            currentPrice: productCard.querySelector('.current-price')?.textContent || '0.00',
            originalPrice: productCard.querySelector('.original-price')?.textContent || '',
            stars: productCard.querySelector('.stars')?.textContent || '',
            ratingCount: productCard.querySelector('.rating-count')?.textContent || '',
            badge: productCard.querySelector('.product-badge')?.textContent || '',
            badgeClass: productCard.querySelector('.product-badge')?.className || '',
            category: window.location.pathname.includes('electronics') ? 'electronics' :
                     window.location.pathname.includes('fashion') ? 'fashion' :
                     window.location.pathname.includes('home') ? 'home' :
                     window.location.pathname.includes('sports') ? 'sports' : 'electronics'
        };
        localStorage.setItem('quickViewProduct', JSON.stringify(product));
        window.location.href = 'quickview.html';
    });
});

// Category card interactions
document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', function() {
        const category = this.dataset.category;
        const categoryName = this.querySelector('h3')?.textContent || 'Category';
        this.style.transform = 'scale(0.98)';
        setTimeout(() => {
            this.style.transform = '';
        }, 150);
        showNotification(`Browsing ${categoryName} category...`, 'info');
        window.location.href = `${category}.html`;
    });
});

// Countdown timer
function updateCountdown() {
    const days = document.getElementById('days');
    const hours = document.getElementById('hours');
    const minutes = document.getElementById('minutes');
    const seconds = document.getElementById('seconds');
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 24);
    function update() {
        const now = new Date().getTime();
        const distance = targetDate.getTime() - now;
        const d = Math.floor(distance / (1000 * 60 * 60 * 24));
        const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((distance % (1000 * 60)) / 1000);
        if (days) days.textContent = d.toString().padStart(2, '0');
        if (hours) hours.textContent = h.toString().padStart(2, '0');
        if (minutes) minutes.textContent = m.toString().padStart(2, '0');
        if (seconds) seconds.textContent = s.toString().padStart(2, '0');
        if (distance < 0) {
            clearInterval(countdownInterval);
            showNotification('Deal expired!', 'error');
        }
    }
    update();
    const countdownInterval = setInterval(update, 1000);
}

// Newsletter subscription
const newsletterForm = document.querySelector('.newsletter-form');
if (newsletterForm) {
    newsletterForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const emailInput = this.querySelector('.newsletter-input');
        const submitBtn = this.querySelector('.newsletter-btn');
        const email = emailInput.value.trim();
        if (email) {
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Subscribing...';
            submitBtn.disabled = true;
            setTimeout(() => {
                emailInput.value = '';
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
                showNotification('Successfully subscribed to newsletter!', 'success');
            }, 2000);
        }
    });
}

// Scroll animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.animation = 'fadeInUp 0.8s ease-out forwards';
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

// Observe elements for scroll animations
document.addEventListener('DOMContentLoaded', function() {
    updateCountdown();
    const animatedElements = document.querySelectorAll('.section-header, .product-card, .deals-banner, .newsletter-content');
    animatedElements.forEach(el => {
        observer.observe(el);
    });
    const productCards = document.querySelectorAll('.product-card');
    productCards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
    });
    window.addEventListener('scroll', function() {
        const scrolled = window.pageYOffset;
        const heroBackground = document.querySelector('.hero-background');
        if (heroBackground) {
            heroBackground.style.transform = `translateY(${scrolled * 0.5}px)`;
        }
    });
});

// Notification system
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
    }, 4000);
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

// Add ripple effect to buttons
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

document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.btn-primary, .btn-secondary, .deals-btn, .newsletter-btn, .add-to-cart-btn, .quick-view-btn');
    buttons.forEach(button => {
        button.addEventListener('click', createRipple);
    });
});

// Add CSS for notifications and ripple effect
const additionalStyles = `
/* Notification Styles */
.notification {
    position: fixed;
    top: 2rem;
    right: 2rem;
    background: rgba(10, 10, 10, 0.95);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 1rem 1.5rem;
    color: white;
    z-index: 3000;
    transform: translateX(400px);
    opacity: 0;
    transition: all 0.3s ease;
    max-width: 350px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}
.notification.show {
    transform: translateX(0);
    opacity: 1;
}
.notification.hide {
    transform: translateX(400px);
    opacity: 0;
}
.notification-success {
    border-left: 4px solid #10b981;
}
.notification-error {
    border-left: 4px solid #ef4444;
}
.notification-info {
    border-left: 4px solid #3b82f6;
}
.notification-warning {
    border-left: 4px solid #f59e0b;
}
.notification-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}
.notification-icon {
    font-size: 1.2rem;
    font-weight: bold;
}
.notification-success .notification-icon {
    color: #10b981;
}
.notification-error .notification-icon {
    color: #ef4444;
}
.notification-info .notification-icon {
    color: #3b82f6;
}
.notification-warning .notification-icon {
    color: #f59e0b;
}
.notification-message {
    flex: 1;
    font-size: 0.9rem;
    line-height: 1.4;
}
.notification-close {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.3s ease;
    flex-shrink: 0;
}
.notification-close:hover {
    color: #fff;
}
/* Ripple Effect */
.btn-primary, .btn-secondary, .deals-btn, .newsletter-btn, .add-to-cart-btn, .quick-view-btn {
    position: relative;
    overflow: hidden;
}
.ripple {
    position: absolute;
    border-radius: 50%;
    background-color: rgba(255, 255, 255, 0.3);
    transform: scale(0);
    animation: rippleEffect 0.6s linear;
    pointer-events: none;
}
@keyframes rippleEffect {
    to {
        transform: scale(4);
        opacity: 0;
    }
}
@keyframes bounce {
    0%, 20%, 53%, 80%, 100% {
        transform: translate3d(0,0,0);
    }
    40%, 43% {
        transform: translate3d(0, -8px, 0);
    }
    70% {
        transform: translate3d(0, -4px, 0);
    }
    90% {
        transform: translate3d(0, -2px, 0);
    }
}
/* Mobile notification adjustments */
@media (max-width: 768px) {
    .notification {
        top: 1rem;
        right: 1rem;
        left: 1rem;
        max-width: none;
        transform: translateY(-100px);
    }
    .notification.show {
        transform: translateY(0);
    }
    .notification.hide {
        transform: translateY(-100px);
    }
}
`;

// Inject additional styles
const styleSheet = document.createElement('style');
styleSheet.textContent = additionalStyles;
document.head.appendChild(styleSheet);

// Add loading animation for page
window.addEventListener('load', function() {
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.5s ease';
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);
});

console.log('🛍️ E-commerce Dashboard Loaded Successfully!');
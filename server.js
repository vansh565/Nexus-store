const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Ensure Uploads directory exists
const uploadDir = path.join(__dirname, 'public', 'Uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/Uploads');
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 15)}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Images only (JPEG/JPG/PNG)!'));
        }
    }
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Map to track WebSocket clients by sessionToken
const sessionClients = new Map();

// In-memory OTP store
const emailOtpStore = {};

// MongoDB Atlas Connection
const mongoURI = 'mongodb+srv://sharmavansh969:vBRyVI1lpZVSCdrx@cluster0.f7yvuuo.mongodb.net/nexus_users?retryWrites=true&w=majority';

mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => {
      console.error('MongoDB connection error:', err);
      process.exit(1);
  });

// User Schema
const userSchema = new mongoose.Schema({
    name: { type: String },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    profileImage: { type: String, default: '/images/v2.jpg' },
    createdAt: { type: Date, default: Date.now },
});

// Session Schema
const sessionSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
});

// Cart Schema
const cartSchema = new mongoose.Schema({
    userEmail: { type: String, required: true, unique: true },
    items: [{
        id: { type: String, required: true },
        name: { type: String, required: true },
        price: { type: String, required: true },
        image: { type: String, default: '/images/v2.jpg' },
        quantity: { type: Number, default: 1 }
    }],
    updatedAt: { type: Date, default: Date.now }
});

// Wishlist Schema
const wishlistSchema = new mongoose.Schema({
    userEmail: { type: String, required: true, unique: true },
    items: [{
        id: { type: String, required: true },
        name: { type: String, required: true },
        price: { type: String, required: true },
        image: { type: String, default: '/images/v2.jpg' }
    }],
    updatedAt: { type: Date, default: Date.now }
});

// Order Schema
const orderSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    productId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: String, required: true },
    quantity: { type: Number, required: true },
    shippingAddress: { type: String, required: true },
    paymentMethod: { type: String, required: true },
    image: { type: String, default: '/images/v2.jpg' }, // Added image field
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Session = mongoose.model('Session', sessionSchema);
const Cart = mongoose.model('Cart', cartSchema);
const Wishlist = mongoose.model('Wishlist', wishlistSchema);
const Order = mongoose.model('Order', orderSchema);

// Nodemailer setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'sanjuuppal458@gmail.com',
        pass: 'mtaknqniefogwjzq' // Ensure this is a valid App Password
    }
});

// Middleware
app.use(cors({
    origin: ['http://localhost:8080', 'http://127.0.0.1:5501', 'http://localhost:5501'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-session-token'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// File upload route
app.options('/upload-profile-image', (req, res) => {
    res.set({
        'Access-Control-Allow-Origin': req.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,x-session-token'
    });
    res.status(200).send();
});

app.post('/upload-profile-image', upload.single('profileImage'), async (req, res) => {
    console.log('Received POST request to /upload-profile-image', {
        headers: req.headers,
        file: req.file,
        sessionToken: req.headers['x-session-token']
    });
    try {
        const sessionToken = req.headers['x-session-token'];
        if (!sessionToken) {
            console.log('No session token provided');
            return res.status(401).json({ status: 'error', message: 'Session token required' });
        }

        const session = await Session.findOne({ token: sessionToken });
        if (!session || session.expiresAt < new Date()) {
            console.log('Invalid or expired session');
            return res.status(401).json({ status: 'error', message: 'Invalid or expired session' });
        }

        if (!req.file) {
            console.log('No file uploaded');
            return res.status(400).json({ status: 'error', message: 'No file uploaded' });
        }

        const imagePath = `/Uploads/${req.file.filename}`;
        console.log(`Image uploaded: ${imagePath}`);

        const user = await User.findOne({ email: session.userEmail });
        if (!user) {
            console.log('User not found');
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        if (user.profileImage && user.profileImage !== '/images/v2.jpg') {
            const oldImagePath = path.join(__dirname, 'public', user.profileImage);
            fs.unlink(oldImagePath, (err) => {
                if (err) console.error(`Failed to delete old image: ${err.message}`);
            });
        }

        user.profileImage = imagePath;
        await user.save();

        const clients = sessionClients.get(sessionToken) || [];
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'updateProfile',
                    status: 'success',
                    message: 'Profile image updated successfully',
                    user: { email: user.email, name: user.name, profileImage: user.profileImage }
                }));
            }
        });

        res.status(200).json({ status: 'success', message: 'Profile image updated successfully', profileImage: imagePath });
    } catch (err) {
        console.error('Error uploading image:', err);
        res.status(500).json({ status: 'error', message: 'Server error: ' + err.message });
    }
});

app.all('/upload-profile-image', (req, res) => {
    if (req.method !== 'POST') {
        console.log(`Method ${req.method} not allowed for /upload-profile-image`);
        res.set('Allow', 'POST');
        res.status(405).json({ status: 'error', message: `Method ${req.method} not allowed. Use POST.` });
    }
});

// WebSocket Connection
wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (message) => {
        try {
            console.log('Received WebSocket message:', message.toString());
            const data = JSON.parse(message);
            const { type, payload, product, productId, order } = data;

            if (payload && payload.sessionToken) {
                if (!sessionClients.has(payload.sessionToken)) {
                    sessionClients.set(payload.sessionToken, new Set());
                }
                sessionClients.get(payload.sessionToken).add(ws);
            }

            async function validateSession(sessionToken) {
                if (!sessionToken) {
                    throw new Error('Session token required');
                }
                const session = await Session.findOne({ token: sessionToken });
                if (!session || session.expiresAt < new Date()) {
                    throw new Error('Invalid or expired session');
                }
                return session.userEmail;
            }

            if (type === 'signup') {
                const { name, email, password } = payload;
                if (!email || !password) {
                    ws.send(JSON.stringify({ status: 'error', message: 'Email and password are required' }));
                    return;
                }

                const existingUser = await User.findOne({ email });
                if (existingUser) {
                    ws.send(JSON.stringify({ status: 'error', message: 'Email already exists' }));
                    return;
                }

                const hashedPassword = await bcrypt.hash(password, 10);
                const user = new User({ name, email, password: hashedPassword });
                await user.save();

                const cart = new Cart({ userEmail: email, items: [] });
                await cart.save();

                const wishlist = new Wishlist({ userEmail: email, items: [] });
                await wishlist.save();

                const sessionToken = uuidv4();
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
                const session = new Session({ userEmail: email, token: sessionToken, expiresAt });
                await session.save();

                ws.send(JSON.stringify({
                    type: 'signup',
                    status: 'success',
                    message: 'Account created successfully',
                    user: { email, name, profileImage: user.profileImage },
                    sessionToken,
                    cart: [],
                    wishlist: []
                }));
            } else if (type === 'login') {
                const { email, password } = payload;
                if (!email || !password) {
                    ws.send(JSON.stringify({ status: 'error', message: 'Email and password are required' }));
                    return;
                }

                const user = await User.findOne({ email });
                if (!user || !(await bcrypt.compare(password, user.password))) {
                    ws.send(JSON.stringify({ status: 'error', message: 'Invalid email or password' }));
                    return;
                }

                const sessionToken = uuidv4();
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
                await Session.deleteMany({ userEmail: email });
                const session = new Session({ userEmail: email, token: sessionToken, expiresAt });
                await session.save();

                const cart = await Cart.findOne({ userEmail: email });
                const wishlist = await Wishlist.findOne({ userEmail: email });
                ws.send(JSON.stringify({
                    type: 'login',
                    status: 'success',
                    message: 'Login successful',
                    user: { email: user.email, name: user.name, profileImage: user.profileImage },
                    sessionToken,
                    cart: cart ? cart.items : [],
                    wishlist: wishlist ? wishlist.items : []
                }));
            } else if (type === 'validateSession') {
                const { sessionToken } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    const user = await User.findOne({ email: userEmail });
                    const cart = await Cart.findOne({ userEmail });
                    const wishlist = await Wishlist.findOne({ userEmail });
                    ws.send(JSON.stringify({
                        type: 'validateSession',
                        status: 'success',
                        user: { email: user.email, name: user.name, profileImage: user.profileImage },
                        cart: cart ? cart.items || [] : [],
                        wishlist: wishlist ? wishlist.items || [] : []
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'logout') {
                const { sessionToken } = payload;
                await Session.deleteOne({ token: sessionToken });
                sessionClients.delete(sessionToken);
                ws.send(JSON.stringify({ type: 'logout', status: 'success', message: 'Logged out successfully' }));
            } else if (type === 'addToCart') {
                const { sessionToken } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    let cart = await Cart.findOne({ userEmail });
                    if (!cart) {
                        cart = new Cart({ userEmail, items: [] });
                    }
                    if (!product || !product.id || !product.name || !product.price) {
                        ws.send(JSON.stringify({ status: 'error', message: 'Invalid product data' }));
                        return;
                    }
                    const existingItem = cart.items.find(item => item.id === product.id);
                    if (existingItem) {
                        existingItem.quantity = product.quantity || existingItem.quantity + 1;
                    } else {
                        cart.items.push({
                            id: product.id,
                            name: product.name,
                            price: product.price,
                            image: product.image || '/images/v2.jpg',
                            quantity: product.quantity || 1
                        });
                    }
                    cart.updatedAt = Date.now();
                    await cart.save();
                    const clients = sessionClients.get(sessionToken) || [];
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'cartUpdate',
                                status: 'success',
                                message: existingItem ? 'Cart updated' : 'Item added to cart',
                                cart: cart.items || []
                            }));
                        }
                    });
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'updateCart') {
                const { sessionToken, productId, quantity } = payload;
                try {
                    if (!productId || !quantity || quantity < 1 || !Number.isInteger(quantity)) {
                        ws.send(JSON.stringify({ type: 'cartUpdate', status: 'error', message: 'Invalid productId or quantity' }));
                        return;
                    }
                    const userEmail = await validateSession(sessionToken);
                    let cart = await Cart.findOne({ userEmail });
                    if (!cart || !cart.items || cart.items.length === 0) {
                        ws.send(JSON.stringify({ type: 'cartUpdate', status: 'error', message: 'Cart not found or empty' }));
                        return;
                    }
                    const item = cart.items.find(item => item.id === productId);
                    if (!item) {
                        ws.send(JSON.stringify({ type: 'cartUpdate', status: 'error', message: 'Item not found in cart' }));
                        return;
                    }
                    item.quantity = quantity;
                    cart.updatedAt = Date.now();
                    await cart.save();
                    const clients = sessionClients.get(sessionToken) || [];
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'cartUpdate',
                                status: 'success',
                                message: 'Cart updated',
                                cart: cart.items || []
                            }));
                        }
                    });
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'removeFromCart') {
                const { sessionToken, productId } = payload;
                try {
                    if (!productId) {
                        ws.send(JSON.stringify({ type: 'cartUpdate', status: 'error', message: 'productId is required' }));
                        return;
                    }
                    const userEmail = await validateSession(sessionToken);
                    let cart = await Cart.findOne({ userEmail });
                    if (!cart || !cart.items || cart.items.length === 0) {
                        ws.send(JSON.stringify({ type: 'cartUpdate', status: 'error', message: 'Cart not found or empty' }));
                        return;
                    }
                    const initialLength = cart.items.length;
                    cart.items = cart.items.filter(item => item.id !== productId);
                    if (cart.items.length === initialLength) {
                        ws.send(JSON.stringify({ type: 'cartUpdate', status: 'error', message: 'Item not found in cart' }));
                        return;
                    }
                    cart.updatedAt = Date.now();
                    await cart.save();
                    const clients = sessionClients.get(sessionToken) || [];
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'cartUpdate',
                                status: 'success',
                                message: 'Item removed from cart',
                                cart: cart.items || []
                            }));
                        }
                    });
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'getCart') {
                const { sessionToken } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    const cart = await Cart.findOne({ userEmail });
                    ws.send(JSON.stringify({
                        type: 'cartUpdate',
                        status: 'success',
                        message: 'Cart retrieved successfully',
                        cart: cart ? cart.items || [] : []
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'addToWishlist') {
                const { sessionToken } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    let wishlist = await Wishlist.findOne({ userEmail });
                    if (!wishlist) {
                        wishlist = new Wishlist({ userEmail, items: [] });
                    }
                    if (!product || !product.id || !product.name || !product.price) {
                        ws.send(JSON.stringify({ status: 'error', message: 'Invalid product data' }));
                        return;
                    }
                    const existingItem = wishlist.items.find(item => item.id === product.id);
                    if (existingItem) {
                        ws.send(JSON.stringify({
                            type: 'wishlistUpdate',
                            status: 'error',
                            message: 'Item already in wishlist'
                        }));
                        return;
                    }
                    wishlist.items.push({
                        id: product.id,
                        name: product.name,
                        price: product.price,
                        image: product.image || '/images/v2.jpg'
                    });
                    wishlist.updatedAt = Date.now();
                    await wishlist.save();
                    ws.send(JSON.stringify({
                        type: 'wishlistUpdate',
                        status: 'success',
                        message: 'Item added to wishlist',
                        wishlist: wishlist.items || []
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'removeFromWishlist') {
                const { sessionToken } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    let wishlist = await Wishlist.findOne({ userEmail });
                    if (!wishlist || !wishlist.items || wishlist.items.length === 0) {
                        ws.send(JSON.stringify({
                            type: 'wishlistUpdate',
                            status: 'error',
                            message: 'Wishlist not found or empty'
                        }));
                        return;
                    }
                    const initialLength = wishlist.items.length;
                    wishlist.items = wishlist.items.filter(item => item.id !== productId);
                    if (wishlist.items.length === initialLength) {
                        ws.send(JSON.stringify({
                            type: 'wishlistUpdate',
                            status: 'error',
                            message: 'Item not found in wishlist'
                        }));
                        return;
                    }
                    wishlist.updatedAt = Date.now();
                    await wishlist.save();
                    ws.send(JSON.stringify({
                        type: 'wishlistUpdate',
                        status: 'success',
                        message: 'Item removed from wishlist',
                        wishlist: wishlist.items || []
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'sendEmailOtp') {
                const { sessionToken, email } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                        ws.send(JSON.stringify({ status: 'error', message: 'Invalid email address' }));
                        return;
                    }
                    const user = await User.findOne({ email });
                    if (user && email !== userEmail) {
                        ws.send(JSON.stringify({ status: 'error', message: 'Email already registered' }));
                        return;
                    }
                    const otp = Math.floor(100000 + Math.random() * 900000).toString();
                    const expiresAt = Date.now() + 10 * 60 * 1000;
                    emailOtpStore[email] = { otp, expiresAt };

                    const mailOptions = {
                        from: 'NEXUS Store <sanjuuppal458@gmail.com>',
                        to: email,
                        subject: 'NEXUS Store OTP Verification',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                                <h2 style="color: #3b82f6;">NEXUS Store Email Verification</h2>
                                <p>Your OTP for email verification is <strong>${otp}</strong>.</p>
                                <p>This OTP is valid for 10 minutes.</p>
                                <p>If you did not request this, please ignore this email.</p>
                                <p style="color: #555; font-size: 12px;">Contact us at support@nexusstore.com if you need assistance.</p>
                            </div>
                        `
                    };

                    await transporter.sendMail(mailOptions);
                    console.log(`✅ OTP email sent to: ${email}`);
                    ws.send(JSON.stringify({ type: 'sendEmailOtp', status: 'success', message: 'OTP sent to your email' }));
                } catch (err) {
                    console.error(`❌ Failed to send OTP email: ${err.message}`);
                    ws.send(JSON.stringify({ type: 'sendEmailOtp', status: 'error', message: 'Failed to send OTP' }));
                }
            } else if (type === 'verifyEmailOtp') {
                const { sessionToken, email, otp } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    if (!email || !otp) {
                        ws.send(JSON.stringify({ status: 'error', message: 'Email and OTP are required' }));
                        return;
                    }
                    const storedOtp = emailOtpStore[email];
                    if (!storedOtp || storedOtp.otp !== otp || storedOtp.expiresAt < Date.now()) {
                        ws.send(JSON.stringify({ status: 'error', message: 'Invalid or expired OTP' }));
                        return;
                    }
                    delete emailOtpStore[email];
                    ws.send(JSON.stringify({ type: 'verifyEmailOtp', status: 'success', message: 'Email verified successfully' }));
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'updateProfile') {
                const { sessionToken, name, email, profileImage } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    const user = await User.findOne({ email: userEmail });
                    if (!user) {
                        ws.send(JSON.stringify({ status: 'error', message: 'User not found' }));
                        return;
                    }
                    if (name) {
                        user.name = name;
                    }
                    if (email && email !== userEmail) {
                        const existingUser = await User.findOne({ email });
                        if (existingUser) {
                            ws.send(JSON.stringify({ status: 'error', message: 'Email already registered' }));
                            return;
                        }
                        const storedOtp = emailOtpStore[email];
                        if (!storedOtp || storedOtp.expiresAt < Date.now()) {
                            ws.send(JSON.stringify({ status: 'error', message: 'Email verification required. Please request OTP.' }));
                            return;
                        }
                        user.email = email;
                        await Session.updateMany({ userEmail }, { userEmail: email });
                        await Cart.updateOne({ userEmail }, { userEmail: email });
                        await Wishlist.updateOne({ userEmail }, { userEmail: email });
                        await Order.updateMany({ userEmail }, { userEmail: email });
                        delete emailOtpStore[email];
                    }
                    if (profileImage) {
                        user.profileImage = profileImage;
                    }
                    await user.save();
                    const clients = sessionClients.get(sessionToken) || [];
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'updateProfile',
                                status: 'success',
                                message: 'Profile updated successfully',
                                user: { email: user.email, name: user.name, profileImage: user.profileImage }
                            }));
                        }
                    });
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'placeOrder') {
                const { sessionToken } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    if (!order || !order.items || !Array.isArray(order.items) || order.items.length === 0 || !order.shippingAddress || !order.paymentMethod) {
                        ws.send(JSON.stringify({ status: 'error', message: 'Invalid order data: items, shippingAddress, and paymentMethod are required' }));
                        return;
                    }

                    const orders = [];
                    for (const item of order.items) {
                        if (!item.id || !item.name || !item.price || !item.quantity) {
                            ws.send(JSON.stringify({ status: 'error', message: 'Invalid item data in order' }));
                            return;
                        }
                        const newOrder = new Order({
                            userEmail,
                            productId: item.id,
                            name: item.name,
                            price: item.price,
                            quantity: item.quantity,
                            shippingAddress: order.shippingAddress,
                            paymentMethod: order.paymentMethod,
                            image: item.image || '/images/v2.jpg'
                        });
                        await newOrder.save();
                        orders.push({
                            _id: newOrder._id,
                            productId: newOrder.productId,
                            name: newOrder.name,
                            price: newOrder.price,
                            quantity: newOrder.quantity,
                            shippingAddress: newOrder.shippingAddress,
                            paymentMethod: newOrder.paymentMethod,
                            createdAt: newOrder.createdAt,
                            image: newOrder.image
                        });
                    }

                    let totalPrice = 0;
                    const orderSummary = order.items
                        .map(item => {
                            const itemPrice = parseFloat(item.price.replace('$', '')) * item.quantity;
                            totalPrice += itemPrice;
                            return `
                                <li>
                                    <strong>${item.name}</strong> x${item.quantity} — $${itemPrice.toFixed(2)}
                                    ${item.image ? `<br><img src="${item.image}" alt="${item.name}" style="width:100px;height:100px;object-fit:cover;" />` : ""}
                                </li>
                            `;
                        })
                        .join('');

                    const discount = totalPrice * 0.1;
                    const deliveryFee = 10;
                    const finalAmount = totalPrice - discount + deliveryFee;

                    const userMailOptions = {
                        from: 'NEXUS Store <sanjuuppal458@gmail.com>',
                        to: userEmail,
                        subject: '🛒 Your NEXUS Store Order Confirmation',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                                <h2 style="color: #3b82f6;">Thank You for Your Order!</h2>
                                <p>Dear Customer (Email: ${userEmail}),</p>
                                <p>Your order has been successfully placed with NEXUS Store. Below are the details:</p>
                                <h3>Order Summary</h3>
                                <ul style="list-style-type: none; padding: 0;">
                                    ${orderSummary}
                                </ul>
                                <p><strong>Total Price:</strong> $${totalPrice.toFixed(2)}</p>
                                <p><strong>Discount (10%):</strong> −$${discount.toFixed(2)}</p>
                                <p><strong>Delivery Fee:</strong> $${deliveryFee.toFixed(2)}</p>
                                <p><strong>Final Amount:</strong> $${finalAmount.toFixed(2)}</p>
                                <p><strong>Shipping Address:</strong> ${order.shippingAddress}</p>
                                <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
                                <p>We’ll notify you once your order is shipped. Thank you for shopping with us! 🚀</p>
                                <p style="color: #555; font-size: 12px;">If you have any questions, contact us at support@nexusstore.com.</p>
                            </div>
                        `
                    };

                    const adminEmail = 'vansh565.sharma@gmail.com';
                    const adminMailOptions = {
                        from: 'NEXUS Store <sanjuuppal458@gmail.com>',
                        to: adminEmail,
                        subject: `📦 New Order Received from User: ${userEmail}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                                <h2 style="color: #3b82f6;">New Order Notification</h2>
                                <p>A new order has been placed with the following details:</p>
                                <p><strong>User Email:</strong> ${userEmail}</p>
                                <p><strong>Order Date:</strong> ${new Date().toLocaleString()}</p>
                                <h3>Order Summary</h3>
                                <ul style="list-style-type: none; padding: 0;">
                                    ${orderSummary}
                                </ul>
                                <p><strong>Total Price:</strong> $${totalPrice.toFixed(2)}</p>
                                <p><strong>Discount (10%):</strong> −$${discount.toFixed(2)}</p>
                                <p><strong>Delivery Fee:</strong> $${deliveryFee.toFixed(2)}</p>
                                <p><strong>Final Amount:</strong> $${finalAmount.toFixed(2)}</p>
                                <p><strong>Shipping Address:</strong> ${order.shippingAddress}</p>
                                <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
                                <p>Please process this order promptly.</p>
                            </div>
                        `
                    };

                    try {
                        await transporter.sendMail(userMailOptions);
                        console.log(`✅ Email sent to user: ${userEmail}`);
                    } catch (userEmailError) {
                        console.error(`❌ Failed to send email to user: ${userEmailError.message}`);
                    }

                    try {
                        await transporter.sendMail(adminMailOptions);
                        console.log(`✅ Email sent to admin: ${adminEmail}`);
                    } catch (adminEmailError) {
                        console.error(`❌ Failed to send email to admin: ${adminEmailError.message}`);
                    }

                    await Cart.deleteMany({ userEmail });

                    const clients = sessionClients.get(sessionToken) || [];
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'placeOrder',
                                status: 'success',
                                message: 'Order placed successfully',
                                orders
                            }));
                        }
                    });
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'getOrders') {
                const { sessionToken } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    const orders = await Order.find({ userEmail }).sort({ createdAt: -1 });
                    const clients = sessionClients.get(sessionToken) || [];
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'getOrders',
                                status: 'success',
                                message: 'Orders retrieved successfully',
                                orders: orders.map(order => ({
                                    _id: order._id,
                                    productId: order.productId,
                                    name: order.name,
                                    price: order.price,
                                    quantity: order.quantity,
                                    shippingAddress: order.shippingAddress,
                                    paymentMethod: order.paymentMethod,
                                    createdAt: order.createdAt,
                                    image: order.image
                                }))
                            }));
                        }
                    });
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else if (type === 'removeOrder') {
                const { sessionToken, orderId } = payload;
                try {
                    const userEmail = await validateSession(sessionToken);
                    const order = await Order.findOne({ _id: orderId, userEmail });
                    if (!order) {
                        ws.send(JSON.stringify({ status: 'error', message: 'Order not found or you do not have permission to delete it' }));
                        return;
                    }
                    await Order.deleteOne({ _id: orderId, userEmail });

                    const userMailOptions = {
                        from: 'NEXUS Store <sanjuuppal458@gmail.com>',
                        to: userEmail,
                        subject: '🛒 Your NEXUS Store Order Cancellation',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                                <h2 style="color: #ef4444;">Order Cancelled</h2>
                                <p>Dear Customer (Email: ${userEmail}),</p>
                                <p>Your order for <strong>${order.name}</strong> has been successfully cancelled. Below are the details:</p>
                                <ul style="list-style-type: none; padding: 0;">
                                    <li>
                                        <strong>${order.name}</strong> x${order.quantity} — $${(parseFloat(order.price.replace('$', '')) * order.quantity).toFixed(2)}
                                        ${order.image ? `<br><img src="${order.image}" alt="${order.name}" style="width:100px;height:100px;object-fit:cover;" />` : ""}
                                    </li>
                                </ul>
                                <p><strong>Shipping Address:</strong> ${order.shippingAddress}</p>
                                <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
                                <p><strong>Ordered On:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
                                <p>If you have any questions, contact us at support@nexusstore.com.</p>
                            </div>
                        `
                    };

                    const adminEmail = 'vansh565.sharma@gmail.com';
                    const adminMailOptions = {
                        from: 'NEXUS Store <sanjuuppal458@gmail.com>',
                        to: adminEmail,
                        subject: `📦 Order Cancellation Notification from User: ${userEmail}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                                <h2 style="color: #ef4444;">Order Cancellation Notification</h2>
                                <p>An order has been cancelled by the user with the following details:</p>
                                <p><strong>User Email:</strong> ${userEmail}</p>
                                <p><strong>Order ID:</strong> ${orderId}</p>
                                <ul style="list-style-type: none; padding: 0;">
                                    <li>
                                        <strong>${order.name}</strong> x${order.quantity} — $${(parseFloat(order.price.replace('$', '')) * order.quantity).toFixed(2)}
                                        ${order.image ? `<br><img src="${order.image}" alt="${order.name}" style="width:100px;height:100px;object-fit:cover;" />` : ""}
                                    </li>
                                </ul>
                                <p><strong>Shipping Address:</strong> ${order.shippingAddress}</p>
                                <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
                                <p><strong>Ordered On:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
                                <p>Please update your records accordingly.</p>
                            </div>
                        `
                    };

                    try {
                        await transporter.sendMail(userMailOptions);
                        console.log(`✅ Cancellation email sent to user: ${userEmail}`);
                    } catch (userEmailError) {
                        console.error(`❌ Failed to send cancellation email to user: ${userEmailError.message}`);
                    }

                    try {
                        await transporter.sendMail(adminMailOptions);
                        console.log(`✅ Cancellation email sent to admin: ${adminEmail}`);
                    } catch (adminEmailError) {
                        console.error(`❌ Failed to send cancellation email to admin: ${adminEmailError.message}`);
                    }

                    const clients = sessionClients.get(sessionToken) || [];
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'cancelOrder',
                                status: 'success',
                                message: 'Order cancel successfully'
                            }));
                        }
                    });
                } catch (err) {
                    ws.send(JSON.stringify({ status: 'error', message: err.message }));
                }
            } else {
                ws.send(JSON.stringify({ status: 'error', message: 'Invalid request type' }));
            }
        } catch (err) {
            console.error('Error processing WebSocket message:', err);
            ws.send(JSON.stringify({ status: 'error', message: 'Server error: ' + err.message }));
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        for (let [sessionToken, clients] of sessionClients) {
            clients.delete(ws);
            if (clients.size === 0) {
                sessionClients.delete(sessionToken);
            }
        }
    });
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
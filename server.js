const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: "*", // Replace with your frontend URL in production
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Initialize Firebase Admin with environment variable or local file
const firebaseConfig = process.env.FIREBASE_ADMIN_CONFIG
    ? JSON.parse(process.env.FIREBASE_ADMIN_CONFIG)
    : require('./config/firebase-admin.json');

try {
    admin.initializeApp({
        credential: admin.credential.cert(firebaseConfig)
    });
    console.log('Firebase Admin initialized successfully');
} catch (error) {
    console.log('Firebase Admin initialization error:', error);
}

const db = admin.firestore();

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('user:connect', ({ userId }) => {
        console.log(`User ${userId} connected with socket ${socket.id}`);
        socket.userId = userId;
        socket.join(`user_${userId}`);
    });

    socket.on('message:send', (message) => {
        console.log('Message received:', message);
        if (message.chatId) {
            socket.to(message.chatId).emit('message:received', message);
        }
    });

    socket.on('chat:join', (chatId) => {
        console.log(`Socket ${socket.id} joining chat ${chatId}`);
        socket.join(chatId);
    });

    socket.on('chat:leave', (chatId) => {
        console.log(`Socket ${socket.id} leaving chat ${chatId}`);
        socket.leave(chatId);
    });

    socket.on('request:join', async ({ chatId, userId }) => {
        try {
            const chatRef = db.collection('chats').doc(chatId);
            const chatDoc = await chatRef.get();
            if (!chatDoc.exists) {
                console.log(`Chat ${chatId} not found`);
                return;
            }
            const creatorId = chatDoc.data().creatorId;

            await db.collection('chat-requests').doc(chatId).collection('requests').doc(userId).set({
                requesterId: userId,
                status: 'pending',
                requestedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log(`Join request from ${userId} for chat ${chatId} sent to ${creatorId}`);
            io.to(`user_${creatorId}`).emit('request:received', { chatId, requesterId: userId });
        } catch (error) {
            console.error('Error handling join request:', error);
        }
    });

    socket.on('request:respond', async ({ chatId, requesterId, accept }) => {
        try {
            const requestRef = db.collection('chat-requests').doc(chatId).collection('requests').doc(requesterId);
            await requestRef.update({ status: accept ? 'accepted' : 'rejected' });

            if (accept) {
                await db.collection('chats').doc(chatId).update({
                    participants: admin.firestore.FieldValue.arrayUnion(requesterId)
                });
                console.log(`User ${requesterId} added to chat ${chatId}`);
            }

            console.log(`Response to ${requesterId} for chat ${chatId}: ${accept ? 'accepted' : 'rejected'}`);
            io.to(`user_${requesterId}`).emit('request:response', { chatId, status: accept ? 'accepted' : 'rejected' });
        } catch (error) {
            console.error('Error handling request response:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        user: 'Jigen-Ohtsusuki'
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log(`Current user: Jigen-Ohtsusuki`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

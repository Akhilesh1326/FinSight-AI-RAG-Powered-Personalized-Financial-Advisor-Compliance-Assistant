const express = require("express")
const PORT = process.env.PORT || 8000;
const ConnectDB = require("./ConnectDB");
const cors = require('cors');
const bodyParser = require('body-parser')
require('dotenv').config();

// JWT related imports
const cookieParser = require('cookie-parser');
const http = require('http');
const jwt = require('jsonwebtoken');

// RAG related imports
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Client } = require('@elastic/elasticsearch');

// Import helper functions
const { initializeElasticsearch } = require('./controllers/documentController');

// Import routes
const ragRoutes = require('./routes/ragRoutes');

// Initialize services
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Elasticsearch client

const esClient = new Client({
  node: process.env.ELASTICSEARCH_URL || 'https://localhost:9200',
  auth: {
    username: 'elastic',
    password: process.env.ELASTICSEARCH_PASSWORD || 'your_password_here'
  },
  tls: {
    rejectUnauthorized: false // needed if you're using a self-signed certificate
  }
});


// Server by express
const app = express()

// cors policy
app.use(cors({
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'DELETE', 'UPDATE'],
    credentials: true
}));

// Middlewares
app.use(express.json());
app.use(bodyParser.json());
app.use(express.urlencoded({extended: false}));
app.use(cookieParser());

// Create data directory if it doesn't exist
if (!fs.existsSync('data')) {
  fs.mkdirSync('data');
}

// Basic greeting endpoint
app.get("/api/greet", (req, res) => {
  res.json({ message: "Hello from RAG System!" });
});

// Use RAG routes
app.use('/api', ragRoutes(esClient, model));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    services: {
      elasticsearch: 'Connected',
      gemini: 'Ready',
      huggingface: 'Ready'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  const multer = require('multer');
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File upload error: ' + error.message });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// // 404 handler
// app.use('*', (req, res) => {
//   res.status(404).json({ error: 'Route not found' });
// });

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server started at http://localhost:${PORT}`);
  await initializeElasticsearch(esClient);
});
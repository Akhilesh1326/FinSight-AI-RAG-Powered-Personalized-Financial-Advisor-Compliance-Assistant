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
const multer = require('multer');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Client } = require('@elastic/elasticsearch');

// Import helper functions
const {
  chunkText,
  indexDocument,
  searchSimilarChunks,
  parsePdfFile,
  generateGeminiResponse,
  initializeElasticsearch
} = require('./controllers/documentController');

// Initialize services
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Elasticsearch client
const esClient = new Client({
  node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200'
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

app.get("/api/greet", (req, res) => {
  res.json({ message: "Hello from RAG System!" });
});

// Multer configuration
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "data");
    },
    filename: (req, file, cb) => {
      const splittedFileName = file.originalname.split(".");
      const fileExtension = splittedFileName[splittedFileName.length-1];
      const fileName = `${Date.now()}.${fileExtension}`;
      cb(null, fileName);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Upload and process PDF
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    console.log('Processing PDF:', req.file.filename);
    
    // Read and parse PDF using helper function
    const pdfText = await parsePdfFile(req.file.path);
    console.log('PDF parsed, text length:', pdfText.length);
    
    // Chunk the text using helper function
    const chunks = chunkText(pdfText);
    console.log('Created chunks:', chunks.length);
    
    // Index chunks in Elasticsearch using helper function
    await indexDocument(chunks, req.file.filename, esClient);
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    res.json({
      message: 'PDF processed successfully',
      filename: req.file.filename,
      chunks: chunks.length,
      textLength: pdfText.length
    });
    
  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).json({ error: 'Failed to process PDF: ' + error.message });
  }
});

// Query the RAG system
app.post('/api/query', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }
    
    console.log('Processing query:', question);
    
    // Search for relevant chunks using helper function
    const relevantChunks = await searchSimilarChunks(question, esClient, 3);
    
    if (relevantChunks.length === 0) {
      return res.json({
        answer: "I couldn't find any relevant information in the uploaded documents.",
        sources: []
      });
    }
    
    // Generate response using Gemini helper function
    const answer = await generateGeminiResponse(question, relevantChunks, model);
    
    res.json({
      answer: answer,
      sources: relevantChunks.map(chunk => ({
        filename: chunk.filename,
        snippet: chunk.content.substring(0, 200) + '...',
        score: chunk.score
      }))
    });
    
  } catch (error) {
    console.error('Error processing query:', error);
    res.status(500).json({ error: 'Failed to process query: ' + error.message });
  }
});

// Get all indexed documents
app.get('/api/documents', async (req, res) => {
  try {
    const searchResponse = await esClient.search({
      index: 'documents',
      body: {
        query: { match_all: {} },
        aggs: {
          by_filename: {
            terms: {
              field: 'filename.keyword',
              size: 100
            }
          }
        },
        size: 0
      }
    });
    
    const documents = searchResponse.body.aggregations.by_filename.buckets.map(bucket => ({
      filename: bucket.key,
      chunks: bucket.doc_count
    }));
    
    res.json({ documents });
    
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Delete a document
app.delete('/api/documents/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    await esClient.deleteByQuery({
      index: 'documents',
      body: {
        query: {
          term: { 'filename.keyword': filename }
        }
      }
    });
    
    res.json({ message: `Document ${filename} deleted successfully` });
    
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

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
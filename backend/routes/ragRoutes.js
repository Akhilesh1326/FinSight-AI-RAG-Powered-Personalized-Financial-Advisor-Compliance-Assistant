const express = require('express');
const multer = require('multer');
const fs = require('fs');

// Import helper functions
const {
  chunkText,
  indexDocument,
  searchSimilarChunks,
  parsePdfFile,
  generateGeminiResponse
} = require('../controllers/documentController');

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

// Export a function that takes esClient and model as parameters
module.exports = (esClient, model) => {
  const router = express.Router();

  // Upload and process PDF
  router.post('/upload', upload.single('pdf'), async (req, res) => {
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
  router.post('/query', async (req, res) => {
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
  router.get('/documents', async (req, res) => {
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
  router.delete('/documents/:filename', async (req, res) => {
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

  return router;
};
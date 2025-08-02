// helpers/ragHelpers.js
const fs = require('fs');
const pdf = require('pdf-parse');

async function getEmbeddings(text) {
  try {
    const response = await fetch(
      "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
      {
        headers: { 
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        method: "POST",
        body: JSON.stringify({ inputs: text }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting embeddings:', error);
    throw error;
  }
}

function chunkText(text, chunkSize = 500, overlap = 50) {
  const chunks = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Keep some overlap
      const words = currentChunk.split(' ');
      currentChunk = words.slice(-overlap).join(' ') + ' ' + sentence;
    } else {
      currentChunk += sentence + '. ';
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

async function indexDocument(chunks, filename, esClient) {
  try {
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await getEmbeddings(chunks[i]);
      
      await esClient.index({
        index: 'documents',
        id: `${filename}_chunk_${i}`,
        body: {
          content: chunks[i],
          embedding: embedding,
          filename: filename,
          chunk_id: i,
          timestamp: new Date()
        }
      });
    }
    
    await esClient.indices.refresh({ index: 'documents' });
    console.log(`Indexed ${chunks.length} chunks for ${filename}`);
  } catch (error) {
    console.error('Error indexing document:', error);
    throw error;
  }
}

async function searchSimilarChunks(query, esClient, topK = 5) {
  try {
    const queryEmbedding = await getEmbeddings(query);
    
    const searchResponse = await esClient.search({
      index: 'documents',
      body: {
        query: {
          script_score: {
            query: { match_all: {} },
            script: {
              source: "cosineSimilarity(params.queryVector, 'embedding') + 1.0",
              params: {
                queryVector: queryEmbedding
              }
            }
          }
        },
        size: topK,
        _source: ['content', 'filename', 'chunk_id']
      }
    });
    
    return searchResponse.body.hits.hits.map(hit => ({
      content: hit._source.content,
      filename: hit._source.filename,
      score: hit._score
    }));
  } catch (error) {
    console.error('Error searching similar chunks:', error);
    throw error;
  }
}

async function parsePdfFile(filePath) {
  try {
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(pdfBuffer);
    return pdfData.text;
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw error;
  }
}

async function generateGeminiResponse(question, relevantChunks, model) {
  try {
    // Prepare context for Gemini
    const context = relevantChunks.map(chunk => chunk.content).join('\n\n');
    
    const prompt = `Based on the following context from uploaded documents, please answer the question. If the context doesn't contain enough information to answer the question, please say so.

Context:
${context}

Question: ${question}

Answer:`;
    
    // Generate response using Gemini
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
    
  } catch (error) {
    console.error('Error generating answer:', error);
    throw error;
  }
}

async function initializeElasticsearch(esClient) {
  try {
    const indexExists = await esClient.indices.exists({ index: 'documents' });
    
    if (!indexExists.body) {
      await esClient.indices.create({
        index: 'documents',
        body: {
          mappings: {
            properties: {
              content: { type: 'text' },
              embedding: { 
                type: 'dense_vector', 
                dims: 384 // Dimension for all-MiniLM-L6-v2 model
              },
              filename: { 
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              chunk_id: { type: 'integer' },
              timestamp: { type: 'date' }
            }
          }
        }
      });
      console.log('Created Elasticsearch index: documents');
    } else {
      console.log('Elasticsearch index already exists');
    }
  } catch (error) {
    console.error('Error initializing Elasticsearch:', error);
  }
}

module.exports = {
  getEmbeddings,
  chunkText,
  indexDocument,
  searchSimilarChunks,
  parsePdfFile,
  generateGeminiResponse,
  initializeElasticsearch
};
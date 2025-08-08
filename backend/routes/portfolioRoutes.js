const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Import helper functions
const {
  parsePortfolioCSV,
  validatePortfolioData,
  calculatePortfolioMetrics,
  generateInvestmentAdvice,
  analyzePortfolioRisk,
  getMarketTrends,
  indexPortfolio
} = require('../controllers/portfolioController');

// Multer configuration for CSV files
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = "portfolioUploads";
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const splittedFileName = file.originalname.split(".");
      const fileExtension = splittedFileName[splittedFileName.length - 1];
      const fileName = `portfolio_${Date.now()}.${fileExtension}`;
      cb(null, fileName);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Export router function
module.exports = (esClient, model) => {
  const router = express.Router();

  // Upload and analyze portfolio
  router.post('/upload-portfolio', upload.single('portfolio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No CSV file uploaded' });
      }

      console.log('Processing portfolio CSV:', req.file.filename);
      
      // Parse CSV file
      const portfolioData = await parsePortfolioCSV(req.file.path);
      console.log(1)
      console.log('Portfolio parsed, records:', portfolioData.length);
      
      // Validate data
      const validationErrors = validatePortfolioData(portfolioData);
      if (validationErrors.length > 0) {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ 
          error: 'Invalid portfolio data', 
          details: validationErrors 
        });
      }
      console.log(2)

      
      // Calculate portfolio metrics
      const portfolioMetrics = calculatePortfolioMetrics(portfolioData);
      console.log(3)

      
      // Analyze risk
      const riskAnalysis = analyzePortfolioRisk(portfolioMetrics.portfolio);
      console.log(4)

      
      // Get market trends
      const marketTrends = await getMarketTrends();
      console.log(5)
      
      // Generate AI investment advice
      const investmentAdvice = await generateInvestmentAdvice(
        portfolioMetrics.summary, 
        marketTrends, 
        model
      );
      console.log(6)

      
      // Store in Elasticsearch (using filename as userId for now)
      const userId = req.user?.id || 'anonymous';
      await indexPortfolio(portfolioMetrics, req.file.filename, userId, esClient);
      console.log(7)
      
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      
      res.json({
        message: 'Portfolio analyzed successfully',
        filename: req.file.filename,
        portfolio: {
          holdings: portfolioMetrics.portfolio,
          summary: portfolioMetrics.summary,
          riskAnalysis: riskAnalysis,
          advice: investmentAdvice,
          marketContext: marketTrends
        }
      });
      
    } catch (error) {
      console.error('Error processing portfolio:', error);
      
      // Clean up file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      res.status(500).json({ 
        error: 'Failed to process portfolio: ' + error.message 
      });
    }
  });

  // Get portfolio analysis by ID
  router.get('/portfolio/:portfolioId', async (req, res) => {
    try {
      const { portfolioId } = req.params;
      
      const searchResponse = await esClient.get({
        index: 'portfolios',
        id: portfolioId
      });
      
      if (!searchResponse.body.found) {
        return res.status(404).json({ error: 'Portfolio not found' });
      }
      
      res.json({
        portfolio: searchResponse.body._source
      });
      
    } catch (error) {
      console.error('Error fetching portfolio:', error);
      res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
  });

  // Get all portfolios for a user
  router.get('/portfolios', async (req, res) => {
    try {
      const userId = req.user?.id || 'anonymous';
      
      const searchResponse = await esClient.search({
        index: 'portfolios',
        body: {
          query: {
            term: { userId: userId }
          },
          sort: [
            { uploadDate: { order: 'desc' } }
          ],
          size: 50
        }
      });
      
      const portfolios = searchResponse.body.hits.hits.map(hit => ({
        id: hit._id,
        ...hit._source,
        uploadDate: new Date(hit._source.uploadDate).toLocaleDateString()
      }));
      
      res.json({ portfolios });
      
    } catch (error) {
      console.error('Error fetching portfolios:', error);
      res.status(500).json({ error: 'Failed to fetch portfolios' });
    }
  });

  // Get investment advice for existing portfolio
  router.post('/portfolio/:portfolioId/advice', async (req, res) => {
    try {
      const { portfolioId } = req.params;
      const { specificQuestion } = req.body;
      
      // Fetch portfolio data
      const searchResponse = await esClient.get({
        index: 'portfolios',
        id: portfolioId
      });
      
      if (!searchResponse.body.found) {
        return res.status(404).json({ error: 'Portfolio not found' });
      }
      
      const portfolioData = searchResponse.body._source;
      const marketTrends = await getMarketTrends();
      
      let prompt = `Based on this portfolio data, please provide investment advice:

Portfolio Summary:
- Total Investment: $${portfolioData.summary.totalInvestment}
- Current Value: $${portfolioData.summary.totalValue}
- Total Gain/Loss: $${portfolioData.summary.totalGainLoss} (${portfolioData.summary.totalGainLossPercent}%)

Asset Allocation:
${Object.entries(portfolioData.summary.assetAllocation).map(([asset, percent]) => `- ${asset}: ${percent}%`).join('\n')}

Market Context:
${marketTrends}`;

      if (specificQuestion) {
        prompt += `\n\nSpecific Question: ${specificQuestion}`;
      }
      
      const advice = await generateInvestmentAdvice(
        portfolioData.summary, 
        marketTrends, 
        model
      );
      
      res.json({
        advice: advice,
        marketContext: marketTrends,
        portfolioSummary: portfolioData.summary
      });
      
    } catch (error) {
      console.error('Error generating advice:', error);
      res.status(500).json({ error: 'Failed to generate advice' });
    }
  });

  // Compare two portfolios
  router.post('/compare-portfolios', async (req, res) => {
    try {
      const { portfolio1Id, portfolio2Id } = req.body;
      
      if (!portfolio1Id || !portfolio2Id) {
        return res.status(400).json({ error: 'Both portfolio IDs are required' });
      }
      
      // Fetch both portfolios
      const [portfolio1Response, portfolio2Response] = await Promise.all([
        esClient.get({ index: 'portfolios', id: portfolio1Id }),
        esClient.get({ index: 'portfolios', id: portfolio2Id })
      ]);
      
      if (!portfolio1Response.body.found || !portfolio2Response.body.found) {
        return res.status(404).json({ error: 'One or both portfolios not found' });
      }
      
      const portfolio1 = portfolio1Response.body._source;
      const portfolio2 = portfolio2Response.body._source;
      
      // Generate comparison analysis
      const comparisonPrompt = `Compare these two investment portfolios and provide insights:

Portfolio 1:
- Total Value: $${portfolio1.summary.totalValue}
- Total Gain/Loss: ${portfolio1.summary.totalGainLossPercent}%
- Asset Allocation: ${JSON.stringify(portfolio1.summary.assetAllocation)}

Portfolio 2:
- Total Value: $${portfolio2.summary.totalValue}
- Total Gain/Loss: ${portfolio2.summary.totalGainLossPercent}%
- Asset Allocation: ${JSON.stringify(portfolio2.summary.assetAllocation)}

Provide:
1. Performance comparison
2. Risk comparison
3. Diversification analysis
4. Recommendations for improvement`;
      
      const result = await model.generateContent(comparisonPrompt);
      const comparison = await result.response;
      
      res.json({
        comparison: comparison.text(),
        portfolio1Summary: portfolio1.summary,
        portfolio2Summary: portfolio2.summary
      });
      
    } catch (error) {
      console.error('Error comparing portfolios:', error);
      res.status(500).json({ error: 'Failed to compare portfolios' });
    }
  });

  // Delete a portfolio
  router.delete('/portfolio/:portfolioId', async (req, res) => {
    try {
      const { portfolioId } = req.params;
      
      await esClient.delete({
        index: 'portfolios',
        id: portfolioId
      });
      
      res.json({ message: 'Portfolio deleted successfully' });
      
    } catch (error) {
      console.error('Error deleting portfolio:', error);
      res.status(500).json({ error: 'Failed to delete portfolio' });
    }
  });

  // Get portfolio analytics dashboard data
  router.get('/analytics/dashboard', async (req, res) => {
    try {
      const userId = req.user?.id || 'anonymous';
      
      const searchResponse = await esClient.search({
        index: 'portfolios',
        body: {
          query: {
            term: { userId: userId }
          },
          aggs: {
            total_value: {
              sum: {
                field: 'summary.totalValue'
              }
            },
            total_investment: {
              sum: {
                field: 'summary.totalInvestment'
              }
            },
            avg_return: {
              avg: {
                field: 'summary.totalGainLossPercent'
              }
            },
            portfolio_count: {
              value_count: {
                field: 'userId'
              }
            }
          },
          size: 0
        }
      });
      
      const aggregations = searchResponse.body.aggregations;
      
      res.json({
        dashboard: {
          totalPortfolios: aggregations.portfolio_count.value,
          totalValue: Math.round(aggregations.total_value.value || 0),
          totalInvestment: Math.round(aggregations.total_investment.value || 0),
          averageReturn: Math.round((aggregations.avg_return.value || 0) * 100) / 100,
          totalGainLoss: Math.round((aggregations.total_value.value || 0) - (aggregations.total_investment.value || 0))
        }
      });
      
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
  });

  return router;
};
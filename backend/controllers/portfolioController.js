const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const { type } = require('os');
const { isFloat64Array } = require('util/types');
const { parse } = require('path');

// Function to parse portfolio CSV file
async function parsePortfolioCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {

        const normalizedData = {};
        Object.keys(data).forEach(key => {
          const normalizedKey = key.toLowerCase().trim().replace(/\s+/g, '_');
          normalizedData[normalizedKey] = data[key];
        });
        results.push(normalizedData);
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// Function to validate portfolio data
function validatePortfolioData(portfolioData) {
  const requiredFields = ['symbol', 'quantity', 'purchase_price'];
  const errors = [];

  portfolioData.forEach((row, index) => {
    requiredFields.forEach(field => {
      if (!row[field] || row[field] === '') {
        errors.push(`Row ${index + 1}: Missing ${field}`);
      }
    });

    // Validate numeric fields
    if (row.quantity && isNaN(parseFloat(row.quantity))) {
      errors.push(`Row ${index + 1}: Quantity must be a number`);
    }

    if (row.purchase_price && isNaN(parseFloat(row.purchase_price))) {
      errors.push(`Row ${index + 1}: Purchase price must be a number`);
    }
  });

  return errors;
}

// Function to calculate portfolio metrics
function calculatePortfolioMetrics(portfolioData, marketData = {}) {
  let totalValue = 0;
  let totalInvestment = 0;
  const assetAllocation = {};
  const sectorAllocation = {};

  const processedPortfolio = portfolioData.map(holding => {
    const symbol = holding.symbol.toUpperCase();
    const quantity = parseFloat(holding.quantity);
    // const purchasePrice = Number(parseFloat(holding.purchase_price).toFixed(6));
    const purchasePrice = parseFloat(holding.purchase_price)
    console.log(checkNumberType(purchasePrice))
    const currentPrice = marketData[symbol]?.price || purchasePrice; // Use market price if available
    const sector = marketData[symbol]?.sector || 'Unknown';
    const assetType = holding.asset_type || 'Stock';

    const investment = quantity * purchasePrice;
    const currentValue = quantity * currentPrice;
    const gainLoss = currentValue - investment;
    const gainLossPercent = (gainLoss / investment) * 100;

    totalInvestment += investment;
    totalValue += currentValue;

    // Asset allocation
    assetAllocation[assetType] = (assetAllocation[assetType] || 0) + currentValue;

    // Sector allocation
    sectorAllocation[sector] = (sectorAllocation[sector] || 0) + currentValue;

    return {
      ...holding,
      symbol,
      quantity,
      purchasePrice,
      currentPrice,
      investment,
      currentValue,
      gainLoss,
      gainLossPercent: parseFloat(gainLossPercent.toFixed(2)),
      sector,
      assetType
    };
  });

  const totalGainLoss = totalValue - totalInvestment;
  const totalGainLossPercent = (totalGainLoss / totalInvestment) * 100;

  // Convert allocations to percentages
  Object.keys(assetAllocation).forEach(key => {
    assetAllocation[key] = parseFloat(((assetAllocation[key] / totalValue) * 100).toFixed(2));
  });

  Object.keys(sectorAllocation).forEach(key => {
    sectorAllocation[key] = parseFloat(((sectorAllocation[key] / totalValue) * 100).toFixed(2));
  });

  return {
    portfolio: processedPortfolio,
    summary: {
      totalInvestment: parseFloat(totalInvestment.toFixed(2)),
      totalValue: parseFloat(totalValue.toFixed(2)),
      totalGainLoss: parseFloat(totalGainLoss.toFixed(2)),
      totalGainLossPercent: parseFloat(totalGainLossPercent.toFixed(2)),
      assetAllocation,
      sectorAllocation
    }
  };
}

// Function to generate investment advice using AI
async function generateInvestmentAdvice(portfolioSummary, marketTrends, model) {
  try {
    const prompt = `As a personal investment coach, analyze this portfolio and provide advice:

Portfolio Summary:
- Total Investment: $${portfolioSummary.totalInvestment}
- Current Value: $${portfolioSummary.totalValue}
- Total Gain/Loss: $${portfolioSummary.totalGainLoss} (${portfolioSummary.totalGainLossPercent}%)

Asset Allocation:
${Object.entries(portfolioSummary.assetAllocation).map(([asset, percent]) => `- ${asset}: ${percent}%`).join('\n')}

Sector Allocation:
${Object.entries(portfolioSummary.sectorAllocation).map(([sector, percent]) => `- ${sector}: ${percent}%`).join('\n')}

Market Context:
${marketTrends}

Please provide:
1. Portfolio Risk Assessment (Low/Medium/High risk level)
2. Diversification Analysis
3. Specific recommendations for rebalancing
4. Suggestions for reducing risk or improving returns
5. Any immediate actions the investor should consider

Keep the advice practical and easy to understand.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();

  } catch (error) {
    console.error('Error generating investment advice:', error);
    throw error;
  }
}

// Function to analyze portfolio risk
function analyzePortfolioRisk(portfolioData) {
  const riskFactors = {
    concentration: 0,
    volatility: 0,
    diversification: 0
  };

  // Concentration risk - check if any single holding is > 20% of portfolio
  const totalValue = portfolioData.reduce((sum, holding) => sum + holding.currentValue, 0);
  const maxHolding = Math.max(...portfolioData.map(holding => holding.currentValue));
  const concentrationRatio = (maxHolding / totalValue) * 100;

  if (concentrationRatio > 20) {
    riskFactors.concentration = 'High - Single holding exceeds 20% of portfolio';
  } else if (concentrationRatio > 10) {
    riskFactors.concentration = 'Medium - Largest holding is ' + concentrationRatio.toFixed(1) + '%';
  } else {
    riskFactors.concentration = 'Low - Well distributed holdings';
  }

  // Diversification score based on number of holdings and sectors
  const uniqueSectors = [...new Set(portfolioData.map(holding => holding.sector))].length;
  const totalHoldings = portfolioData.length;

  if (totalHoldings < 5 || uniqueSectors < 3) {
    riskFactors.diversification = 'Low - Consider adding more holdings across different sectors';
  } else if (totalHoldings < 10 || uniqueSectors < 5) {
    riskFactors.diversification = 'Medium - Reasonably diversified';
  } else {
    riskFactors.diversification = 'High - Well diversified portfolio';
  }

  return riskFactors;
}

// Function to get market trends (placeholder for now)
async function getMarketTrends() {
  // This would typically fetch from financial APIs
  // For now, return a placeholder
  return `Current market conditions:
- Market volatility is moderate
- Technology sector showing mixed signals
- Financial sector performing well
- Inflation concerns affecting bond markets
- Energy sector experiencing volatility due to geopolitical factors`;
}

function checkNumberType(num) {
  if (typeof num === 'bigint') {
    return 'BigInt (long)';
  } else if (typeof num === 'number') {
    if (Number.isInteger(num)) {
      return 'Integer';
    } else if (!Number.isNaN(num)) {
      return 'Float';
    }
  }
  return 'Not a number';
}

// Function to store portfolio data in Elasticsearch
async function indexPortfolio(portfolioData, filename, userId, esClient) {
  try {
    const portfolioDoc = {
      userId: userId,
      filename: filename,
      portfolio: portfolioData.portfolio,
      summary: portfolioData.summary,
      uploadDate: new Date(),
      type: 'portfolio'
    };
    const num = portfolioData.portfolio[0].purchasePrice;

    // portfolioData.portfolio.forEach((item, idx) => {
    //   console.log(`[DEBUG] purchasePrice[${idx}] =`, checkNumberType(item.purchasePrice));
    // });
    

    await esClient.index({
      index: 'portfolios',
      id: `${userId}_${filename}_${Date.now()}`,
      body: portfolioDoc
    });

    await esClient.indices.refresh({ index: 'portfolios' });
    console.log(`Indexed portfolio for user ${userId}`);

  } catch (error) {
    console.error('Error indexing portfolio:', error);
    throw error;
  }
}

// Function to initialize Elasticsearch index for portfolios
async function initializePortfolioIndex(esClient) {
  try {
    const indexExists = await esClient.indices.exists({ index: 'portfolios' });

    if (!indexExists.body) {
      await esClient.indices.create({
        index: 'portfolios',
        body: {
          mappings: {
            properties: {
              userId: { type: 'keyword' },
              filename: { type: 'text' },
              portfolio: {
                type: 'nested',
                properties: {
                  symbol: { type: 'keyword' },
                  quantity: { type: 'float' },
                  purchasePrice: { type: 'float' },
                  currentPrice: { type: 'float' },
                  currentValue: { type: 'float' },
                  gainLoss: { type: 'float' },
                  gainLossPercent: { type: 'float' },
                  sector: { type: 'keyword' },
                  assetType: { type: 'keyword' }
                }
              },
              summary: {
                properties: {
                  totalInvestment: { type: 'float' },
                  totalValue: { type: 'float' },
                  totalGainLoss: { type: 'float' },
                  totalGainLossPercent: { type: 'float' },
                  assetAllocation: { type: 'object' },
                  sectorAllocation: { type: 'object' }
                }
              },
              uploadDate: { type: 'date' },
              type: { type: 'keyword' }
            }
          }
        }
      });
      console.log('Created Elasticsearch index: portfolios');
    }
  } catch (error) {
    console.error('Error initializing portfolio index:', error);
    throw error;
  }
}

module.exports = {
  parsePortfolioCSV,
  validatePortfolioData,
  calculatePortfolioMetrics,
  generateInvestmentAdvice,
  analyzePortfolioRisk,
  getMarketTrends,
  indexPortfolio,
  initializePortfolioIndex
};
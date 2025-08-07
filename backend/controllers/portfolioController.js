const fs = require('fs');
const csv = require('csv-parser');
const {createObjectCsvWriter} = require('csv-writer');
const { resolve } = require('path');

async function parsePortfolioCSV(filePath) {
    return new Promise((resolve, reject)=>{
        const results =[];

        fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data)=>{
            const normalizedData = {};
            Object.keys(data).forEach(key => {
                const normalizedKey = key.toLowerCase().trim().replace(/\s+/g,'_');
                normalizedData[normalizedKey] = data[key];
            });

            results.push(normalizedData);
        })
        .on('end', ()=>{
            resolve(results);
        })
        .on('error', (error)=>{
            reject(error);
        });
    });
}

function validatePortfolioData(portfolioData){
    const requiredFields = ['symbol', 'quantity', 'purchase_price'];
    const errors = [];

    portfolioData.forEach((row, index)=>{
        requiredFields.forEach(field=>{
            if(!row[field] || row[field] === ''){
                errors.push(`Row ${index + 1}: Missing ${field}`);
            }
        });

        if(row.quantity && isNaN(parseFloat(row.quantity))){
            errors.push(`Row ${index+1}: Purchase price must be a number`);
        }
    });

    return errors;
}


function calculatePortFolioMetrics(portfolioData, marketData = {}){
    let totalValue = 0;
    let totalInvestment = 0;
    const assetAllocation = {};
    const sectorAllocation = {};


    const processesPortfolio = portfolioData.map(holding => {
        const symbol = holding.symbol.toUppperCase();
        const quantity = parseFloat(holding.quantity);
        const purchasePrice = parseFloat(holding.purchasePrice);
        const currentPrice = marketData[symbol]?.price || purchasePrice;
        const sector = marketData[symbol]?.sector || 'Unknown';
        const assetType = holding.asses_type || 'Stock';

        const investment = quantity * purchasePrice;
        const currentValue = quantity * currentPrice;
        const gainLoss = currentValue - investment;
        const gainLossPercent = (gainLoss / investment) * 100;


        totalInvestment += investment;
        totalValue += currentValue;

        assetAllocation[assetType] = (assetAllocation[assetType] || 0) + currentValue;

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
    const totalGainPercent = (totalGainLoss / totalInvest)* 100;

    Object.keys(assetAllocation).forEach(key=>{
        assetAllocation[key] = parseFloat(((assetAllocation[key] / totalValue) * 100).toFixed(2));
    });

    Object.keys(sectorAllocation).forEach(key =>{
        sectorAllocation[key] = parseFloat(((sectorAllocation[key] / totalValue) * 100).toFixed(2));
    });

    return{
        portfolio: processesPortfolio,
        summary:{
            totalInvestment: parseFloat(totalInvestment.toFixed(2)),
            totalValue: parseFloat(totalValue.toFixed(2)),
            totalGainLoss: parseFloat(totalGainLoss.toFixed(2)),
            assetAllocation,
            sectorAllocation
        }
    };
}


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
        console.error('Error generating investment advice :', error);
        throw error;
    }
}


function analyzePortfolioRisk(portfolioData){
    
}

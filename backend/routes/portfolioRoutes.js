const express = require('express');
const multer = require('multer');
const fs = require('fs');


const uploadPort = multer({
    storage: multer.diskStorage({
        destination:(req, file, cb)=>{
           const uploadDir = "portfolioUploads";
           if(!fs.existsSync(uploadDir)){
            fs.mkdirSync(uploadDir, {recursive: true});
           }
           cb(null, uploadDir);
        },
        filename:(req, file, cb) =>{
            const splittedFileName = file.originalname.split(".");
            const fileExtension = splittedFileName[splittedFileName.length-1];
            const filename = `portfolio_${Date.now()}.${fileExtension}`;
            cb(null, filename);
        },
    }),

    fileFilter: (req, file, cb) =>{
        const allowedMimeTypes = [
            'text/csv',
            // 'application/vnd.ms-excel',
            // 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            // 'application/pdf'
        ];
        if(allowedMimeTypes.includes(file.mimetype)){
            cb(null, true);
        }else {
            cb(new Error('Only CSV files are allowed '), false);
        }
    },
    limits:{
        fileSize: 5 * 1024 * 1024
    }
});

module.exports = (esClient, model) =>{
    const router = express.Router();

    router.post('/upload-portfolio', uploadPort.single('file'), async(req, res)=>{
        try {
            if(!req.file){
                return res.status(400).json({error:'No portfolio file uploded'});
            }

            console.log("Uploaded file : ", req.file.filename);

            const portfolioData = await parsePortfolioCSV(req.file.path);
            console.log('Portfolio parser, records: ', portfolioData.length);

            const validationErrors = validatePortfolioData(portfolioData);

            if(validationErrors > 0){
                fs.unlinkSync(req.file.path);

                return res.status(400).json({
                    error: "Invalid portfolio data",
                    details: validationErrors
                });
            }

            const portfolioMetrics = calculatePortFolioMetrics(portfolioData);
            const riskAnalysis = analyzePortfolioRisk(portfolioMetrics.portfolio);
            const marketTrends = await getMarketTrends();

            const investmentAdvice = await generateInvestmentAdvice(
                portfolioMetrics.summary,
                marketTrends, 
                model
            );

            const userId = req.user?.id || 'anonymous';

            await indexPortfolio(portfolioMetrics, req.file.filename, userId, esClient);

            fs.unlinkSync(req.file.path);

            res.json({
                message: 'Portfolio analyzed successfully',
                filename: req.file.fieldname,
                portfolio:{
                    holdings: portfolioMetrics.portfolio,
                    summary: portfolioMetrics.summary,
                    riskAnalysis: riskAnalysis,
                    advice: investmentAdvice,
                    marketContext: marketTrends
                }
            });
        } catch (error) {
            console.log("Error processing portfolio:", error);

            if(req.file && fs.existsSync(req.file.path)){
                fs.unlinkSync(req.file.path);
            }

            res.status(500).json({
                error: "Failed to process portflio: " + error.message
            });
        }
    });
    

    router.get('/portfolio/:portfolioId', async(req, req)=>{
        try {
            const {portfolioId} = req.params;

            const searchResponse = await esClient.get({
                index: 'portfolios',
                id: portfolioId
            });

            if(!searchResponse.body.found){
                return res.status(404).json({error: 'Portfolio not found'});
            }

            res.json({
                portfolio: searchResponse.body._source
            });
            
        } catch (error) {
            console.error('Error fetching portfolio:', error);
        }
    })
}






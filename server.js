// --- server.js (המוח של LANZA BULLS) ---
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

// קריאת המפתחות הסודיים ממשתני הסביבה (נגדיר אותם ב-Render)
const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

// --- נקודה 1: נתונים לדף הבית ---
app.get('/market-movers', async (req, res) => {
    if (!ALPHA_VANTAGE_KEY) {
         return res.status(500).json({ error: 'Alpha Vantage API Key not configured' });
    }
    try {
        const url = `https://www.alphavantage.co/query?function=TOP_GAINERS_LOSERS&apikey=${ALPHA_VANTAGE_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        const marketData = {
            topGainers: data.top_gainers ? data.top_gainers.slice(0, 20) : [],
            mostActive: data.most_actively_traded ? data.most_actively_traded.slice(0, 20) : [],
        };
        res.json(marketData);

    } catch (error) {
        console.error("Error fetching market movers:", error);
        res.status(500).json({ error: 'Failed to fetch market movers' });
    }
});

// --- נקודה 2: נתונים עבור מניה ספציפית ---
app.get('/stock-data', async (req, res) => {
    const symbol = req.query.symbol;
    if (!symbol) {
        return res.status(400).json({ error: 'חסר סימול מניה' });
    }

    if (!ALPHA_VANTAGE_KEY || !FINNHUB_KEY) {
        return res.status(500).json({ error: 'שגיאת תצורה בשרת: מפתחות API חסרים' });
    }

    try {
        // הכנת כל הבקשות ל-API במקביל
        const requests = [
            fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`), // Includes additional metrics
            fetch(`https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`),
            fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`), // Includes sentiment
            fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`),
            fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${FINNHUB_KEY}`),
            fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${Math.floor((Date.now() / 1000) - 31536000)}&to=${Math.floor(Date.now() / 1000)}&token=${FINNHUB_KEY}`)
        ];

        const responses = await Promise.all(requests);

        const [
            overviewRes,
            incomeRes,
            newsRes,
            quoteRes,
            recommendationRes,
            candleRes
        ] = await Promise.all(responses.map(r => r.json()));

        // חישוב סנטימנט ממוצע מהחדשות (אם זמין)
        let avgSentiment = null;
        if (newsRes.feed && newsRes.feed.length > 0) {
             const sentiments = newsRes.feed.map(item => item.overall_sentiment_score || 0);
             const sum = sentiments.reduce((a, b) => a + b, 0);
             avgSentiment = (sum / sentiments.length).toFixed(2);
        }

        // בדיקת "Unusual Volume"
        const currentVolume = quoteRes.v;
        const isUnusualVolume = currentVolume > 10000000; // לוגיקה בסיסית

        // איחוד כל המידע לחבילה אחת (כולל הנתונים החדשים מ-OVERVIEW)
        const combinedData = {
            overview: overviewRes, // מכיל גם Beta, EPS, ForwardPE, P/S, 52 Week High/Low, MA50, MA200
            incomeStatement: incomeRes.quarterlyReports ? incomeRes.quarterlyReports[0] : {},
            news: newsRes.feed || [],
            avgNewsSentiment: avgSentiment, // סנטימנט חדשות ממוצע
            quote: quoteRes,
            recommendations: recommendationRes[0] || {},
            chartData: candleRes,
            flags: {
                isUnusualVolume: isUnusualVolume,
            }
        };

        res.json(combinedData);

    } catch (error) {
        console.error("Error fetching stock data:", error);
        res.status(500).json({ error: 'Failed to fetch stock data' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`שרת LANZA BULLS מאזין בפורט ${PORT}`);
});
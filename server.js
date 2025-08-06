const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const moment = require('moment');
const path = require('path');
const ngrok = require('@ngrok/ngrok');

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files from the current directory

// Load environment variables
require('dotenv').config();

// M-Pesa credentials from environment variables
const consumerKey = process.env.MPESA_CONSUMER_KEY;
const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
const shortcode = process.env.MPESA_SHORTCODE;
const passkey = process.env.MPESA_PASSKEY;
const callbackURL = process.env.MPESA_CALLBACK_URL;

// Generate access token
async function getAccessToken() {
  try {
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const response = await axios.get(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting access token:', error.response?.data || error.message);
    throw error;
  }
}

// Serve the HTML form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle payment request
app.post('/pay', async (req, res) => {
  const { phone, amount } = req.body;
  
  // Basic validation
  if (!phone || !amount) {
    return res.status(400).send('Phone number and amount are required');
  }

  const timestamp = moment().format('YYYYMMDDHHmmss');
  const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');

  try {
    const token = await getAccessToken();

    const stkResponse = await axios.post(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackURL,
        AccountReference: 'WebForm',
        TransactionDesc: 'Payment via Web Form',
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('STK Push Response:', stkResponse.data);
    res.send(`
      <div style="text-align: center; margin-top: 50px;">
        <h2>Payment Request Sent!</h2>
        <p>${stkResponse.data.CustomerMessage}</p>
        <p>Check your phone to complete the payment.</p>
        <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">Back to Payment</a>
      </div>
    `);
  } catch (error) {
    console.error('STK Push Error:', error.response?.data || error.message);
    res.status(500).send(`
      <div style="text-align: center; margin-top: 50px;">
        <h2 style="color: red;">Error Processing Payment</h2>
        <p>${error.response?.data?.errorMessage || error.message}</p>
        <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">Try Again</a>
      </div>
    `);
  }
});

// Callback endpoint for M-Pesa
app.post('/callback', (req, res) => {
  console.log('Callback received:', req.body);
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
});

const PORT = process.env.PORT || 3000;

// Start the server and ngrok tunnel
const server = app.listen(PORT, async () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  
  try {
    // Create ngrok tunnel
    const listener = await ngrok.connect({
      addr: PORT,
      authtoken: process.env.NGROK_AUTHTOKEN,
      domain: 'your-domain.ngrok.io' // Optional: If you have a custom domain
    });
    
    console.log('ngrok tunnel created at:', listener.url());
    console.log('Update your M-Pesa callback URL with:', `${listener.url()}/callback`);
  } catch (err) {
    console.error('Error creating ngrok tunnel:', err);
    process.exit(1);
  }
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down server and ngrok tunnel...');
  ngrok.kill().then(() => process.exit(0));
});

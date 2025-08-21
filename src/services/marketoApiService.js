const axios = require('axios');
require('dotenv').config();

const MARKETO_API_BASE_URL = process.env.MARKETO_API_BASE_URL; // e.g. https://XXX-XXX-XXX.mktorest.com
let currentAccessToken = null;
let tokenExpirationTime = 0;

async function getMarketoAccessToken() {
    const tokenEndpoint = `${MARKETO_API_BASE_URL}/identity/oauth/token`;
    const params = {
        grant_type: 'client_credentials',
        client_id: process.env.MARKETO_CLIENT_ID,
        client_secret: process.env.MARKETO_CLIENT_SECRET
    };

    const response = await axios.get(tokenEndpoint, { params });

    // expires_in is in seconds; refresh 1 minute early
    if (response.data && response.data.expires_in && response.data.access_token) {
        tokenExpirationTime = Date.now() + (response.data.expires_in * 1000) - 60000;
        currentAccessToken = response.data.access_token;
        return currentAccessToken;
    }

    throw new Error('Failed to obtain Marketo access token: invalid response');
}

async function getValidMarketoAccessToken(forceRefresh = false) {
    if (!currentAccessToken || Date.now() > tokenExpirationTime || forceRefresh) {
        return await getMarketoAccessToken();
    }
    return currentAccessToken;
}

async function marketoApiRequest(config) {
    let token = await getValidMarketoAccessToken();
    config.headers = config.headers || {};
    config.headers['Authorization'] = `Bearer ${token}`;
    config.baseURL = MARKETO_API_BASE_URL;

    try {
        return await axios(config);
    } catch (error) {
        if (error.response && error.response.status === 401) {
            token = await getValidMarketoAccessToken(true);
            config.headers['Authorization'] = `Bearer ${token}`;
            return await axios(config);
        }
        throw error;
    }
}

module.exports = {
    marketoApiRequest,
    getValidMarketoAccessToken,
    getMarketoAccessToken,
    MARKETO_API_BASE_URL
}; 
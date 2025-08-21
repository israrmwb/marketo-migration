const axios = require('axios');
require('dotenv').config();

// Example: https://yourorg.api.crm.dynamics.com/api/data/v9.2
const DYNAMICS_API_BASE_URL = process.env.DYNAMICS_API_BASE_URL;
let currentAccessToken = null;
let tokenExpirationTime = 0;

async function getDynamicsAccessToken() {
    const tokenEndpoint = `https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.DYNAMICS_CLIENT_ID,
        client_secret: process.env.DYNAMICS_CLIENT_SECRET,
        scope: `${DYNAMICS_API_BASE_URL}/.default`
    });
    const response = await axios.post(tokenEndpoint, params);
    // expires_in is in seconds
    tokenExpirationTime = Date.now() + (response.data.expires_in * 1000) - 60000; // 1 min early
    currentAccessToken = response.data.access_token;
    return currentAccessToken;
}

async function getValidAccessToken(forceRefresh = false) {
    if (!currentAccessToken || Date.now() > tokenExpirationTime || forceRefresh) {
        return await getDynamicsAccessToken();
    }
    return currentAccessToken;
}

async function dynamicsApiRequest(config) {
    let token = await getValidAccessToken();
    config.headers = config.headers || {};
    config.headers['Authorization'] = `Bearer ${token}`;
    config.baseURL = DYNAMICS_API_BASE_URL;
    try {
        return await axios(config);
    } catch (error) {
        if (error.response && error.response.status === 401) {
            token = await getValidAccessToken(true);
            config.headers['Authorization'] = `Bearer ${token}`;
            return await axios(config);
        }
        throw error;
    }
}

module.exports = {
    dynamicsApiRequest,
    getValidAccessToken,
    getDynamicsAccessToken,
    // fetchDynamicsModuleFields, // Uncomment and implement as needed
    DYNAMICS_API_BASE_URL
}; 
// apiClients.js
const axios = require('axios');
require('dotenv').config();

// --- Marketo API Client ---
let marketoTokenCache = { token: null, expires: 0 };
const getMarketoAccessToken = async () => {
    if (marketoTokenCache.token && Date.now() < marketoTokenCache.expires) {
        return marketoTokenCache.token;
    }
    const identityUrl = `${process.env.MARKETO_BASE_URL}/identity/oauth/token`;
    const params = {
        grant_type: 'client_credentials',
        client_id: process.env.MARKETO_CLIENT_ID,
        client_secret: process.env.MARKETO_CLIENT_SECRET,
    };
    const response = await axios.get(identityUrl, { params });
    const { access_token, expires_in } = response.data;
    marketoTokenCache = {
        token: access_token,
        expires: Date.now() + (expires_in - 60) * 1000,
    };
    return access_token;
};

const marketoApi = axios.create({
    baseURL: `${process.env.MARKETO_BASE_URL}/rest/asset/v1`,
});

marketoApi.interceptors.request.use(async (config) => {
    config.headers.Authorization = `Bearer ${await getMarketoAccessToken()}`;
    return config;
}, (error) => Promise.reject(error));


// --- HubSpot API Client ---
const hubspotApi = axios.create({
    baseURL: 'https://api.hubapi.com/files/v3',
    headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    },
});

module.exports = { marketoApi, hubspotApi };
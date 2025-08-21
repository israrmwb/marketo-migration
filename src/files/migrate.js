// migrate.js
const { marketoApi, hubspotApi } = require('./apiClients');
const FormData = require('form-data');
const axios = require('axios');

// Simple delay to respect API rate limits
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// HubSpot: Finds a folder by name within a parent folder, or creates it if it doesn't exist.
const findOrCreateHubspotFolder = async (folderName, parentFolderId) => {
    try {
        // Search for an existing folder
        const searchParams = { name: folderName };
        if (parentFolderId) {
            searchParams.parentFolderId = parentFolderId;
        }
        const searchRes = await hubspotApi.get('/folders', { params: searchParams });
        if (searchRes.data.results.length > 0) {
            console.log(`   [HS] Found existing folder: "${folderName}" (ID: ${searchRes.data.results[0].id})`);
            return searchRes.data.results[0].id;
        }

        // If not found, create it
        console.log(`   [HS] Creating new folder: "${folderName}"...`);
        const createPayload = { name: folderName };
        if (parentFolderId) {
            createPayload.parentFolderId = parentFolderId;
        }
        const createRes = await hubspotApi.post('/folders', createPayload);
        console.log(`   [HS] Created folder successfully (ID: ${createRes.data.id})`);
        return createRes.data.id;
    } catch (error) {
        console.error(`Error finding/creating HubSpot folder "${folderName}":`, error.response?.data || error.message);
        throw error;
    }
};


// Main recursive function to process Marketo folders
async function processMarketoFolder(marketoFolderId, hubspotParentFolderId) {
    console.log(`\nProcessing Marketo Folder ID: ${marketoFolderId}...`);

    // 1. Get current Marketo folder's sub-folders
    const { data: { result: subFolders = [] } } = await marketoApi.get(`/folder/${marketoFolderId}/folders.json`);

    // 2. Get files in the current Marketo folder
    const { data: { result: files = [] } } = await marketoApi.get(`/folder/${marketoFolderId}/files.json`);
    console.log(`   [MK] Found ${files.length} files and ${subFolders.length} sub-folders.`);

    // 3. Process files in the current folder
    for (const file of files) {
        await delay(250); // Rate limit delay
        try {
            // Check if file already exists in HubSpot to prevent duplicates
            const searchRes = await hubspotApi.get('/files', {
                params: { name: file.name, parentFolderId: hubspotParentFolderId }
            });

            if (searchRes.data.results.length > 0) {
                console.log(`   -> Skipping file (already exists in HubSpot): "${file.name}"`);
                continue;
            }

            console.log(`   -> Migrating file: "${file.name}"...`);

            // Download file content from Marketo URL
            const fileResponse = await axios.get(file.url, { responseType: 'arraybuffer' });
            const fileBuffer = Buffer.from(fileResponse.data, 'binary');

            // Upload to HubSpot using multipart/form-data
            const form = new FormData();
            form.append('file', fileBuffer, file.name);
            form.append('options', JSON.stringify({
                access: 'PUBLIC_INDEXABLE',
                overwrite: false,
            }));
            if (hubspotParentFolderId) {
              form.append('folderId', hubspotParentFolderId);
            }

            await hubspotApi.post('/files', form, { headers: form.getHeaders() });
            console.log(`   -> SUCCESS: Migrated "${file.name}"`);

        } catch (error) {
            console.error(`   -> FAILED to migrate file "${file.name}":`, error.response?.data || error.message);
        }
    }

    // 4. Recursively process each sub-folder
    for (const subFolder of subFolders) {
        await delay(250); // Rate limit delay
        // First, create the corresponding folder in HubSpot to get its new ID
        const newHubspotParentId = await findOrCreateHubspotFolder(subFolder.name, hubspotParentFolderId);
        // Then, dive into that Marketo sub-folder
        await processMarketoFolder(subFolder.id, newHubspotParentId);
    }
}

module.exports = { processMarketoFolder };
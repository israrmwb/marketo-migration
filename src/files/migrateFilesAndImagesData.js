require('dotenv').config();
const axios = require('axios');
const hubspotService = require('../services/hubspotService');
const logger = require('../utils/logger');
const { connectToMongo } = require('../config/db');
const { marketoApiRequest } = require('../services/marketoApiService');
// const { fetchMarketoFolders } = require('./migrateObjectListData');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100;
const PAGE_DELAY = 100; // ms between pages


async function fetchMarketoFolders(rootFolder = 34) {
    try {
        const params = { root: rootFolder };

        const response = await marketoApiRequest({
            method: 'get',
            url: `/rest/asset/v1/folders.json`,
            params
        });

        const data = response.data.result || [];

        logger.info(`Fetched ${data.length} Folders from Marketo`);

        return { data };
    } catch (error) {
        logger.error('Error fetching Marketo Folders', error);
        throw error;
    }
}


async function getFolderFiles(folder, page = 1) {
    try {
        const offset = (page - 1) * BATCH_SIZE;
        const params = { maxReturn: BATCH_SIZE, offset };
        if (folder) {
            params.folder = folder;
        }
        const response = await marketoApiRequest({
            method: 'get',
            url: `/rest/asset/v1/files.json`,
            params
        });

        const data = response.data.result || [];
        return { data };
    } catch (error) {
        logger.error('Error fetching Marketo files', error);
        throw error;
    }
}

// --- Helpers ---
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Process Program as List ---
async function processFolder(folder) {
    const { name, path, folderId } = folder;
    logger.info(`processing folder:- ${name}, path:- ${path} and id:- ${JSON.stringify(folderId)}`)
    let notFoundCount = 0;
    let pageCount = 0;

    try {
        while (true) {

            pageCount++;
            logger.info(`Processing page ${pageCount} at folder ${name} ...`);
            const marketoFolderId = folderId?.id;
            if (!marketoFolderId) {
                logger.info(`Skipping folder: ${name} as folder id does not exist`);
                return { success: true, notFound: notFoundCount };
            }
            const { data: files } = await getFolderFiles(marketoFolderId, pageCount);

            logger.info(`get ${files.length} files at page:- ${pageCount}`);
            if (!files.length) {
                logger.info(`No more Files exist for folder: ${name}`);
                break;
            }
            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                const newPath = path.replace(/^\/Design Studio\/Default/, "Marketo");
                const filePath = newPath + `/${file.name}`;
                try {
                    logger.info(`Searching file:- ${file.name} at folder:- ${filePath} and folder id:- ${JSON.stringify(folderId)}`);
                    const searchRes = await hubspotService.client.get(`/files/v3/files/stat/${filePath}`);
                    if (searchRes?.data?.file) {
                        logger.info(`   -> Skipping file (already exists in HubSpot): "${file.name}"`);
                        continue;
                    }
                } catch (error) {
                    if (error?.response?.status !== 404) {
                        logger.error(`Error checking file existence for path: ${filePath}`, error.message);
                        continue; // skip this file on unexpected error
                    }
                    try{
                         logger.info(`No file:- ${file.name} found at folder:- ${filePath} and folder id:- ${JSON.stringify(folderId)}`);
                        logger.info(`Downloading path:- ${filePath}, folder:- ${JSON.stringify(folderId)}`);
                        const fileResponse = await axios.get(file.url, { responseType: 'arraybuffer' });
                        const fileBuffer = Buffer.from(fileResponse.data, 'binary');
                        
                        logger.info(`uploading file at :- ${newPath}, folder:- ${JSON.stringify(folderId)}`);
                        await hubspotService.uploadAttachment(fileBuffer, file.name, newPath);
                    }catch(e){
                         logger.error(`Error downloading and uploading file : ${filePath}`, error.message);
                         logger.error(`downloading url:- ${file.url} and folder:- ${JSON.stringify(folderId)}`)
                    }
                   
                }

                await delay(PAGE_DELAY);
            }
            // break;
            await delay(PAGE_DELAY);
        }
        return {
            success: true,
            notFound: notFoundCount,
        };
    } catch (error) {
        logger.error(`Error processing folder: ${name} and id:- ${JSON.stringify(folderId)}`, error.message);
        return { success: false, error: error.message };
    }
}



// --- Migration Loop ---
async function migrateMarketoFiles(folderId=34) {
    let totalMigrated = 0;
    let totalFailed = 0;

    logger.info('Starting Files migration...');

    try {
        const { data: folders } = await fetchMarketoFolders(folderId);

        for (let i = 0; i < folders.length; i++) {
            const folder = folders[i];

            const result = await processFolder(folder);
            if (result.success) {
                totalMigrated++;
            } else {
                totalFailed++;
            }
            logger.info(`Completed Folder total migrated so far: ${totalMigrated}`);
            const nestedFolderId = folder.id;
            if(nestedFolderId && folderId!==nestedFolderId){
                logger.info(`staring nested folder ${folderId}/${nestedFolderId}`)
                await migrateMarketoFiles(nestedFolderId)
            }

            // break;
        }

        logger.success('Migration completed!', {
            totalMigrated,
            totalFailed
        });
    } catch (error) {
        logger.error('Migration failed', { error: error.message, totalMigrated, totalFailed });
        throw error;
    }
}

// --- Run if script is main ---
if (require.main === module) {
    migrateMarketoFiles();
}

module.exports = { migrateMarketoFiles };

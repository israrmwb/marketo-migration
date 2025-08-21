require('dotenv').config();
const hubspotService = require('../services/hubspotService');
const logger = require('../utils/logger');
const { marketoApiRequest } = require('../services/marketoApiService');
const MARKETO_LIST_FIELD_MAPPING = require('../utils/customMap/customMarketoListMapping.json');
const { connectToMongo } = require('../config/db');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100;
const LIST_TYPE = "0-1";
const RATE_LIMIT_DELAY = 100; // ms between requests
const PAGE_DELAY = 100; // ms between pages
const LISTID = 1946;

// Pre-compute field mappings for better performance
const FIELD_MAPPINGS = {
  ...MARKETO_LIST_FIELD_MAPPING.mapping.mapped_with_default,
  ...MARKETO_LIST_FIELD_MAPPING.mapping.mapped_with_custom,
  ...MARKETO_LIST_FIELD_MAPPING.mapping.json_data
};

const JSON_DATA_FIELDS = new Set(Object.keys(MARKETO_LIST_FIELD_MAPPING.mapping.json_data));

/**
 * Fetch Marketo lists with pagination support
 * @param {string} nextPageToken - Token for next page
 * @returns {Promise<{data: Array, nextPageToken: string|null}>}
 */
async function fetchMarketoLists(nextPageToken = null) {
  try {
    const params = { batchSize: BATCH_SIZE };
    if (nextPageToken) {
      params.nextPageToken = nextPageToken;
    }
    if(LISTID){
      params.id = LISTID;
    }
    
    const response = await marketoApiRequest({
      method: 'get',
      url: '/rest/v1/lists.json',
      params
    });
    
    const data = response.data.result || [];
    const nextPage = response.data.nextPageToken || null;
    
    logger.info(`Fetched ${data.length} lists from Marketo${nextPage ? ' (has more pages)' : ''}`);
    
    return { data, nextPageToken: nextPage };
  } catch (error) {
    logger.error('Error fetching Marketo lists', error);
    throw error;
  }
}

/**
 * Transform Marketo list data to HubSpot format
 * @param {Object} marketoList - Raw Marketo list data
 * @returns {Object} Transformed data for HubSpot
 */
function transformMarketoListData(marketoList) {
  if (!marketoList || typeof marketoList !== 'object') {
    throw new Error('Invalid Marketo list data provided');
  }

  const transformedList = {
    objectTypeId: LIST_TYPE,
    processingType: "MANUAL"
  };
  
  for (const [marketoField, hubspotField] of Object.entries(FIELD_MAPPINGS)) {
    const marketoValue = marketoList[marketoField];
    
    // Skip undefined/null values
    if (marketoValue === undefined || marketoValue === null) {
      continue;
    }

    // Handle JSON data fields (nested objects)
    if (JSON_DATA_FIELDS.has(marketoField) && 
        typeof marketoValue === 'object' && 
        !Array.isArray(marketoValue)) {
      
      const jsonDataField = MARKETO_LIST_FIELD_MAPPING.mapping.json_data[marketoField];
      const nestedValue = marketoValue[jsonDataField];
      
      if (nestedValue !== undefined) {
        transformedList[marketoField + 'name'] = nestedValue;
      }
      continue;
    }

    // Handle arrays
    if (Array.isArray(marketoValue)) {
      transformedList[hubspotField] = marketoValue.join(';');
      continue;
    }

    // Handle objects with name property
    if (typeof marketoValue === 'object' && marketoValue.name) {
      transformedList[hubspotField] = marketoValue.name;
      continue;
    }

    // Handle primitive values
    transformedList[hubspotField] = marketoValue;
  }
  
  return transformedList;
}

/**
 * Process a single Marketo list record
 * @param {Object} list - Marketo list data
 * @param {number} index - Current index
 * @param {number} total - Total records to process
 * @returns {Promise<{success: boolean, result?: Object, error?: string}>}
 */
async function processMarketoListRecord(list, index, total) {
  try {
    const transformedRecord = transformMarketoListData(list);
    
    if (!transformedRecord.name) {
      logger.warn(`Skipping list at index ${index} - missing name field`);
      return { success: false, error: 'Missing name field' };
    }
    
    const result = await hubspotService.upsertListRecord(
      transformedRecord.name, 
      transformedRecord, 
      transformedRecord.objectTypeId
    );
    
    logger.info(`Processed ${index + 1}/${total}: ${transformedRecord.name}`, {
      recordId: result.list?.listId || 'unknown'
    });
    
    return { success: true, result };
  } catch (error) {
    const listId = list.listid || list.id || 'unknown';
    logger.error(`Failed to process list at index ${index}`, {
      listId,
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

/**
 * Add delay between requests to respect rate limits
 * @param {number} ms - Milliseconds to delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main migration function with improved error handling and performance
 */
async function migrateMarketoLists() {
  // await connectToMongo();
  
  let totalMigrated = 0;
  let totalFailed = 0;
  let nextPageToken = null;
  let pageCount = 0;

  logger.info('Starting Marketo List migration...');

  try {
    while (true) {
      pageCount++;
      logger.info(`Processing page ${pageCount}, nextPageToken:- ${nextPageToken}`);
      
      // Fetch lists for current page
      const { data: lists, nextPageToken: newNextPageToken } = await fetchMarketoLists(nextPageToken);
      nextPageToken = newNextPageToken;

      if (!lists || lists.length === 0) {
        logger.info('No more lists to migrate');
        break;
      }

      logger.info(`Processing ${lists.length} lists on page ${pageCount}`);

      // Process lists with concurrency control
      const batchPromises = lists.map(async (list, index) => {
        const result = await processMarketoListRecord(list, index, lists.length);
        
        if (result.success) {
          totalMigrated++;
        } else {
          totalFailed++;
        }
        
        // Add delay between individual requests
        await delay(RATE_LIMIT_DELAY);
        
        return result;
      });

      // Wait for all records in current batch to complete
      await Promise.all(batchPromises);
      break;

      // Add delay between pages
      if (nextPageToken) {
        await delay(PAGE_DELAY);
      } else {
        break; // No more pages
      }
    }

    logger.success('Marketo list migration completed!', {
      totalMigrated,
      totalFailed,
      totalPages: pageCount
    });

  } catch (error) {
    logger.error('Migration failed', {
      error: error.message,
      totalMigrated,
      totalFailed,
      totalPages: pageCount
    });
    throw error;
  }
}

// Export for testing and direct execution
if (require.main === module) {
  migrateMarketoLists().catch(error => {
    logger.error('Migration script failed', error);
    process.exit(1);
  });
}

module.exports = {
  migrateMarketoLists,
  transformMarketoListData,
  fetchMarketoLists,
  MARKETO_LIST_FIELD_MAPPING
};
require('dotenv').config();
const hubspotService = require('../services/hubspotService');
const logger = require('../utils/logger');
const { marketoApiRequest } = require('../services/marketoApiService');
const MARKETO_LIST_FIELD_MAPPING = require('../utils/customMap/customMarketoListMapping.json');
const { connectToMongo } = require('../config/db');
const { fetchMarketoPrograms } = require('./migrateObjectProgramData');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100;
const LIST_TYPE = "0-1";
const RATE_LIMIT_DELAY = 100; // ms between requests
const PAGE_DELAY = 100; // ms between pages

// Pre-compute field mappings for better performance
const FIELD_MAPPINGS = {
  ...MARKETO_LIST_FIELD_MAPPING.mapping.mapped_with_default
};

const JSON_DATA_FIELDS = new Set(Object.keys(MARKETO_LIST_FIELD_MAPPING.mapping.json_data));


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
    if(hubspotField=='name'){
        transformedList[hubspotField] = '(Campaign) '+marketoValue;
    }
  }
  
  return transformedList;
}


async function processMarketoListRecord(list, index, total) {
  try {
    const transformedRecord = transformMarketoListData(list);
    
    if (!transformedRecord.name) {
      logger.warn(`Skipping program as list at index ${index} - missing name field`);
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
    logger.error(`Failed to process program as list at index ${index}`, {
      listId,
      error: error.message
    });
    return { success: false, error: error.message };
  }
}


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
    let pageCount = 0;
  
    logger.info('Starting Marketo Program as list migration...');
  
    try {
      while (true) {
        pageCount++;
        logger.info(`Processing page ${pageCount}`);
        
        const { data: programs } = await fetchMarketoPrograms(pageCount);
  
        if (!programs || programs.length === 0) {
          logger.info('No more programs to migrate as list');
          break;
        }
  
        logger.info(`Processing ${programs.length} programs as list on page ${pageCount}`);

        for(let i=0; i<programs.length; i++){
          const program = programs[i];
            const result = await processMarketoListRecord(program, i, programs.length);
            
            if (result.success) {
              totalMigrated++;
            } else {
              totalFailed++;
            }
            
            logger.info(`Total migrated so far: ${totalMigrated}`);
            
            await delay(RATE_LIMIT_DELAY);
        }
  
        // break;
        await delay(PAGE_DELAY);
      }
  
      logger.success('Marketo program as list migration completed!', {
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
  MARKETO_LIST_FIELD_MAPPING
};
require('dotenv').config();
const hubspotService = require('../services/hubspotService');
const logger = require('../utils/logger');
const { marketoApiRequest } = require('../services/marketoApiService');
const MARKETO_PROGRAM_FIELD_MAPPING = require('../utils/customMap/customMarketoProgramMapping.json');
const { connectToMongo } = require('../config/db');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100;
const RATE_LIMIT_DELAY = 100; // ms between requests
const PAGE_DELAY = 100; // ms between pages
const filterType='id';
const filterValues=1317;

// Pre-compute field mappings for better performance
const FIELD_MAPPINGS = {
  ...MARKETO_PROGRAM_FIELD_MAPPING.mapping.mapped_with_default,
  ...MARKETO_PROGRAM_FIELD_MAPPING.mapping.mapped_with_custom,
  ...MARKETO_PROGRAM_FIELD_MAPPING.mapping.json_data
};

const JSON_DATA_FIELDS = new Set(Object.keys(MARKETO_PROGRAM_FIELD_MAPPING.mapping.json_data));

async function fetchMarketoPrograms(page = 1) {
  try {
    const offset = (page - 1) * BATCH_SIZE;
    const params = { maxReturn: BATCH_SIZE, offset };
    if(filterType&&filterValues){
      params.filterType = filterType;
      params.filterValues = filterValues;
    }
    const response = await marketoApiRequest({
      method: 'get',
      url: '/rest/asset/v1/programs.json',
      params
    });
    
    const data = response.data.result || [];
    return { data };
  } catch (error) {
    logger.error('Error fetching Marketo programs', error);
    throw error;
  }
}

function transformMarketoProgramData(marketoProgram) {
  if (!marketoProgram || typeof marketoProgram !== 'object') {
    throw new Error('Invalid Marketo program data provided');
  }
  
  const transformedProgram = {};
  
  for (const [marketoField, hubspotField] of Object.entries(FIELD_MAPPINGS)) {
    let marketoValue = marketoProgram[marketoField];
    
    if (marketoValue === undefined || marketoValue === null) {
      continue;
    }

    if (
      JSON_DATA_FIELDS.has(marketoField) &&
      typeof marketoValue === 'object' &&
      !Array.isArray(marketoValue)
    ) {
      const jsonDataField = MARKETO_PROGRAM_FIELD_MAPPING.mapping.json_data[marketoField];
      const nestedValue = marketoValue[jsonDataField];
      if (nestedValue !== undefined) {
        transformedProgram[marketoField + 'name'] = nestedValue;
      }
      continue;
    }

    if (Array.isArray(marketoValue)) {
      transformedProgram[hubspotField] = marketoValue.join(';');
      continue;
    }

    if (typeof marketoValue === 'object' && marketoValue.name) {
      transformedProgram[hubspotField] = marketoValue.name;
      continue;
    }
    if(hubspotField=='hs_name'){
      marketoValue = marketoValue.replace(/\(/g, "[").replace(/\)/g, "]");
    }

    transformedProgram[hubspotField] = marketoValue;
  }
  
  return transformedProgram;
}

async function processMarketoProgramRecord(program, index, total) {
  try {
    const transformedRecord = transformMarketoProgramData(program);
    
    if (!transformedRecord.hs_name) {
      logger.warn(`Skipping program at index ${index} - missing name field`);
      return { success: false, error: 'Missing name field' };
    }
    
    const result = await hubspotService.upsertCampaignRecord(
      transformedRecord.hs_name,
      transformedRecord
    );
    
    logger.info(`Processed ${index + 1}/${total}: ${transformedRecord.hs_name}`, {
      recordId: result?.id || result?.data?.id || 'unknown'
    });
    
    return { success: true, result };
  } catch (error) {
    const programId = program.id || 'unknown';
    logger.error(`Failed to process program at index ${index}`, {
      programId,
      error: error.message
    });
    return { success: false, error: error.message };
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function migrateMarketoPrograms() {
  // await connectToMongo();
  
  let totalMigrated = 0;
  let totalFailed = 0;
  let pageCount = 0;

  logger.info('Starting Marketo Program migration...');

  try {
    while (true) {
      pageCount++;
      logger.info(`Processing page ${pageCount}`);
      
      const { data: programs } = await fetchMarketoPrograms(pageCount);

      if (!programs || programs.length === 0) {
        logger.info('No more programs to migrate');
        break;
      }

      logger.info(`Processing ${programs.length} programs on page ${pageCount}`);

      const batchPromises = programs.map(async (program, index) => {
        const result = await processMarketoProgramRecord(program, index, programs.length);
        
        if (result.success) {
          totalMigrated++;
        } else {
          totalFailed++;
        }
        
        logger.info(`Total migrated so far: ${totalMigrated}`);
        
        await delay(RATE_LIMIT_DELAY);
        
        return result;
      });

      await Promise.all(batchPromises);

      break;
      await delay(PAGE_DELAY);
    }

    logger.success('Marketo program migration completed!', {
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

if (require.main === module) {
  migrateMarketoPrograms()
  .catch(error => {
    logger.error('Migration script failed', error);
    process.exit(1);
  });
}

module.exports = {
  migrateMarketoPrograms,
  transformMarketoProgramData,
  fetchMarketoPrograms,
  MARKETO_PROGRAM_FIELD_MAPPING
};
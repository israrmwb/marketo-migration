// associateCompanies.js
const fs = require('fs');
const path = require('path');
const hubspotService = require('../services/hubspotService');
const logger = require('../utils/logger');
const { createAssociationData } = require('../utils/transformData');
const { connectToMongo } = require('../config/db');
const limit = parseInt(process.env.BATCH_SIZE) || 100;
/**
 * Only two type of associations for this project
 * 1. Companies to Contacts  for contacts (fromObjectType: "companies", toObjectType: "contacts", "fromObjectKey": "primarycontactid", "toObjectKey": "contactid")
 * 2. Companies to Contacts for leads (fromObjectType: "companies", toObjectType: "contacts", "fromObjectKey": "originatingleadid", "toObjectKey": "leadid")
 */
const assosConfig = {
  fromObjectType: "companies",
  toObjectType: "contacts",
  fromObjectKey: "originatingleadid",
  toObjectKey: "leadid"
};

async function getObjectRecordList(after = null) {
  try {
    let endpoint = `/crm/v3/objects/${assosConfig.fromObjectType}?limit=${limit}&properties=${assosConfig.fromObjectKey}`;
    if (after) endpoint += `&after=${after}`;
    const response = await hubspotService.client.get(endpoint);
    return response.data;
  } catch (error) {
    logger.error(`Error fetching ${assosConfig.fromObjectType} page`, error, { after, limit });
    throw error;
  }
}

async function createBatchPayload(records) {
  const inputs = [];

  for (const record of records) {
    const searchValue = record.properties?.[assosConfig.fromObjectKey];
    if (!searchValue) continue;

    const existingRecord = await hubspotService.findObjectDataByPropertyAndValue(
      assosConfig.toObjectType,
      assosConfig.toObjectKey,
      searchValue,
      [assosConfig.fromObjectKey]
    );

    if (existingRecord?.id) {
      inputs.push(
        createAssociationData(
          assosConfig.fromObjectType,
          record.id,
          assosConfig.toObjectType,
          existingRecord.id
        )
      );
    }
  }

  return { inputs };
}

async function processAssociationBatch(records) {
  try {
    const batchPayload = await createBatchPayload(records);
    const batchResponse = await hubspotService.batchCreateAssociations(
      assosConfig.fromObjectType,
      assosConfig.toObjectType,
      batchPayload
    );

    logger.success(`Batch processed successfully`, {
      batchSize: records.length,
      results: batchResponse?.results?.length || 0
    });

    return batchResponse;
  } catch (error) {
    logger.error('Error processing Association batch', error, {
      batchSize: records.length
    });
    throw error;
  }
}

async function associateRecords() {
  try {
    await connectToMongo();
  } catch (err) {
    logger.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }

  let after = null;
  let page = 1;
  let hasMore = true;
  let totalMigrated = 0;
  let totalFailed = 0;

  logger.info(`Starting association process from ${assosConfig.fromObjectType} to ${assosConfig.toObjectType}...`);

  while (hasMore) {
    logger.info(`Processing page ${page}...`);
    logger.info(`Processing after ${after}`);
    const dataResponse = await getObjectRecordList(after);
    const records = dataResponse.results || [];
    after = dataResponse.paging?.next?.after || null;

    if (records.length === 0) {
      hasMore = false;
      break;
    }

    logger.info(`Found ${records.length} records on page ${page}`);

    try {
      const batchResponse = await processAssociationBatch(records);
      totalMigrated += records.length;
      if (batchResponse.errors?.length) {
        totalFailed += batchResponse.errors.length;
        logger.error(`Batch had ${batchResponse.errors.length} errors`, batchResponse.errors);
      }
    } catch (error) {
      totalFailed += records.length;
      logger.error('Failed to process batch', error, { page, after });
    }
    break;
    page++;
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (!after) hasMore = false;
  }

  logger.success('Association process completed!', {
    totalMigrated,
    totalFailed
  });
}

if (require.main === module) {
  associateRecords().catch(err => {
    logger.error('Association script failed', err);
    process.exit(1);
  });
}

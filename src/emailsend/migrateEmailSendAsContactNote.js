require('dotenv').config();
const hubspotService = require('../services/hubspotService');
const logger = require('../utils/logger');
const { dynamicsApiRequest } = require('../services/dynamicApiService');
const { connectToMongo } = require('../config/db');
const { labelMapping } = require('../utils/customMap/customDynamicCRMfoamSend.json');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 100;

// Fetch a page of full Dynamic CRM emailSend objects (with all fields)
async function fetchDynamicsCRMEmailSend(nextPageLink = null) {
  let response;
  const headers = {Prefer: 'odata.maxpagesize='+BATCH_SIZE};
  if (nextPageLink) {
    response = await dynamicsApiRequest({
      headers: headers,
      method: 'get',
      url: nextPageLink
    });
  } else {
    response = await dynamicsApiRequest({
      headers: headers,
      method: 'get',
      url: `/api/data/v9.2/cdi_emailsends`,
      params: {
        "$filter": "cdi_fromemail ne null"
      }
    });
  }
  const data = response.data.value || [];
  const nextPage = response.data['@odata.nextLink'];
  return { data, nextPageLink: nextPage };
}


function formatNoteContent(record) {
  return Object.entries(record)
    .filter(([key]) => labelMapping[key.toLowerCase()])
    .map(([key, val]) => {
      const displayKey = labelMapping[key.toLowerCase()] || key.toUpperCase();
      return `<b>${displayKey}</b> : ${val}`;
    })
    .join("<br/>");
}

async function processEmailSendData(record) {
    const email = record.cdi_fromemail;

    const existingRecord = await hubspotService.findObjectDataByPropertyAndValue(
          'contacts',
          'email',
          email,
          ['email']
        );
    let contactId = existingRecord ? existingRecord?.id : null;
    if (!contactId) {
      console.log(`Creating contact for: ${email}`);
      const response = await hubspotService.createCustomObjectRecord('contacts', {email: email});
      contactId = response.id;
    }

    if (contactId) {
      let noteContent = formatNoteContent(record);
      noteContent = `<h4>***************Email Send Data***************</h4><br/> ${noteContent}`;
      try {
        await hubspotService.createNote(contactId, noteContent);
        console.log(`✅ Note created for contactId: ${contactId} | email: ${email}`);
      } catch (error) {
        console.error(
          `❌ Error | contactId: ${contactId} | email: ${email} | message: ${error.message}`,
          error.response?.data || error
        );
      }
    }
}
// Main migration function
async function migrateEmailSendToContactNote() {
  await connectToMongo();
  let page = 1;
  let hasMore = true;
  let totalMigrated = 0;
  let totalFailed = 0;
  let nextPageLink = null;

  logger.info('Starting Dynamics CRM Email Sends migration...');

  while (hasMore) {
    logger.info(`Processing page ${page}...`);
    logger.info(`Processing pageLink ${nextPageLink}`);
    const dataResponse = await fetchDynamicsCRMEmailSend(nextPageLink);
    const emailSend = dataResponse.data;
    nextPageLink = dataResponse.nextPageLink;

    // to run test
    // const emailSend = testCase1;
    if (!emailSend || emailSend.length === 0) {
      hasMore = false;
      continue;
    }
    logger.info(`Found ${emailSend.length} CRM emailSend on page ${page}`);
    try {

      for (const element of emailSend) {
        await processEmailSendData(element);
        await new Promise(resolve => setTimeout(resolve, 1000));
        totalMigrated++;
        logger.info(`Processed EmailSend with ID: ${element.cdi_emailsendid}`);
      }
    } catch (error) {
      totalFailed += emailSend.length;
      logger.error('Failed at nextPageLink', { nextPageLink });
      logger.error('Failed to process page', error, { page });
    }
    // If you want to process all pages, remove the break below
    break;
    page++;
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!nextPageLink) {
      hasMore = false;
    }
  }
  logger.success('Dynamics CRM emailSend migration completed!', {
    totalMigrated,
    totalFailed
  });
}

if (require.main === module) {
  migrateEmailSendToContactNote();
}

module.exports = {
  migrateEmailSendToContactNote
}; 
require('dotenv').config();
const hubspotService = require('../services/hubspotService');
const logger = require('../utils/logger');
const { connectToMongo } = require('../config/db');
const { marketoApiRequest } = require('../services/marketoApiService');
const { fetchMarketoLists } = require('./migrateObjectListData');

 
 const HUBSPOT_BATCH_SIZE = 100; // HubSpot API limit
 const PAGE_DELAY = 100; // ms between pages
 
 const MEMBER_TYPE = { hubspot: '0-1', objectType: 'contacts', searchKey: 'id' };
 
 // --- Helpers ---
 function delay(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
 }
 
 // --- HubSpot List Functions ---
 async function getHubSpotListId(listName) {
   try {
     const response = await hubspotService.client.get(
       `/crm/v3/lists/object-type-id/${MEMBER_TYPE.hubspot}/name/${listName}`
     );
     return response.data.list.listId;
   } catch (error) {
     logger.error(`Error finding HubSpot list with name: ${listName}`, error.message);
     return null;
   }
 }
 
 // --- Marketo Functions ---
 async function getListMembers(listId, nextPageToken = null) {
   try {
     const params = { fields: 'id', batchSize: HUBSPOT_BATCH_SIZE };
     if (nextPageToken) params.nextPageToken = nextPageToken;
 
     const response = await marketoApiRequest({
       method: 'get',
       url: `/rest/v1/list/${listId}/leads.json`,
       params,
     });
     const { result = [], nextPageToken: newToken = null } = response.data;
     logger.info(`Fetched ${result.length} members from Marketo${newToken ? ' (more pages)' : ''}`);
     return { data: result, nextPageToken: newToken };
   } catch (error) {
     logger.error('Error fetching Marketo members', error.message);
     throw error;
   }
 }
 
 // --- HubSpot Lookup ---
 async function findHubSpotContactId(marketoContactId) {
   try {
    logger.info(`Searching lead by id :- ${marketoContactId}`);
     const hubspotContact = await hubspotService.findObjectDataByPropertyAndValue(
       MEMBER_TYPE.objectType,
       MEMBER_TYPE.searchKey,
       marketoContactId,
       ['hs_object_id']
     );
     return hubspotContact ? hubspotContact.id : null;
   } catch (error) {
     logger.error(`Error finding HubSpot ${MEMBER_TYPE.objectType} for ID: ${marketoContactId}`, error.message);
     return null;
   }
 }
 
 // --- Process Program as List ---
 async function processListMembership(list) {
   const { id, name } = list;
   let totalMemberAdded = 0;
   let notFoundCount = 0;
   let nextPageToken = null;
   let pageCount = 0;
 
   try {
     const hubspotListId = await getHubSpotListId(name);
 
     if (!hubspotListId) {
       logger.error(`HubSpot list not found for list: ${name}`);
       return { success: false, error: 'HubSpot list not found' };
     }
 
     logger.info(`Found HubSpot list ID: ${hubspotListId} for list: ${name}`);
 
     while (true) {

       pageCount++;
       logger.info(`Processing page ${pageCount}, nextPageToken: ${nextPageToken}`);
 
       const { data: marketoMembers, nextPageToken: newNextPageToken } = await getListMembers(id, nextPageToken);
       nextPageToken = newNextPageToken;
 
       if (!marketoMembers.length) {
         logger.info(`No more members for list: ${name}`);
         break;
       }
 
       const hubspotMemberIds = [];
       for (let i = 0; i < marketoMembers.length; i ++) {
        const member = marketoMembers[i];
        const hubspotId = await findHubSpotContactId(member[MEMBER_TYPE.searchKey]);
        if(hubspotId){
          hubspotMemberIds.push(hubspotId);
        }else{
          notFoundCount++;
          logger.info(`No record found at lead id:- ${member[MEMBER_TYPE.searchKey]}`);
        }

         await delay(PAGE_DELAY);
       }
 
       // --- Add to HubSpot List ---
       if (hubspotMemberIds.length > 0) {
         try {
           await hubspotService.client.put(
             `/crm/v3/lists/${hubspotListId}/memberships/add`,hubspotMemberIds
           );
           totalMemberAdded += hubspotMemberIds.length;
           logger.success(`Added ${hubspotMemberIds.length} members to HubSpot list ${hubspotListId}`);
         } catch (error) {
           logger.error(`Failed to add members to HubSpot list ${hubspotListId}`, error.message);
         }
       }
 
       if (!nextPageToken) break;
       await delay(PAGE_DELAY);
     }
     return {
       success: true,
       membersProcessed: totalMemberAdded,
       notFound: notFoundCount,
     };
   } catch (error) {
     logger.error(`Error processing list: ${name}`, error.message);
     return { success: false, error: error.message };
   }
 }
 
 
 
 // --- Migration Loop ---
 async function migrateListMemberships() {
   let totalMigrated = 0;
   let totalFailed = 0;
   let totalMembersAdded = 0;
   let pageCount = 0;
  let nextPageToken = null;
 
   logger.info('Starting Program → HubSpot List migration...');
 
   try {
     while (true) {
       pageCount++;
       logger.info(`Fetching programs (page ${pageCount})`);
       logger.info(`Processing page ${pageCount}, nextPageToken:- ${nextPageToken}`);
 
       const { data: lists, nextPageToken:newNextPageToken } = await fetchMarketoLists(nextPageToken);
       nextPageToken = newNextPageToken;
       if (!lists?.length) {
         logger.info('No more lists to migrate.');
         break;
       }
 
       logger.info(`Processing ${lists.length} lists on page ${pageCount}`);
 
       const results = await Promise.all(
        lists.map(async list => {
           const result = await processListMembership(list);
           if (result.success) {
             totalMigrated++;
             totalMembersAdded += result.membersProcessed || 0;
           } else {
             totalFailed++;
           }
           return result;
         })
       );
 
       logger.info(`Completed page ${pageCount}, total migrated so far: ${totalMigrated}`);
       break;
       await delay(PAGE_DELAY);
     }
 
     logger.success('Migration completed!', {
       totalMigrated,
       totalFailed,
       totalMembersAdded,
       totalPages: pageCount,
     });
   } catch (error) {
     logger.error('Migration failed', { error: error.message, totalMigrated, totalFailed, totalPages: pageCount });
     throw error;
   }
 }
 
 // --- Run if script is main ---
 if (require.main === module) {
   migrateListMemberships();
 }
 
 module.exports = { migrateListMemberships };

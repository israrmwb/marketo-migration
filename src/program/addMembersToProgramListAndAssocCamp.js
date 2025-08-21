require('dotenv').config();
const hubspotService = require('../services/hubspotService');
const logger = require('../utils/logger');
const { connectToMongo } = require('../config/db');
const { fetchMarketoPrograms } = require('./migrateObjectProgramData');
const { marketoApiRequest } = require('../services/marketoApiService');

// const pLimit = require('p-limit');
 
 const HUBSPOT_BATCH_SIZE = 100; // HubSpot API limit
 const PAGE_DELAY = 100; // ms between pages
 const LOOKUP_CONCURRENCY = 10; // Parallel lookups per batch
 const MAX_PAGE_LIMIT = 1000; // Safety limit
 
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
 async function getProgramMembers(programId, nextPageToken = null) {
   try {
     const params = { fields: 'id', batchSize: HUBSPOT_BATCH_SIZE };
     if (nextPageToken) params.nextPageToken = nextPageToken;
 
     const response = await marketoApiRequest({
       method: 'get',
       url: `/rest/v1/leads/programs/${programId}.json`,
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
 async function processListMembership(program) {
   const { id, name } = program;
   let totalMemberAdded = 0;
   let notFoundCount = 0;
   let nextPageToken = null;
   let pageCount = 0;
 
   // try {
     const generatedListName = `(Campaign) ${name}`;
     const hubspotListId = await getHubSpotListId(generatedListName);
 
     if (!hubspotListId) {
       logger.error(`HubSpot list not found for program: ${name}`);
       return { success: false, error: 'HubSpot list not found' };
     }
 
     logger.info(`Found HubSpot list ID: ${hubspotListId} for program: ${name}`);
 
     while (true) {
       // if (pageCount > MAX_PAGE_LIMIT) {
       //   logger.error(`Aborting: exceeded max page limit for program: ${name}`);
       //   break;
       // }
 
       pageCount++;
       logger.info(`Processing page ${pageCount}, nextPageToken: ${nextPageToken}`);
 
       const { data: marketoMembers, nextPageToken: newNextPageToken } = await getProgramMembers(id, nextPageToken);
       nextPageToken = newNextPageToken;
 
       if (!marketoMembers.length) {
         logger.info(`No more members for program: ${name}`);
         break;
       }
 
       // --- Parallel HubSpot lookups with simple chunking ---
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
 
     await associateListToCampaign(program, hubspotListId);
     return {
       success: true,
       membersProcessed: totalMemberAdded,
       notFound: notFoundCount,
     };
   // } catch (error) {
   //   logger.error(`Error processing program: ${name}`, error.message);
   //   return { success: false, error: error.message };
   // }
 }
 
 // --- Associate List to Campaign ---
 async function associateListToCampaign(program, listId) {
   const formattedName = program.name.replace(/\(/g, "[").replace(/\)/g, "]");
   try {
     const response = await hubspotService.client.get(`/marketing/v3/campaigns/?name=${formattedName}`);
     if (response.data.results?.length) {
       const campaignGuid = response.data.results[0].id;
       logger.info(`Associating list ${listId} to campaign ${formattedName}`);
       return await hubspotService.client.put(
         `/marketing/v3/campaigns/${campaignGuid}/assets/OBJECT_LIST/${listId}`
       );
     } else {
       logger.info(`No campaign found with name: ${formattedName}`);
     }
   } catch (error) {
     logger.error(`Error associating list ${listId} to campaign ${formattedName}`, error.message);
   }
 }
 
 // --- Migration Loop ---
 async function migrateListMemberships() {
   let totalMigrated = 0;
   let totalFailed = 0;
   let totalMembersAdded = 0;
   let pageCount = 0;
 
   logger.info('Starting Program → HubSpot List migration...');
 
   try {
     while (true) {
       pageCount++;
       logger.info(`Fetching programs (page ${pageCount})`);
 
       const { data: programs } = await fetchMarketoPrograms(pageCount);
       if (!programs?.length) {
         logger.info('No more programs to migrate.');
         break;
       }
 
       logger.info(`Processing ${programs.length} programs on page ${pageCount}`);
 
       const results = await Promise.all(
         programs.map(async program => {
           const result = await processListMembership(program);
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

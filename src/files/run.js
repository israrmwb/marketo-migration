// run.js
const { processMarketoFolder } = require('./migrate');
require('dotenv').config();

async function main() {
    console.log("--- Starting Marketo to HubSpot File Migration ---");
    console.log(`Current Time in Lucknow: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })}`);

    const marketoRootFolderId = process.env.MARKETO_ROOT_FOLDER_ID;
    const hubspotRootFolderId = process.env.HUBSPOT_TARGET_ROOT_FOLDER_ID === 'null' ? null : process.env.HUBSPOT_TARGET_ROOT_FOLDER_ID;

    if (!marketoRootFolderId) {
        console.error("❌ ERROR: MARKETO_ROOT_FOLDER_ID is not set in your .env file.");
        return;
    }

    try {
        await processMarketoFolder(marketoRootFolderId, hubspotRootFolderId);
        console.log("\n--- ✅ Migration script finished successfully! ---");
    } catch (error) {
        console.error("\n--- ❌ A critical error occurred during the migration script ---");
        console.error("Error details:", error.response?.data || error.message);
    }
}

main();
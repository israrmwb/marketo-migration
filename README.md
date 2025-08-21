# Dynamic CRM Migration

This project migrates account, list, event, pageview, email and make association

## Prerequisites

- Node.js (v16 or higher)
- npm
- Dynamic CRM Credentials

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory with the following variables by just rename .env-example:
```
# Dynamic CRM API Configuration
DYNAMICS_TENANT_ID=XXXXXXXXXXXXXX
DYNAMICS_API_BASE_URL=https://xxxxxxxxx.api.crm5.dynamics.com
DYNAMICS_CLIENT_SECRET=XXXXXXXXXXXXXX
DYNAMICS_CLIENT_ID=XXXXXXXXXXXXXX

# HubSpot API Configuration
HUBSPOT_API_KEY=XXXXXXXXXXXXXX

# Configuration
BATCH_SIZE=100
```

## Usage

Run the migration script:
```bash
node src/accounts/migrateObjectProperties.js
```

This is just an example you can run other script in same way by using "node" command

## Features

- Batch processing to handle large datasets
- Multiple script like account, list, event, pageview, email and make association

## Error Handling

The script includes comprehensive error handling:
- Failed record are logged in your mongo database
- API rate limits are respected
- Connection errors are handled gracefully

## Notes

- If you want to make your error logs in your project logs directory just comment these lines in 'src/utils/logger.js" line no 52
```
    const db = await connectToMongo();
    const logCollection = db.collection(log_collection);
    const insertedRecord = await logCollection.insertOne(JSON.parse(logMessage));
    console.log("InsertedId:", insertedRecord.insertedId);
```
- And uncomment line no 56
```
    // fs.appendFileSync(logFile, logMessage);
```
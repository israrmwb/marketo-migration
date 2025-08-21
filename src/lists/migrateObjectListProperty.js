const hubspotService = require('../services/hubspotService');
const logger = require('../utils/logger');
const listMapping = require('../utils/customMap/customMarketoListMapping.json');
const { connectToMongo } = require('../config/db');

const GROUP_NAME = 'marketo_list_information';


async function migrateMarketoListProperties() {
  try {
    // await connectToMongo();
    // 1. Create the property group first
    logger.info(`Creating property group: ${GROUP_NAME}`);
    await hubspotService.createPropertyGroup('0-45', {
      name: GROUP_NAME,
      label: 'Marketo List Properties',
      displayOrder: -1
    });
    logger.success(`Successfully created or found property group: ${GROUP_NAME}`);
    const additionalCusProperties = listMapping.custom_properties;
    const allProperties = [
        ...additionalCusProperties
      ];
    
    // 2. Create each property within the group
    for (let property of allProperties) {
      try {
        
        const propertyPayload = {
          ...property,
          groupName: GROUP_NAME
        };
        
        await hubspotService.createCustomObjectProperty('0-45', propertyPayload);
        logger.success(`Created property '${property.name}' in group '${GROUP_NAME}'`);
      } catch (error) {
        if (error.response && error.response.status === 409) {
          logger.warn(`Property '${property.name}' already exists.`);
        } else {
          logger.error(`Failed to create property: ${property.name}`, error);
        }
      }
    }
    logger.info("Finished processing all Marketo list properties.");

  } catch (error) {
    logger.error('Failed to create property group. Aborting property migration.', error);
  }
}

if (require.main === module) {
    migrateMarketoListProperties();
}

module.exports = {
    migrateMarketoListProperties
}; 
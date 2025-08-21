const logger = require('./logger');
const { dynamicsApiRequest } = require('../services/dynamicApiService');
const assocCode = require('../config/hubspot-assoc-config.json');
require('dotenv').config();

// Comprehensive mapping of Dynamics CRM field types to HubSpot property types
const DYNAMICS_TO_HUBSPOT_TYPE_MAP = {
  // Text fields
  'string': { type: 'string', fieldType: 'text' },
  'memo': { type: 'string', fieldType: 'textarea' },
  'url': { type: 'string', fieldType: 'text' },
  'email': { type: 'string', fieldType: 'text' },
  'phone': { type: 'string', fieldType: 'phonenumber' },
  
  // Numeric fields
  'int': { type: 'number', fieldType: 'number' },
  'bigint': { type: 'number', fieldType: 'number' },
  'double': { type: 'number', fieldType: 'number' },
  'decimal': { type: 'number', fieldType: 'number' },
  'money': { type: 'number', fieldType: 'number' },
  'percentage': { type: 'number', fieldType: 'number' },
  
  // Date and time fields
  'date': { type: 'date', fieldType: 'date' },
  'datetime': { type: 'datetime', fieldType: 'date' },
  'time': { type: 'string', fieldType: 'text' },
  
  // Boolean fields
  'boolean': { type: 'bool', fieldType: 'booleancheckbox' },
  'bit': { type: 'bool', fieldType: 'booleancheckbox' },
  
  // Selection fields
  'picklist': { type: 'enumeration', fieldType: 'select' },
  'status': { type: 'enumeration', fieldType: 'select' },
  'state': { type: 'enumeration', fieldType: 'select' },
  'multiselectpicklist': { type: 'enumeration', fieldType: 'checkbox' },
  'optionset': { type: 'enumeration', fieldType: 'select' },
  'multiselectoptionset': { type: 'enumeration', fieldType: 'checkbox' },
  
  // Reference fields
  'lookup': { type: 'string', fieldType: 'text' },
  'customer': { type: 'string', fieldType: 'text' },
  'owner': { type: 'string', fieldType: 'text' },
  'createdby': { type: 'string', fieldType: 'text' },
  'modifiedby': { type: 'string', fieldType: 'text' },
  
  // File and media fields
  'file': { type: 'string', fieldType: 'text' },
  'image': { type: 'string', fieldType: 'text' },
  
  // Special fields
  'calculated': { type: 'string', fieldType: 'text' },
  'rollup': { type: 'string', fieldType: 'text' },
  'autonumber': { type: 'string', fieldType: 'text' },
  'guid': { type: 'string', fieldType: 'text' },
  
  // Default fallback
  'default': { type: 'string', fieldType: 'text' }
};

// Fetch picklist options from Dynamics CRM API
async function fetchPicklistOptions(entityName, fieldLogicalName, attributeType = 'Picklist') {
  try {
    const url = `/api/data/v9.2/EntityDefinitions(LogicalName='${entityName}')/Attributes(LogicalName='${fieldLogicalName}')/Microsoft.Dynamics.CRM.${attributeType}AttributeMetadata?$expand=OptionSet`;
    
    const response = await dynamicsApiRequest({
      method: 'GET',
      url: url
    });

    if (response.data && response.data.OptionSet) {
      
      // Handle Boolean OptionSet
      if (response.data.OptionSet.OptionSetType === 'Boolean') {
        const options = [];
        
        if (response.data.OptionSet.TrueOption) {
          const trueLabel = response.data.OptionSet.TrueOption.Label?.UserLocalizedLabel?.Label || 'Yes';
          options.push({
            label: trueLabel,
            value: true,
            description: trueLabel,
            displayOrder: 0
          });
        }
        
        if (response.data.OptionSet.FalseOption) {
          const falseLabel = response.data.OptionSet.FalseOption.Label?.UserLocalizedLabel?.Label || 'No';
          options.push({
            label: falseLabel,
            value: false,
            description: falseLabel,
            displayOrder: 1
          });
        }
        
        return options;
      }
      
      // Handle regular OptionSet with Options array
      if (response.data.OptionSet.Options) {
        return response.data.OptionSet.Options.map(opt => {
          const label = opt.Label?.LocalizedLabels?.length > 0 
            ? opt.Label.LocalizedLabels[0].Label 
            : `Option ${opt.Value}`;
          
          return {
            label: label,
            value: opt.Value?.toString() || label,
            description: label,
            displayOrder: opt.Value || 0
          };
        });
      }
    }
    
    return [];
  } catch (error) {
    logger.error(`Failed to fetch picklist options for ${fieldLogicalName}`, error);
    return [];
  }
}

// Transform Dynamics CRM field to HubSpot property
const transformDynamicsFieldToHubSpot = async (entityName, dynamicsField, isEntity=true) => {
  const dynamicsFieldType = dynamicsField.AttributeType?.toLowerCase() || 'default';
  const mapping = DYNAMICS_TO_HUBSPOT_TYPE_MAP[dynamicsFieldType] || DYNAMICS_TO_HUBSPOT_TYPE_MAP['default'];
  
  let groupName = `${entityName.toLowerCase()}`;
  if(isEntity){
    groupName = `${entityName.toLowerCase()}_information`;
  }
  
  const hubspotProperty = {
    name: dynamicsField.LogicalName?.toLowerCase() || dynamicsField.SchemaName?.toLowerCase(),
    label: dynamicsField.DisplayName?.UserLocalizedLabel?.Label || dynamicsField.LogicalName,
    type: mapping.type,
    fieldType: mapping.fieldType,
    groupName: groupName,
    description: dynamicsField.Description?.UserLocalizedLabel?.Label || `Migrated from Dynamics CRM: ${dynamicsField.DisplayName?.UserLocalizedLabel?.Label || dynamicsField.LogicalName}`,
    // formField: true // Uncomment if you want all fields to be form fields
  };

  // Add options for enumeration fields (picklists, optionsets, status, state, boolean, etc.)
  if (mapping.type === 'enumeration' || mapping.type==='bool') {
    let options = [];
    
    // If OptionSet is already provided in the field metadata
    if (dynamicsField.OptionSet && dynamicsField.OptionSet.Options) {
      options = dynamicsField.OptionSet.Options.map(option => ({
        label: option.Label?.UserLocalizedLabel?.Label || option.Value?.toString(),
        value: option.Value?.toString() || option.Label?.UserLocalizedLabel?.Label,
        description: option.Label?.UserLocalizedLabel?.Label,
        displayOrder: option.Value || 0
      }));
    }
    // If it's any enumeration field, fetch options from API
    else if (dynamicsFieldType === 'picklist' || dynamicsFieldType === 'optionset' || 
             dynamicsFieldType === 'status' || dynamicsFieldType === 'state' || 
             dynamicsFieldType === 'boolean' || dynamicsFieldType === 'bit' || dynamicsFieldType === 'multiselectpicklist') {
      
      // Determine the correct attribute type for the API call
      let attributeType = 'Picklist';
      if (dynamicsFieldType === 'status') {
        attributeType = 'Status';
      } else if (dynamicsFieldType === 'state') {
        attributeType = 'State';
      } else if (dynamicsFieldType === 'boolean' || dynamicsFieldType === 'bit') {
        attributeType = 'Boolean';
      } else if (dynamicsFieldType === 'multiselectpicklist' ){
        attributeType = 'MultiSelectPicklist';
      }
      
      options = await fetchPicklistOptions(entityName, dynamicsField.LogicalName, attributeType);
    }
    
    if (options.length > 0) {
      hubspotProperty.options = options;
    }
  }

  // For boolean fields, if options are missing or empty, treat as string/text
  // if ((dynamicsFieldType === 'boolean' || dynamicsFieldType === 'bit') && (!hubspotProperty.options || hubspotProperty.options.length === 0)) {
  //   hubspotProperty.type = 'string';
  //   hubspotProperty.fieldType = 'text';
  //   delete hubspotProperty.options;
  // }

  // Handle required fields
  // if (dynamicsField.RequiredLevel?.Value === 1) {
  //   hubspotProperty.required = true;
  // }

  // Handle default values
  if (dynamicsField.DefaultValue !== undefined && dynamicsField.DefaultValue !== null) {
    hubspotProperty.defaultValue = dynamicsField.DefaultValue;
  }

  // Handle field length for text fields
  if (mapping.type === 'string' && dynamicsField.MaxLength) {
    hubspotProperty.maxLength = dynamicsField.MaxLength;
  }

  // Handle decimal places for numeric fields
  if (mapping.type === 'number' && dynamicsField.Precision) {
    hubspotProperty.decimalPlaces = dynamicsField.Precision;
  }

  // Handle currency fields
  if (dynamicsFieldType === 'money') {
    hubspotProperty.currency = 'USD'; // Default currency, adjust as needed
  }

  // Handle calculated fields
  // if (dynamicsFieldType === 'calculated') {
  //   hubspotProperty.readOnly = true;
  //   hubspotProperty.description = `Calculated field: ${dynamicsField.CalculatedFormula || 'Migrated from Dynamics CRM calculated field'}`;
  // }

  // Handle autonumber fields
  // if (dynamicsFieldType === 'autonumber') {
  //   hubspotProperty.readOnly = true;
  //   hubspotProperty.description = 'Auto-generated number field';
  // }

  // Mark property as read-only if Dynamics field is read-only
  // if (dynamicsField.IsReadOnly === true || dynamicsField.IsValidForRead === false) {
  //   hubspotProperty.readOnly = true;
  // }

  return hubspotProperty;
};

// Get HubSpot field type for a given Dynamics CRM field type
const getHubSpotFieldType = (dynamicsFieldType) => {
  const dynamicsType = dynamicsFieldType?.toLowerCase() || 'default';
  const mapping = DYNAMICS_TO_HUBSPOT_TYPE_MAP[dynamicsType] || DYNAMICS_TO_HUBSPOT_TYPE_MAP['default'];
  return mapping.fieldType;
};

// Get HubSpot property type for a given Dynamics CRM field type
const getHubSpotPropertyType = (dynamicsFieldType) => {
  const dynamicsType = dynamicsFieldType?.toLowerCase() || 'default';
  const mapping = DYNAMICS_TO_HUBSPOT_TYPE_MAP[dynamicsType] || DYNAMICS_TO_HUBSPOT_TYPE_MAP['default'];
  return mapping.type;
};

// Transform Dynamics CRM record data to HubSpot format
const transformDynamicsRecordToHubSpot = (dynamicsRecord, fieldMappings) => {
  const hubspotRecord = {};
  
  for (const [dynamicsFieldName, hubspotFieldName] of Object.entries(fieldMappings)) {
    const dynamicsValue = dynamicsRecord[dynamicsFieldName];
    
    if (dynamicsValue !== undefined && dynamicsValue !== null) {
      // Handle different data types 
      if (Array.isArray(dynamicsValue)) {
        // For multiselect fields, join with semicolon
        hubspotRecord[hubspotFieldName] = dynamicsValue.join(';');
      } else if (typeof dynamicsValue === 'object') {
        // For lookup fields, extract the name or ID
        if (dynamicsValue.name) {
          hubspotRecord[hubspotFieldName] = dynamicsValue.name;
        } else if (dynamicsValue.id) {
          hubspotRecord[hubspotFieldName] = dynamicsValue.id;
        } else if (dynamicsValue._value) {
          hubspotRecord[hubspotFieldName] = dynamicsValue._value;
        } else {
          hubspotRecord[hubspotFieldName] = JSON.stringify(dynamicsValue);
        }
      } else {
        // For simple values, convert to string if needed
        hubspotRecord[hubspotFieldName] = String(dynamicsValue);
      }
    }
  }
  
  return hubspotRecord;
};

// Create field mappings from Dynamics CRM fields to HubSpot properties
const createFieldMappings = (dynamicsFields) => {
  const mappings = {};
  
  dynamicsFields.forEach(field => {
    const hubspotFieldName = field.LogicalName?.toLowerCase() || field.SchemaName?.toLowerCase();
    if (hubspotFieldName) {
      mappings[field.LogicalName || field.SchemaName] = hubspotFieldName;
    }
  });
  
  return mappings;
};

const getHubspotDynamicsIdMapping = (dynamicsIds, hubspotIds) => {
  const mapping = {};
  for (let i = 0; i < dynamicsIds.length; i++) {
    mapping[dynamicsIds[i]] = hubspotIds[i];
  }
  return mapping;
};

const parseEmailHeaderString = (input) => {
  const result = [];

  // Match all occurrences of "name"<email>
  const regex = /"([^"]+)"<([^>]+)>/g;
  let match;

  while ((match = regex.exec(input)) !== null) {
    const name = match[1].trim();
    const email = match[2].trim();

    let firstName = "";
    let lastName = "";

    // If name is "last, first"
    if (name.includes(',')) {
      [lastName, firstName] = name.split(',').map(s => s.trim());
    } else {
      // Split on space if not in "last, first" format
      const parts = name.split(' ').map(s => s.trim());
      firstName = parts[0] || "";
      lastName = parts.slice(1).join(' ') || "";
    }

    result.push({
      email,
      firstName,
      lastName
    });
  }

  return result;
}

const getDomainFromWebsiteUrl = (url) =>{
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch (error) {
    console.error("Invalid URL:", url);
    return null;
  }
}

const createAssociationData = (fromObjectType, fromObjectTypeId, toObjectType, toObjectTypeId) => {
  const associationTypeId = assocCode[fromObjectType]?.TO?.[toObjectType];
  if(!associationTypeId) {
    throw new Error(`Association type ID not found for ${fromObjectType} to ${toObjectType}`);
  }else{
    return {
        from: {
          id: fromObjectTypeId
        },
        to: {
          id: toObjectTypeId
        },
        types: [
          {
            associationCategory: "HUBSPOT_DEFINED",
            associationTypeId: associationTypeId
          }
        ]
    };
  }
}

module.exports = {
  transformDynamicsFieldToHubSpot,
  fetchPicklistOptions,
  getHubSpotFieldType,
  getHubSpotPropertyType,
  transformDynamicsRecordToHubSpot,
  createFieldMappings,
  getDomainFromWebsiteUrl,
  DYNAMICS_TO_HUBSPOT_TYPE_MAP,
  getHubspotDynamicsIdMapping,
  parseEmailHeaderString,
  createAssociationData
};
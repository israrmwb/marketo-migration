let json = pm.response.json();
let dataTypeMapping = {
    "BooleanType": "Single checkbox",
    "PicklistType": "Dropdown select",
    "MultiSelectPicklistType": "Multiple checkboxes",
    "DateTimeType": "Date and time picker",
    "DecimalType": "Number",
    "DoubleType": "Number",
    "IntegerType": "Number",
    "MoneyType": "Number",
    "StringType": "Single-line text",
    "MemoType": "Multi-line text",
    "GuidType": "Single-line text",
    "OwnerType": "HubSpot user",
    "LookupType": "HubSpot user/Single-line text",
    "FileType": "Single-line text",
    "ImageType": "Single-line text",
    "TimeType": "Single-line text",
    "BigIntType": "Single-line text",
    "CustomerType": "*Need to determine",
    "StateType": "Dropdown select",
    "UniqueidentifierType": "Single-line text",
    "VirtualType": "Single-line text"
  }

let internalName = '';
let dynamicCRMDataType = '';
let hubspotDataType = '';
let result = json.value.map(item => {
    internalName += item.LogicalName + ',';
    dynamicCRMDataType += item.AttributeType + ',';
    const dcrmDataType = item.AttributeTypeName.Value;
    const hsDataType = dataTypeMapping[dcrmDataType]??'unknown';
    hubspotDataType += hsDataType+',';


    return {
        name: item.LogicalName,
        label: item.DisplayName.LocalizedLabels.length ? item.DisplayName.LocalizedLabels[0].Label : ''
    };
});

// Remove trailing comma
internalName = internalName.replace(/,$/, '');
// dynamicCRMDataType = dynamicCRMDataType.replace(/,$/, '');
// hubspotDataType = hubspotDataType.replace(/,$/, '');

// Log to console
console.log('Internal name:', internalName);
console.log('Dynamic datatype name:', dynamicCRMDataType);
console.log('Hubspot datatype name:', hubspotDataType);
console.log('Result:', result);
console.log('Count:', result.length);
let isDefaultProperties = '';
result.forEach(e=>{
 let url = `https://api.hubapi.com/crm/v3/properties/companies/${encodeURIComponent(e.name)}`;
});

// Set HTML visualizer
pm.visualizer.set(
    `
    <style>
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }
      th, td {
        border: 1px solid #ddd;
        padding: 8px;
      }
      th {
        background-color: #f4f4f4;
        text-align: left;
      }
      .section {
        margin-bottom: 20px;
      }
      pre {
        background-color: #1e1e1e;
        color: #dcdcdc;
        padding: 10px;
        border-radius: 8px;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
    </style>
    <div class="section">
      <h3>Internal Names (comma-separated)</h3>
      <pre>{{objStr}}</pre>
    </div>

    <div class="section">
      <h3>Mapped Properties Table</h3>
      <table>
        <thead>
          <tr>
            <th>Internal Name</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          {{#each result}}
            <tr>
              <td>{{name}}</td>
              <td>{{label}}</td>
            </tr>
          {{/each}}
        </tbody>
      </table>
    </div>
    `,
    {
        internalName,
        result
    }
);
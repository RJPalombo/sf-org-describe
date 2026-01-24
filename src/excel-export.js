const ExcelJS = require('exceljs');

/**
 * Export object descriptions to Excel with one tab per object
 */
async function exportToExcel(objectDescriptions, filePath) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'SF Org Describe';
  workbook.created = new Date();

  for (const obj of objectDescriptions) {
    // Create worksheet (Excel tab names max 31 chars)
    const sheetName = obj.name.length > 31 ? obj.name.substring(0, 31) : obj.name;
    const worksheet = workbook.addWorksheet(sheetName);

    // Add object summary section
    addObjectSummary(worksheet, obj);

    // Add empty row
    worksheet.addRow([]);

    // Add fields table
    addFieldsTable(worksheet, obj);

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: false }, (cell) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = Math.min(Math.max(maxLength + 2, 12), 60);
    });
  }

  // Save file
  await workbook.xlsx.writeFile(filePath);
}

/**
 * Add object summary section to worksheet
 */
function addObjectSummary(worksheet, obj) {
  // Title row
  const titleRow = worksheet.addRow([obj.label + ' (' + obj.name + ')']);
  titleRow.font = { bold: true, size: 16 };
  titleRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1a1a2e' }
  };
  titleRow.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  worksheet.mergeCells(titleRow.number, 1, titleRow.number, 6);

  // Summary info
  const summaryData = [
    ['API Name', obj.name],
    ['Label', obj.label],
    ['Label (Plural)', obj.labelPlural || ''],
    ['Key Prefix', obj.keyPrefix || ''],
    ['Custom Object', obj.custom ? 'Yes' : 'No'],
    ['Queryable', obj.queryable ? 'Yes' : 'No'],
    ['Createable', obj.createable ? 'Yes' : 'No'],
    ['Updateable', obj.updateable ? 'Yes' : 'No'],
    ['Deletable', obj.deletable ? 'Yes' : 'No'],
    ['Searchable', obj.searchable ? 'Yes' : 'No'],
    ['Mergeable', obj.mergeable ? 'Yes' : 'No'],
    ['Replicateable', obj.replicateable ? 'Yes' : 'No'],
    ['Triggerable', obj.triggerable ? 'Yes' : 'No'],
    ['Feed Enabled', obj.feedEnabled ? 'Yes' : 'No'],
    ['MRU Enabled', obj.mruEnabled ? 'Yes' : 'No'],
    ['Has Subtypes', obj.hasSubtypes ? 'Yes' : 'No'],
    ['Is Subtype', obj.isSubtype ? 'Yes' : 'No'],
    ['Total Fields', obj.fields ? obj.fields.length : 0]
  ];

  summaryData.forEach(([key, value]) => {
    const row = worksheet.addRow([key, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFe8e8e8' }
    };
  });
}

/**
 * Add fields table to worksheet
 */
function addFieldsTable(worksheet, obj) {
  // Section header
  const sectionRow = worksheet.addRow(['FIELD DETAILS']);
  sectionRow.font = { bold: true, size: 14 };
  sectionRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4a4a6a' }
  };
  sectionRow.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  worksheet.mergeCells(sectionRow.number, 1, sectionRow.number, 15);

  // Column headers
  const headers = [
    'Field Name',
    'Label',
    'Type',
    'Length',
    'Precision',
    'Scale',
    'Required',
    'Unique',
    'External ID',
    'Custom',
    'Default Value',
    'Formula',
    'Description',
    'Help Text',
    'Picklist Values',
    'Reference To',
    'Relationship Name',
    'Createable',
    'Updateable',
    'Sortable',
    'Filterable',
    'Groupable',
    'Calculated',
    'Auto Number',
    'Case Sensitive',
    'Encrypted',
    'Name Field',
    'ID Lookup',
    'HTML Formatted',
    'Name Pointing',
    'Cascade Delete',
    'Restrict Delete',
    'Write Requires Master Read'
  ];

  const headerRow = worksheet.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2d2d4a' }
  };

  // Add field data
  if (obj.fields) {
    obj.fields.forEach(field => {
      const picklistValues = field.picklistValues
        ? field.picklistValues
          .filter(pv => pv.active)
          .map(pv => pv.value + (pv.defaultValue ? ' (default)' : ''))
          .join('\n')
        : '';

      const referenceTo = field.referenceTo ? field.referenceTo.join(', ') : '';

      const row = worksheet.addRow([
        field.name,
        field.label,
        field.type,
        field.length || '',
        field.precision || '',
        field.scale || '',
        field.nillable === false ? 'Yes' : 'No',
        field.unique ? 'Yes' : 'No',
        field.externalId ? 'Yes' : 'No',
        field.custom ? 'Yes' : 'No',
        field.defaultValue !== null ? String(field.defaultValue) : '',
        field.calculatedFormula || '',
        field.inlineHelpText || '',
        field.inlineHelpText || '',
        picklistValues,
        referenceTo,
        field.relationshipName || '',
        field.createable ? 'Yes' : 'No',
        field.updateable ? 'Yes' : 'No',
        field.sortable ? 'Yes' : 'No',
        field.filterable ? 'Yes' : 'No',
        field.groupable ? 'Yes' : 'No',
        field.calculated ? 'Yes' : 'No',
        field.autoNumber ? 'Yes' : 'No',
        field.caseSensitive ? 'Yes' : 'No',
        field.encrypted ? 'Yes' : 'No',
        field.nameField ? 'Yes' : 'No',
        field.idLookup ? 'Yes' : 'No',
        field.htmlFormatted ? 'Yes' : 'No',
        field.namePointing ? 'Yes' : 'No',
        field.cascadeDelete ? 'Yes' : 'No',
        field.restrictedDelete ? 'Yes' : 'No',
        field.writeRequiresMasterRead ? 'Yes' : 'No'
      ]);

      // Alternate row colors
      if (obj.fields.indexOf(field) % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF5F5F5' }
        };
      }

      // Wrap text for long cells
      row.getCell(13).alignment = { wrapText: true }; // Description
      row.getCell(14).alignment = { wrapText: true }; // Help text
      row.getCell(15).alignment = { wrapText: true }; // Picklist values
    });
  }

  // Add borders to the table
  const lastRowNum = worksheet.rowCount;
  const startRowNum = sectionRow.number;

  for (let i = startRowNum; i <= lastRowNum; i++) {
    const row = worksheet.getRow(i);
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
  }

  // Freeze header row
  worksheet.views = [
    { state: 'frozen', ySplit: headerRow.number }
  ];
}

module.exports = {
  exportToExcel
};

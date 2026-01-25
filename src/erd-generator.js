/**
 * ERD Generator - Creates Mermaid diagrams from Salesforce object relationships
 */

// Default limits (recommendations, not hard limits)
const DEFAULT_MAX_OBJECTS = 30;
const DEFAULT_MAX_FIELDS_PER_OBJECT = 8;

// Warning thresholds - above these, browser rendering may fail
const WARN_OBJECTS = 40;
const WARN_RELATIONSHIPS = 150;

/**
 * Generate ERD for selected objects with configurable depth
 * @param {Object} salesforce - Salesforce module instance
 * @param {string[]} rootObjects - Starting objects for the ERD
 * @param {number} maxDepth - How deep to traverse relationships (1-5)
 * @param {Object} options - { compact: boolean, maxObjects: number, selectedOnly: boolean }
 * @returns {Object} - { mermaidCode, objectsIncluded, relationships, truncated }
 */
async function generateERD(salesforce, rootObjects, maxDepth = 2, options = {}) {
  const maxObjects = options.maxObjects || null; // null = no limit
  const compact = options.compact || false;
  const selectedOnly = options.selectedOnly || false; // If true, only show selected objects (no traversal)
  const maxFieldsPerObject = options.maxFieldsPerObject || DEFAULT_MAX_FIELDS_PER_OBJECT;

  const processedObjects = new Set();
  const objectsToProcess = new Map(); // objectName -> depth
  const relationships = [];
  const objectDetails = new Map(); // objectName -> key fields for display
  let truncated = false;

  // Initialize with root objects at depth 0
  rootObjects.forEach(obj => objectsToProcess.set(obj, 0));

  // BFS to traverse relationships
  while (objectsToProcess.size > 0) {
    // Check if we've hit the object limit (if set)
    if (maxObjects && processedObjects.size >= maxObjects) {
      truncated = true;
      break;
    }

    // Get next object to process
    const [objectName, currentDepth] = objectsToProcess.entries().next().value;
    objectsToProcess.delete(objectName);

    // Skip if already processed
    if (processedObjects.has(objectName)) {
      continue;
    }

    // Skip system objects that clutter the diagram
    if (shouldSkipObject(objectName)) {
      continue;
    }

    try {
      const description = await salesforce.describeObject(objectName);
      processedObjects.add(objectName);

      // Store key fields for this object
      objectDetails.set(objectName, extractKeyFields(description));

      // Find related objects (respecting selectedOnly mode)
      const shouldTraverse = selectedOnly ? false : (currentDepth < maxDepth);

      for (const field of description.fields) {
        // Look for lookup and master-detail relationships
        if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0) {
          for (const relatedObject of field.referenceTo) {
            // Skip self-references and system objects
            if (relatedObject === objectName || shouldSkipObject(relatedObject)) {
              continue;
            }

            // In selectedOnly mode, only add relationship if target is in rootObjects
            if (selectedOnly && !rootObjects.includes(relatedObject)) {
              continue;
            }

            // Add relationship
            const relationshipType = field.relationshipName
              ? (field.cascadeDelete ? 'master-detail' : 'lookup')
              : 'lookup';

            relationships.push({
              from: objectName,
              to: relatedObject,
              field: field.name,
              fieldLabel: field.label,
              relationshipName: field.relationshipName,
              type: relationshipType,
              required: !field.nillable
            });

            // Queue related object for processing (only if traversal is enabled)
            if (shouldTraverse && !processedObjects.has(relatedObject) && !objectsToProcess.has(relatedObject)) {
              objectsToProcess.set(relatedObject, currentDepth + 1);
            }
          }
        }
      }

      // Also check child relationships and create relationship entries for them
      if (description.childRelationships) {
        for (const childRel of description.childRelationships) {
          if (childRel.childSObject && !shouldSkipObject(childRel.childSObject)) {
            // In selectedOnly mode, only add relationship if child is in rootObjects
            if (selectedOnly && !rootObjects.includes(childRel.childSObject)) {
              continue;
            }

            // Only add if it's a meaningful relationship
            if (childRel.relationshipName) {
              // Create relationship from child to parent (current object)
              // This ensures relationships are created even before child is processed
              relationships.push({
                from: childRel.childSObject,
                to: objectName,
                field: childRel.field,
                fieldLabel: childRel.field,
                relationshipName: childRel.relationshipName,
                type: childRel.cascadeDelete ? 'master-detail' : 'lookup',
                required: !childRel.restrictedDelete // If not restrictable, it's required
              });

              // Queue child object for processing (only if traversal is enabled)
              if (shouldTraverse && !processedObjects.has(childRel.childSObject) && !objectsToProcess.has(childRel.childSObject)) {
                objectsToProcess.set(childRel.childSObject, currentDepth + 1);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to describe ${objectName}:`, error.message);
      // Continue with other objects
    }
  }

  // Deduplicate relationships (we may have added from both parent and child sides)
  const relationshipMap = new Map();
  for (const rel of relationships) {
    // Create a canonical key regardless of direction
    const key = [rel.from, rel.to, rel.field].sort().join('|');
    if (!relationshipMap.has(key)) {
      relationshipMap.set(key, rel);
    }
  }
  const finalRelationships = Array.from(relationshipMap.values());

  // Check if diagram may be too large for browser rendering
  const mayExceedBrowserLimit = processedObjects.size > WARN_OBJECTS || relationships.length > WARN_RELATIONSHIPS;

  // Generate Mermaid code
  const mermaidCode = generateMermaidCode(objectDetails, finalRelationships, compact, maxFieldsPerObject);

  return {
    mermaidCode,
    objectsIncluded: Array.from(processedObjects),
    relationshipCount: finalRelationships.length,
    truncated,
    mayExceedBrowserLimit,
    totalObjectsFound: processedObjects.size + objectsToProcess.size
  };
}

/**
 * Check if an object should be skipped (system objects that clutter diagrams)
 */
function shouldSkipObject(objectName) {
  const skipPatterns = [
    /^.*History$/,
    /^.*Feed$/,
    /^.*Share$/,
    /^.*Tag$/,
    /^.*ChangeEvent$/,
    /^.*__mdt$/,  // Custom metadata
    /^.*__e$/,    // Platform events
    /^.*__x$/,    // External objects
    /^ContentDocument/,
    /^ContentVersion/,
    /^FeedItem/,
    /^FeedComment/,
    /^RecordType$/,
    /^BusinessHours$/,
    /^Organization$/,
    /^Profile$/,
    /^UserRole$/,
    /^Group$/,
    /^GroupMember$/,
    /^PermissionSet/,
    /^SetupAuditTrail$/,
    /^LoginHistory$/,
    /^ApexClass$/,
    /^ApexTrigger$/,
    /^ApexPage$/,
    /^ApexComponent$/,
    /^StaticResource$/,
    /^Document$/,
    /^Folder$/,
    /^EmailTemplate$/,
    /^Attachment$/,
    /^Note$/,
    /^CombinedAttachment$/,
    /^NoteAndAttachment$/,
    /^ProcessInstance/,
    /^UserRecordAccess$/,
    /^EntitySubscription$/,
    /^TopicAssignment$/,
    /^CollaborationGroup/,
    /^Idea$/,
    /^Vote$/,
    /^IdeaComment$/
  ];

  return skipPatterns.some(pattern => pattern.test(objectName));
}

/**
 * Extract key fields for display in the ERD
 */
function extractKeyFields(description) {
  const keyFields = [];

  for (const field of description.fields) {
    // Include ID field
    if (field.name === 'Id') {
      keyFields.push({ name: 'Id', type: 'id', isPK: true });
      continue;
    }

    // Include Name field
    if (field.nameField) {
      keyFields.push({ name: field.name, type: field.type, isName: true });
      continue;
    }

    // Include lookup/master-detail fields (foreign keys)
    if (field.type === 'reference' && field.referenceTo && field.referenceTo.length > 0) {
      if (!shouldSkipObject(field.referenceTo[0])) {
        keyFields.push({
          name: field.name,
          type: 'reference',
          referenceTo: field.referenceTo[0],
          isFK: true,
          required: !field.nillable
        });
      }
    }
  }

  return {
    name: description.name,
    label: description.label,
    custom: description.custom,
    fields: keyFields
  };
}

/**
 * Generate Mermaid ER diagram code
 */
function generateMermaidCode(objectDetails, relationships, compact = false, maxFieldsPerObject = 8) {
  let code = 'erDiagram\n';

  // Add entity definitions with their key fields
  for (const [objName, details] of objectDetails) {
    const safeName = sanitizeName(objName);

    if (compact) {
      // Compact mode: just entity names, no fields
      code += `    ${safeName}\n`;
    } else {
      code += `    ${safeName} {\n`;

      // Limit fields per object
      const fieldsToShow = details.fields.slice(0, maxFieldsPerObject);

      for (const field of fieldsToShow) {
        let fieldType = mapFieldType(field.type);
        let fieldName = sanitizeName(field.name);
        let attributes = [];

        if (field.isPK) attributes.push('PK');
        if (field.isFK) attributes.push('FK');
        if (field.required) attributes.push('required');

        const attrStr = attributes.length > 0 ? ` "${attributes.join(', ')}"` : '';
        code += `        ${fieldType} ${fieldName}${attrStr}\n`;
      }

      code += `    }\n`;
    }
  }

  code += '\n';

  // Add relationships
  const addedRelationships = new Set();

  for (const rel of relationships) {
    // Only add if both objects are in our diagram
    if (!objectDetails.has(rel.from) || !objectDetails.has(rel.to)) {
      continue;
    }

    const fromName = sanitizeName(rel.from);
    const toName = sanitizeName(rel.to);

    // Create unique key for relationship to avoid duplicates
    const relKey = `${fromName}-${toName}-${rel.field}`;
    if (addedRelationships.has(relKey)) {
      continue;
    }
    addedRelationships.add(relKey);

    // Determine cardinality symbols
    // Mermaid: ||--o{ means "exactly one to zero or more"
    // |o--o{ means "zero or one to zero or more"
    let leftCardinality = rel.required ? '||' : '|o';
    let rightCardinality = rel.type === 'master-detail' ? '|{' : 'o{';

    const label = rel.relationshipName || rel.field.replace('Id', '');

    code += `    ${toName} ${leftCardinality}--${rightCardinality} ${fromName} : "${label}"\n`;
  }

  return code;
}

/**
 * Sanitize name for Mermaid (remove special characters)
 */
function sanitizeName(name) {
  // Mermaid entity names should be alphanumeric
  // Replace __c and other special chars
  return name.replace(/__c$/, '_c').replace(/__/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Map Salesforce field types to simple types for display
 */
function mapFieldType(sfType) {
  const typeMap = {
    'id': 'string',
    'reference': 'string',
    'string': 'string',
    'textarea': 'string',
    'url': 'string',
    'email': 'string',
    'phone': 'string',
    'picklist': 'string',
    'multipicklist': 'string',
    'combobox': 'string',
    'boolean': 'boolean',
    'int': 'int',
    'double': 'double',
    'currency': 'currency',
    'percent': 'percent',
    'date': 'date',
    'datetime': 'datetime',
    'time': 'time',
    'base64': 'blob',
    'address': 'address',
    'location': 'location',
    'encryptedstring': 'string'
  };

  return typeMap[sfType] || 'string';
}

module.exports = {
  generateERD
};

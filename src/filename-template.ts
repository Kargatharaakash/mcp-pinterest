/**
 * Filename template processing module
 * Responsible for parsing and applying custom filename templates.
 */
import path from 'node:path';

// List of supported template variables
const SUPPORTED_VARIABLES = ['imageId', 'fileExtension', 'timestamp', 'index'];

// Default filename template
export const DEFAULT_FILENAME_TEMPLATE = 'pinterest_{imageId}.{fileExtension}';

/**
 * Validate the validity of a filename template
 * @param template Filename template string
 * @returns Validation result object {isValid: boolean, error?: string}
 */
export function validateTemplate(template: string): { isValid: boolean; error?: string } {
  if (!template || typeof template !== 'string') {
    return { isValid: false, error: 'Template cannot be empty' };
  }

  // Check if brackets match
  const openBrackets = (template.match(/\{/g) || []).length;
  const closeBrackets = (template.match(/\}/g) || []).length;
  if (openBrackets !== closeBrackets) {
    return { isValid: false, error: 'Unmatched brackets in template' };
  }

  // Extract variables from template
  const variables = extractVariables(template);
  
  // Verify if variables are supported
  for (const variable of variables) {
    if (!SUPPORTED_VARIABLES.includes(variable.toLowerCase())) {
      return { 
        isValid: false, 
        error: `Unsupported variable: ${variable}. Supported variables are: ${SUPPORTED_VARIABLES.join(', ')}` 
      };
    }
  }

  return { isValid: true };
}

/**
 * Extract variable names from template
 * @param template Filename template string
 * @returns Array of variable names
 */
function extractVariables(template: string): string[] {
  const regex = /\{([^{}]+)\}/g;
  const variables: string[] = [];
  let match: RegExpExecArray | null = null;

  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(template)) !== null) {
    variables.push(match[1]);
  }

  return variables;
}

/**
 * Sanitize filename by removing or replacing invalid characters
 * @param fileName Raw filename
 * @returns Sanitized filename
 */
export function sanitizeFileName(fileName: string): string {
  // Replace invalid filename characters for Windows and Unix systems
  return fileName
    .replace(/[/\\:*?"<>|]/g, '_') // Replace common illegal characters with underscores
    .replace(/\s+/g, '_')          // Replace whitespace with underscores
    .replace(/_{2,}/g, '_')        // Consolidate consecutive underscores
    .trim();
}

/**
 * Generate filename based on template
 * @param template Filename template string
 * @param variables Variable values object
 * @returns Generated filename
 */
export function generateFileName(
  template: string, 
  variables: { 
    imageId: string, 
    fileExtension: string, 
    timestamp?: string, 
    index?: number 
  }
): string {
  // Generate UTC timestamp using current time if needed
  if (template.includes('{timestamp}') && !variables.timestamp) {
    const now = new Date();
    variables.timestamp = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
      String(now.getUTCHours()).padStart(2, '0'),
      String(now.getUTCMinutes()).padStart(2, '0'),
      String(now.getUTCSeconds()).padStart(2, '0')
    ].join('');
  }

  // Replace template variables
  let fileName = template;
  for (const [key, value] of Object.entries(variables)) {
    // Case-insensitive replacement
    const regex = new RegExp(`\\{${key}\\}`, 'i');
    fileName = fileName.replace(regex, String(value));
  }

  // Sanitize filename
  return sanitizeFileName(fileName);
}
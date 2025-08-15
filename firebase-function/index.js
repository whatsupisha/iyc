// Main index.js file that exports all Firebase functions
const { submitForm } = require('./submitForm');
const { checkWorkflow } = require('./checkWorkflow');
const { submitComment } = require('./submitComment');
const { deleteContent } = require('./deleteContent');

// Export all functions
exports.checkWorkflow = checkWorkflow;
exports.deleteContent = deleteContent;
exports.submitForm = submitForm;
exports.submitComment = submitComment;

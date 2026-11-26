import { CHANGE_OPERATIONS } from './plan-contract.js?v=20261126-reorg-intensity-confirm-v1';

const questionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' }, text: { type: 'string' },
    options: { type: 'array', maxItems: 4, items: {
      type: 'object', additionalProperties: false,
      properties: { id: { type: 'string' }, label: { type: 'string' } },
      required: ['id', 'label']
    } }
  },
  required: ['id', 'text', 'options']
};

const unsupportedPartSchema = {
  type: 'object', additionalProperties: false,
  properties: { description: { type: 'string' }, reason: { type: 'string' } },
  required: ['description', 'reason']
};

export const PLAN_RESPONSE_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_clarification', 'partially_supported', 'unsupported'] },
    taskType: { type: 'string', enum: ['read_only', 'change', 'mixed'] },
    structureMode: { type: 'string', enum: ['existing', 'design'] },
    reorganizationStyle: { type: 'string', enum: ['not_applicable', 'undetermined', 'targeted_adjustment', 'rebuild_subclasses'] },
    summary: { type: 'string' },
    executionBrief: {
      type: 'object', additionalProperties: false,
      properties: {
        objective: { type: 'string' },
        successCriteria: { type: 'array', items: { type: 'string' } },
        expectedResult: { type: 'string' }
      },
      required: ['objective', 'successCriteria', 'expectedResult']
    },
    steps: { type: 'array', items: { type: 'string' } },
    dataNeeds: {
      type: 'object', additionalProperties: false,
      properties: {
        hierarchyIndex: { type: 'boolean' },
        selectedClassDetails: { type: 'boolean' },
        parentContext: { type: 'string', enum: ['none', 'direct_parent', 'ancestor_chain'] },
        instanceContext: { type: 'string', enum: ['none', 'membership_summary', 'instance_content'] }
      },
      required: ['hierarchyIndex', 'selectedClassDetails', 'parentContext', 'instanceContext']
    },
    scopeNeeds: {
      type: 'object', additionalProperties: false,
      properties: {
        referenceBeyondSelection: { type: 'boolean' },
        changeBeyondSelection: { type: 'boolean' }
      },
      required: ['referenceBeyondSelection', 'changeBeyondSelection']
    },
    changeOperations: { type: 'array', items: { type: 'string', enum: [...CHANGE_OPERATIONS] } },
    questions: { type: 'array', items: questionSchema },
    unsupportedParts: { type: 'array', items: unsupportedPartSchema }
  },
  required: ['status', 'taskType', 'structureMode', 'reorganizationStyle', 'summary', 'executionBrief', 'steps', 'dataNeeds', 'scopeNeeds', 'changeOperations', 'questions', 'unsupportedParts']
});

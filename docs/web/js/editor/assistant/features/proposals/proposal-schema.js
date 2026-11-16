const classReference = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['existing_class', 'temporary_class'] },
    classId: { type: ['string', 'null'] },
    tempId: { type: ['string', 'null'] }
  },
  required: ['kind', 'classId', 'tempId']
};

const parentReference = { anyOf: [classReference, { type: 'null' }] };
const optionalClassReference = { anyOf: [classReference, { type: 'null' }] };

export const PROPOSAL_RESPONSE_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  properties: {
    message: { type: 'string' },
    proposals: {
      type: 'array', maxItems: 20, items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          reason: { type: 'string' },
          uncertainties: { type: 'array', items: { type: 'string' }, maxItems: 8 },
          questions: { type: 'array', items: {
            type: 'object', additionalProperties: false,
            properties: { id: { type: 'string' }, text: { type: 'string' } },
            required: ['id', 'text']
          }, maxItems: 5 },
          operations: { type: 'array', maxItems: 100, items: {
            type: 'object', additionalProperties: false,
            properties: {
              type: { type: 'string', enum: [
                'move_target_class', 'move_middle_class', 'move_top_class', 'promote_middle_class',
                'delete_middle_class', 'delete_top_class', 'add_top_class', 'add_middle_class',
                'rename_top_class', 'rename_middle_class', 'rename_target_class'
              ] },
              target: optionalClassReference,
              newParent: parentReference,
              tempId: { type: ['string', 'null'] },
              label: { type: ['string', 'null'] }
            },
            required: ['type', 'target', 'newParent', 'tempId', 'label']
          } }
        },
        required: ['id', 'title', 'summary', 'reason', 'uncertainties', 'questions', 'operations']
      }
    },
    alternativeGroups: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false,
      properties: { id: { type: 'string' }, proposalIds: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } } },
      required: ['id', 'proposalIds']
    } }
  },
  required: ['message', 'proposals', 'alternativeGroups']
});

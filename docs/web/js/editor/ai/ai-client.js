// OpenAI Responses APIへの通信だけを担当します。会話状態やUIには触れず、
// HTTPエラーを画面に出せる日本語メッセージへ変換します。
const API_URL = 'https://api.openai.com/v1/responses';

  const formatHttpError = (body, response) => {
    const apiMessage = body?.error?.message;
    if (response.status === 401) return 'APIキーを確認してください。認証に失敗しました。';
    if (response.status === 429) return 'APIの利用上限またはレート制限に達しました。時間をおいて再依頼してください。';
    if (/exceeds the context window/i.test(apiMessage || '')) {
      return 'この相談の履歴と対象範囲がモデルの入力上限を超えました。新しい相談を始めるか、上位クラス配下をさらに小さい範囲に分けてください。';
    }
    if (response.status === 400 && apiMessage) return `依頼を送信できませんでした: ${apiMessage}`;
    return apiMessage || `OpenAI APIへの接続に失敗しました（HTTP ${response.status}）。`;
  };

export const sendOpenAIRequest = async ({ apiKey, body, signal }) => {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(formatHttpError(responseBody, response));
    return responseBody;
};

// クラスIDを依頼ごとに短い別名へ置き換え、応答に含まれる別名を元のIDへ戻します。
// 別名は現在のクラス一覧から作るため、別の依頼やデータ版へ持ち越してはいけません。
export const createClassIdCodec = (classes) => {
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const counts = { top: 0, middle: 0, class: 0 };
    const prefixes = { top: 't', middle: 'm', class: 'c' };
    const idToAlias = new Map();
    const aliasToId = new Map();
    const uriPrefixes = new Set();
    const plainIds = [];

    classes.forEach((item) => {
      const type = Object.hasOwn(prefixes, item.type) ? item.type : 'class';
      // t_0 is the stable ID for the uncategorized top class, not a positional alias.
      const isUncategorizedTop = type === 'top' && /(?:^|\/)t_0$/.test(item.id);
      const alias = isUncategorizedTop ? 't_0' : `${prefixes[type]}_${++counts[type]}`;
      idToAlias.set(item.id, alias);
      aliasToId.set(alias, item.id);
      if (/^https?:\/\//i.test(item.id)) {
        uriPrefixes.add(item.id.slice(0, item.id.lastIndexOf('/') + 1));
      } else {
        plainIds.push(item.id);
      }
    });

    const uriPatterns = [...uriPrefixes]
      .sort((left, right) => right.length - left.length)
      .map((prefix) => new RegExp(`${escapeRegExp(prefix)}[A-Za-z0-9._~-]+`, 'g'));
    const plainIdPattern = plainIds.length
      ? new RegExp(`(^|[^A-Za-z0-9_])(${plainIds.sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?=$|[^A-Za-z0-9_])`, 'g')
      : null;

    const shortenString = (value) => {
      let result = value;
      uriPatterns.forEach((pattern) => {
        result = result.replace(pattern, (id) => idToAlias.get(id) || id);
      });
      if (plainIdPattern) {
        result = result.replace(plainIdPattern, (match, boundary, id) => `${boundary}${idToAlias.get(id) || id}`);
      }
      return result;
    };
    const shortenValue = (value) => idToAlias.get(value) || value;
    const replace = (value) => {
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [shortenValue(key), replace(item)]));
      }
      return typeof value === 'string' ? shortenString(shortenValue(value)) : value;
    };

    return {
      alias: shortenValue,
      restore: (value) => aliasToId.get(value) || value,
      shortenText: (serialized) => {
        try { return JSON.stringify(replace(JSON.parse(serialized))); }
        catch { return shortenString(serialized); }
      }
    };
};

// OpenAI Responses APIの短縮JSONスキーマと、内部形式への変換を担当します。
export const createResponseFormat = (AI_OUTPUT_LIMITS) => {
  const compactOperationSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      t: { type: 'string', enum: ['a', 'r', 'm', 'mc', 'p', 'd'] },
      ct: { type: ['string', 'null'], enum: ['top', 'middle', null] },
      tmp: { type: ['string', 'null'] }, l: { type: ['string', 'null'] },
      p: { type: ['string', 'null'] }, c: { type: ['string', 'null'] },
      dst: { type: ['string', 'null'] }, f: { type: ['string', 'null'] }, to: { type: ['string', 'null'] }
    },
    required: ['t', 'ct', 'tmp', 'l', 'p', 'c', 'dst', 'f', 'to']
  };
  const responseSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      m: { type: 'string' },
      p: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: {
            i: { type: 'string' }, t: { type: 'string' }, s: { type: 'string' }, r: { type: 'string' },
            q: { type: 'array', maxItems: AI_OUTPUT_LIMITS.questions, items: { type: 'string' } },
            u: { type: 'array', maxItems: AI_OUTPUT_LIMITS.uncertaintiesPerProposal, items: { type: 'string' } },
            o: { type: 'array', maxItems: AI_OUTPUT_LIMITS.operationsPerProposal, items: compactOperationSchema }
          },
          required: ['i', 't', 's', 'r', 'q', 'u', 'o']
        }, maxItems: AI_OUTPUT_LIMITS.proposals
      },
      q: { type: 'array', maxItems: AI_OUTPUT_LIMITS.questions, items: { type: 'string' } }
    },
    required: ['m', 'p', 'q']
  };
  const crossScopeCoverageSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      batchId: { type: 'string' },
      evaluatedEditableCount: { type: 'integer', minimum: 0 },
      reviewedHierarchyCount: { type: 'integer', minimum: 0 },
      unassessedEditableCount: { type: 'integer', minimum: 0 }
    },
    required: ['batchId', 'evaluatedEditableCount', 'reviewedHierarchyCount', 'unassessedEditableCount']
  };
  const crossScopeResponseSchema = {
    ...responseSchema,
    properties: { ...responseSchema.properties, x: crossScopeCoverageSchema },
    required: [...responseSchema.required, 'x']
  };
  const compactResponseInstructions = '応答は短縮キーのJSON形式です。トップレベルはm=回答文、p=提案配列、q=確認質問配列です。提案はi=id,t=題名,s=要約,r=理由,q=質問,u=不確実点,o=操作配列。操作キーはt=操作種別コード(a=addClass,r=renameClass,m=moveClass,mc=moveChildren,p=promoteClass,d=deleteClass)、ct=classType,tmp=temporaryId,l=label,p=parentId,c=classId,dst=destinationId,f=from,to=toです。スキーマにある全キーを必ず出力し、使わない値はnullにしてください。';
  const groupedResponseSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      g: {
        type: 'array', maxItems: 20, items: {
          type: 'object', additionalProperties: false,
          properties: { k: { type: 'string' }, m: { type: 'string' }, p: responseSchema.properties.p, q: responseSchema.properties.q },
          required: ['k', 'm', 'p', 'q']
        }
      }
    },
    required: ['g']
  };
  const comparisonFindingSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      text: { type: 'string' },
      requiredScopes: { type: 'array', items: { type: 'string' }, maxItems: 100 },
      assessedScopes: { type: 'array', items: { type: 'string' }, maxItems: 100 },
      classes: {
        type: 'array', maxItems: 8, items: {
          type: 'object', additionalProperties: false,
          properties: { id: { type: 'string' }, name: { type: 'string' } },
          required: ['id', 'name']
        }
      },
      evidence: { type: 'string' },
      limitations: { type: 'string' }
    },
    required: ['text', 'requiredScopes', 'assessedScopes', 'classes', 'evidence', 'limitations']
  };
  const comparisonCategorySchema = {
    type: 'object', additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['comparable', 'insufficient'] },
      requiredScopes: { type: 'array', items: { type: 'string' }, maxItems: 100 },
      assessedScopes: { type: 'array', items: { type: 'string' }, maxItems: 100 },
      unassessedScopes: { type: 'array', items: { type: 'string' }, maxItems: 100 },
      findings: { type: 'array', items: comparisonFindingSchema, maxItems: AI_OUTPUT_LIMITS.comparisonFindingsPerCategory },
      limitation: { type: 'string' }
    },
    required: ['status', 'requiredScopes', 'assessedScopes', 'unassessedScopes', 'findings', 'limitation']
  };
  const localFindingSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      text: { type: 'string' },
      classes: {
        type: 'array', maxItems: 4, items: comparisonFindingSchema.properties.classes.items
      },
      evidence: { type: 'string' },
      limitations: { type: 'string' }
    },
    required: ['text', 'classes', 'evidence', 'limitations']
  };
  const chunkComparisonCategorySchema = {
    type: 'object', additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['findings', 'none', 'insufficient'] },
      findings: { type: 'array', items: localFindingSchema, maxItems: AI_OUTPUT_LIMITS.chunkFindingsPerCategory },
      limitation: { type: 'string' }
    },
    required: ['status', 'findings', 'limitation']
  };
  const chunkComparisonSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      duplicates: chunkComparisonCategorySchema,
      imbalance: chunkComparisonCategorySchema,
      gaps: chunkComparisonCategorySchema,
      other: chunkComparisonCategorySchema
    },
    required: ['duplicates', 'imbalance', 'gaps', 'other']
  };
  const responseWithChunkComparisonSchema = {
    ...responseSchema,
    properties: { ...responseSchema.properties, c: chunkComparisonSchema, h: { type: 'array', items: { type: 'string' } } },
    required: [...responseSchema.required, 'c', 'h']
  };
  const comparisonSummaryResponseSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      m: { type: 'string' },
      c: {
        type: 'object', additionalProperties: false,
        properties: {
          duplicates: comparisonCategorySchema,
          imbalance: comparisonCategorySchema,
          gaps: comparisonCategorySchema,
          other: comparisonCategorySchema
        },
        required: ['duplicates', 'imbalance', 'gaps', 'other']
      }
    },
    required: ['m', 'c']
  };
  const summaryResponseSchema = {
    type: 'object', additionalProperties: false,
    properties: { m: { type: 'string' } },
    required: ['m']
  };
  const chunkGroupedResponseSchema = {
    ...groupedResponseSchema,
    properties: {
      g: {
        ...groupedResponseSchema.properties.g,
        items: {
          ...groupedResponseSchema.properties.g.items,
          properties: { ...groupedResponseSchema.properties.g.items.properties, c: chunkComparisonSchema,
            h: { type: 'array', items: { type: 'string' } } },
          required: [...groupedResponseSchema.properties.g.items.required, 'c', 'h']
        }
      }
    }
  };
  const compactGroupedResponseInstructions = `${compactResponseInstructions.replace('トップレベルはm=回答文、p=提案配列、q=確認質問配列です。', 'トップレベルはg=上位クラス別回答配列です。各回答はk=入力analysisGroupsのkey、m=回答文、p=提案配列、q=確認質問配列です。')} 各analysisGroups.keyをちょうど1回ずつ返し、異なるグループの変更案を混ぜないでください。`;

  const readResponseText = (response) => {
    if (typeof response.output_text === 'string') return response.output_text;
    for (const item of response.output || []) {
      for (const content of item.content || []) {
        if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
      }
    }
    throw new Error('AIから読み取れるテキストが返りませんでした。もう一度依頼してください。');
  };
  const expandCompactResponse = (wire) => {
    const operationTypes = { a: 'addClass', r: 'renameClass', m: 'moveClass', mc: 'moveChildren', p: 'promoteClass', d: 'deleteClass' };
    return {
      message: wire.m,
      proposals: wire.p.map((proposal) => ({
        id: proposal.i, title: proposal.t, summary: proposal.s, reason: proposal.r,
        questions: proposal.q, uncertainties: proposal.u,
        operations: proposal.o.map((operation) => ({
          type: operationTypes[operation.t], classType: operation.ct, temporaryId: operation.tmp,
          label: operation.l, parentId: operation.p, classId: operation.c,
          destinationId: operation.dst, from: operation.f, to: operation.to
        }))
      })),
      questions: wire.q,
      comparison: wire.c,
      crossScopeCandidateIds: Array.isArray(wire.h) ? wire.h : [],
      dataRequests: []
    };
  };
  const parseAIResponse = (response, grouped = false, summaryOnly = false, chunked = false, comparisonSynthesis = false, crossScopeOperation = false) => {
    if (response.status === 'incomplete') {
      const reason = response.incomplete_details?.reason;
      if (reason === 'max_output_tokens') {
        throw new Error('AIの返答が出力上限に達して途中で終わりました。確認事項への回答は保持されています。選択範囲を小さくして、もう一度送信してください。');
      }
      throw new Error('AIの返答が完了しなかったため、変更案を読み取れませんでした。確認事項への回答は保持されています。もう一度送信してください。');
    }
    try {
      const wire = JSON.parse(readResponseText(response));
      if (summaryOnly) {
        if (comparisonSynthesis && !wire.c) throw new Error('統合結果のカテゴリ別比較が不足しています。');
        return { message: wire.m, comparison: wire.c, proposals: [], questions: [], dataRequests: [] };
      }
      if (chunked && (grouped ? wire.g.some((item) => !item.c || !Array.isArray(item.h))
        : !wire.c || !Array.isArray(wire.h))) {
        throw new Error('分割評価のカテゴリ別判定が不足しています。');
      }
      if (crossScopeOperation) {
        if (!wire.x) throw new Error('横断操作の評価範囲情報が不足しています。');
        return { ...expandCompactResponse(wire), crossScopeCoverage: wire.x };
      }
      return grouped
        ? { groups: wire.g.map((item) => ({ key: item.k, ...expandCompactResponse({ m: item.m, p: item.p, q: item.q, c: item.c, h: item.h }) })) }
        : expandCompactResponse(wire);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('AIの返答形式が不完全で、変更案を読み取れませんでした。確認事項への回答は保持されています。依頼を短くするか、選択範囲を小さくしてもう一度送信してください。');
      }
      throw error;
    }
  };

  const updateOutputLimits = () => {
    responseSchema.properties.p.maxItems = AI_OUTPUT_LIMITS.proposals;
    responseSchema.properties.q.maxItems = AI_OUTPUT_LIMITS.questions;
    responseSchema.properties.p.items.properties.q.maxItems = AI_OUTPUT_LIMITS.questions;
    responseSchema.properties.p.items.properties.u.maxItems = AI_OUTPUT_LIMITS.uncertaintiesPerProposal;
    responseSchema.properties.p.items.properties.o.maxItems = AI_OUTPUT_LIMITS.operationsPerProposal;
    comparisonCategorySchema.properties.findings.maxItems = AI_OUTPUT_LIMITS.comparisonFindingsPerCategory;
    chunkComparisonCategorySchema.properties.findings.maxItems = AI_OUTPUT_LIMITS.chunkFindingsPerCategory;
  };

  return {
    responseSchema,
    responseWithChunkComparisonSchema,
    crossScopeResponseSchema,
    crossScopeOperationInstructions: '横断操作ステージです。応答トップレベルx.batchIdには入力crossScopeBatch.idをそのまま返してください。evaluatedEditableCountにはcrossScopeBatch.expectedEditableCount、reviewedHierarchyCountにはcrossScopeBatch.expectedHierarchyCountと一致する確認件数、unassessedEditableCountには未確認対象の件数を整数で返してください。ID一覧は返しません。',
    groupedResponseSchema,
    chunkGroupedResponseSchema,
    summaryResponseSchema,
    comparisonSummaryResponseSchema,
    updateOutputLimits,
    getChunkComparisonInstructions: () => `分割評価では通常応答のトップレベル、analysisGroups応答では各g要素にcとhを必ず出してください。cにはduplicates、imbalance、gaps、otherの全カテゴリを含めます。各statusはfindings（所見あり）、none（十分に確認して所見なし）、insufficient（情報不足）です。未記入や形式不正をnoneにせず、各所見には少なくとも一つの入力済みクラスID・名称と具体的な根拠を示し、各カテゴリ最大${AI_OUTPUT_LIMITS.chunkFindingsPerCategory}件に絞ってください。件数が入力されていない偏りは判断不能としてください。hは追加の横断確認候補IDの配列です。入力指示で候補抽出を求められていない場合や評価モードでは空配列を返してください.`,
    getComparisonSynthesisInstructions: () => `JSON形式でmに統合回答、cにカテゴリ別の横断比較を返してください。入力のcomparisonRequirementsにある各カテゴリの必須範囲をrequiredScopesに正確に反映し、実際に判定できた範囲をassessedScopes、未判定範囲をunassessedScopesに分けます。cはduplicates=重複候補、imbalance=分類の偏り、gaps=分類漏れ・孤立、other=その他です。各カテゴリはstatus=comparableまたはinsufficient、requiredScopes、assessedScopes、unassessedScopes、findings、limitationを返します。所見ごとにもrequiredScopesとassessedScopesを分け、必要なチャンクが不足しても、必要・判定済み範囲が揃った局所所見は残します。所見がない場合findingsは空配列にし、判断できない場合はinsufficientとして理由を記します。所見ごとにクラスID・名称、根拠、限界を返してください。各カテゴリの所見は重要なものを最大${AI_OUTPUT_LIMITS.comparisonFindingsPerCategory}件に絞り、入力にない事実や確信度を作らないでください.`,
    chunkCrossScopeCandidateInstructions: '通常応答ではトップレベル、analysisGroups応答では各g要素のhに、今回の入力範囲で変更可能な対象クラスのIDだけを入れてください。別上位クラス配下への所属変更を追加確認する候補として、現在の所属に明確なずれがある対象に加え、別の上位・中間クラスにも具体的に関連しそうな対象を広めに選びます。移動先を断定できなくても、具体的な別分類先の可能性があれば候補に含めてください。候補IDは追加確認の優先度順に並べ、件数で切り捨てないでください。判断不能というだけで具体的な別分類先が考えられない対象は除外します。候補抽出を求められていない場合や評価モードでは空配列を返してください。',
    compactResponseInstructions,
    compactGroupedResponseInstructions,
    parseAIResponse
  };
};


// Responses APIのリクエスト構築と応答の受け渡しを担当します。
// 進捗表示・使用量更新・会話状態は呼び出し側から渡します。
export const createResponsesClient = ({ responseFormat, digest, shortenInputIds, createIdCodec, maxInputCharacters = 48000, getMaxInputCharacters = () => maxInputCharacters }) => ({
  async send(input, {
    apiKey,
    model,
    systemPrompt,
    previousResponseId = '',
    maxOutputTokens,
    stage,
    grouped = false,
    summaryOnly = false,
    comparisonSynthesis = false,
    promptOverride = '',
    signal,
    onStage = () => {},
    onUsage = () => {}
  }) {
    const requestPayload = JSON.parse(input);
    const chunked = requestPayload.scopeCoverage === 'all_classes_chunk' || requestPayload.chunkedAnalysis === true;
    const crossScopeCandidateMode = requestPayload.crossScopeCandidateMode === true;
    const crossScopeOperation = requestPayload.operationStage === 'cross_scope_operation_synthesis';
    const requestPolicies = ['instruction', 'proposalPolicy', 'responsePolicy']
      .map((key) => typeof requestPayload[key] === 'string' ? requestPayload[key].trim() : '')
      .filter(Boolean);
    ['instruction', 'proposalPolicy', 'responsePolicy', 'crossScopeCandidateMode'].forEach((key) => { delete requestPayload[key]; });
    const apiInput = summaryOnly ? JSON.stringify(requestPayload) : shortenInputIds(JSON.stringify(requestPayload));
    const formatInstructions = summaryOnly
      ? comparisonSynthesis
        ? responseFormat.getComparisonSynthesisInstructions()
        : 'JSON形式でmキーに受領確認などの短い返答だけを返してください。'
      : crossScopeOperation
        ? `${responseFormat.compactResponseInstructions} ${responseFormat.crossScopeOperationInstructions}`
        : chunked
          ? `${grouped ? responseFormat.compactGroupedResponseInstructions : responseFormat.compactResponseInstructions} ${responseFormat.getChunkComparisonInstructions()}${crossScopeCandidateMode ? ` ${responseFormat.chunkCrossScopeCandidateInstructions}` : ''}`
          : grouped ? responseFormat.compactGroupedResponseInstructions : responseFormat.compactResponseInstructions;
    const instructions = [promptOverride || systemPrompt, formatInstructions, ...requestPolicies].join('\n\n');
    const inputCharacterCount = instructions.length + apiInput.length;
    const inputLimit = Math.max(1, Math.floor(Number(getMaxInputCharacters()) || maxInputCharacters));
    if (inputCharacterCount > inputLimit) {
      throw new Error(`プロンプト・依頼データを含む送信入力が上限を超えました（${inputCharacterCount.toLocaleString()} / ${inputLimit.toLocaleString()}文字）。範囲を小さくして再依頼してください。過去の応答IDに含まれる会話履歴はこの文字数に含まれません。`);
    }
    const promptCacheKey = `class-editor-ai-${(await digest(`${model}\n${instructions}`)).slice(0, 48)}`;
    const body = {
      model,
      reasoning: { effort: 'low' },
      instructions,
      input: apiInput,
      text: { format: {
        type: 'json_schema',
        name: summaryOnly ? comparisonSynthesis ? 'class_edit_comparison_summary' : 'class_edit_summary' : crossScopeOperation ? 'class_edit_cross_scope_operations' : chunked ? 'class_edit_chunk_results' : grouped ? 'class_edit_group_results' : 'class_edit_proposals',
        strict: true,
        schema: summaryOnly
          ? comparisonSynthesis ? responseFormat.comparisonSummaryResponseSchema : responseFormat.summaryResponseSchema
          : crossScopeOperation ? responseFormat.crossScopeResponseSchema
          : chunked && grouped ? responseFormat.chunkGroupedResponseSchema
          : chunked ? responseFormat.responseWithChunkComparisonSchema
          : grouped ? responseFormat.groupedResponseSchema : responseFormat.responseSchema
      } },
      max_output_tokens: maxOutputTokens,
      prompt_cache_key: promptCacheKey,
      store: true
    };
    if (previousResponseId) body.previous_response_id = previousResponseId;

    onStage(stage);
    const responseBody = await sendOpenAIRequest({ apiKey, body, signal });
    onUsage(responseBody);
    onStage('回答処理中');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const result = responseFormat.parseAIResponse(responseBody, grouped, summaryOnly, chunked, comparisonSynthesis, crossScopeOperation);
    const restoreId = createIdCodec().restore;
    const responseGroups = grouped ? result.groups : [result];
    responseGroups.forEach((group) => {
      (group.dataRequests || []).forEach((request) => { if (request.classId) request.classId = restoreId(request.classId); });
      Object.values(group.comparison || {}).forEach((category) => (category.findings || []).forEach((finding) => {
        (finding.classes || []).forEach((item) => { if (item.id) item.id = restoreId(item.id); });
      }));
      group.crossScopeCandidateIds = (group.crossScopeCandidateIds || []).map(restoreId);
      if (group.crossScopeCoverage) {
        if (typeof group.crossScopeCoverage.batchId === 'string') {
          group.crossScopeCoverage.batchId = restoreId(group.crossScopeCoverage.batchId);
        }
      }
      group.proposals.forEach((proposal) => proposal.operations.forEach((operation) => {
        ['parentId', 'classId', 'destinationId', 'from', 'to'].forEach((key) => {
          if (operation[key]) operation[key] = restoreId(operation[key]);
        });
      }));
    });
    return { responseBody, result };
  }
});

// AI入出力の構成点。ID変換・応答形式・API通信をひとつの境界として公開します。
export const createAIClient = ({ editor, outputLimits, maxInputCharacters, getMaxInputCharacters, digest }) => {
  const responseFormat = createResponseFormat(outputLimits);
  const createIdCodec = () => createClassIdCodec(editor.getState().classes);
  const shortenInputIds = (input) => createIdCodec().shortenText(input);
  const responsesClient = createResponsesClient({ responseFormat, digest, shortenInputIds, createIdCodec, maxInputCharacters, getMaxInputCharacters });
  return { responseFormat, createIdCodec, shortenInputIds, responsesClient };
};

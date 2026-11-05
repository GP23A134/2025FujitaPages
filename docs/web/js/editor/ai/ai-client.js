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
  const summaryResponseSchema = {
    type: 'object', additionalProperties: false,
    properties: { m: { type: 'string' } },
    required: ['m']
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
      dataRequests: []
    };
  };
  const parseAIResponse = (response, grouped = false, summaryOnly = false) => {
    if (response.status === 'incomplete') {
      const reason = response.incomplete_details?.reason;
      if (reason === 'max_output_tokens') {
        throw new Error('AIの返答が出力上限に達して途中で終わりました。確認事項への回答は保持されています。選択範囲を小さくして、もう一度送信してください。');
      }
      throw new Error('AIの返答が完了しなかったため、変更案を読み取れませんでした。確認事項への回答は保持されています。もう一度送信してください。');
    }
    try {
      const wire = JSON.parse(readResponseText(response));
      if (summaryOnly) return { message: wire.m, proposals: [], questions: [], dataRequests: [] };
      return grouped
        ? { groups: wire.g.map((item) => ({ key: item.k, ...expandCompactResponse({ m: item.m, p: item.p, q: item.q }) })) }
        : expandCompactResponse(wire);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('AIの返答形式が不完全で、変更案を読み取れませんでした。確認事項への回答は保持されています。依頼を短くするか、選択範囲を小さくしてもう一度送信してください。');
      }
      throw error;
    }
  };

  return {
    responseSchema,
    groupedResponseSchema,
    summaryResponseSchema,
    compactResponseInstructions,
    compactGroupedResponseInstructions,
    parseAIResponse
  };
};


// Responses APIのリクエスト構築と応答の受け渡しを担当します。
// 進捗表示・使用量更新・会話状態は呼び出し側から渡します。
export const createResponsesClient = ({ responseFormat, digest, shortenInputIds, createIdCodec }) => ({
  async send(input, {
    apiKey,
    model,
    systemPrompt,
    previousResponseId = '',
    maxOutputTokens,
    stage,
    grouped = false,
    summaryOnly = false,
    promptOverride = '',
    signal,
    onStage = () => {},
    onUsage = () => {}
  }) {
    const requestPayload = JSON.parse(input);
    const requestPolicies = ['instruction', 'proposalPolicy', 'responsePolicy']
      .map((key) => typeof requestPayload[key] === 'string' ? requestPayload[key].trim() : '')
      .filter(Boolean);
    ['instruction', 'proposalPolicy', 'responsePolicy'].forEach((key) => { delete requestPayload[key]; });
    const apiInput = summaryOnly ? JSON.stringify(requestPayload) : shortenInputIds(JSON.stringify(requestPayload));
    const formatInstructions = summaryOnly
      ? 'JSON形式でmキーに統合後の返答文だけを返してください。'
      : grouped ? responseFormat.compactGroupedResponseInstructions : responseFormat.compactResponseInstructions;
    const instructions = [promptOverride || systemPrompt, formatInstructions, ...requestPolicies].join('\n\n');
    const promptCacheKey = `class-editor-ai-${(await digest(`${model}\n${instructions}`)).slice(0, 48)}`;
    const body = {
      model,
      reasoning: { effort: 'low' },
      instructions,
      input: apiInput,
      text: { format: {
        type: 'json_schema',
        name: summaryOnly ? 'class_edit_summary' : grouped ? 'class_edit_group_results' : 'class_edit_proposals',
        strict: true,
        schema: summaryOnly ? responseFormat.summaryResponseSchema
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
    onStage('結果を処理中');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const result = responseFormat.parseAIResponse(responseBody, grouped, summaryOnly);
    const restoreId = createIdCodec().restore;
    const responseGroups = grouped ? result.groups : [result];
    responseGroups.forEach((group) => {
      (group.dataRequests || []).forEach((request) => { if (request.classId) request.classId = restoreId(request.classId); });
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
export const createAIClient = ({ editor, outputLimits, digest }) => {
  const responseFormat = createResponseFormat(outputLimits);
  const createIdCodec = () => createClassIdCodec(editor.getState().classes);
  const shortenInputIds = (input) => createIdCodec().shortenText(input);
  const responsesClient = createResponsesClient({ responseFormat, digest, shortenInputIds, createIdCodec });
  return { responseFormat, createIdCodec, shortenInputIds, responsesClient };
};

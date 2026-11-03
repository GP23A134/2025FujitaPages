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

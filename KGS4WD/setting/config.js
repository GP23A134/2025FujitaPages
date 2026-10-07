/**
 * ネットワーク図レイアウト・関係性定義マスタ (config.js)
 * すべてのノード、繋がり、および柔軟な出力条件式をここで記録・管理します。
 */
const CONFIG_MASTER = {
    // 1. 全18種類のノード表記・分割設定の記録
    nodeSettings: [
        { id: "trId", label: "trId", formatNormal: "T", splitType: "none", bindVars: [], hint: "先頭の文字(接頭辞)のみ変更可能（例: T0, T1）" },
        { id: "s", label: "s", formatNormal: "s_", splitType: "triple", bindVars: ["s"] },
        { id: "sLabel", label: "sLabel", formatNormal: "", splitType: "triple", bindVars: ["sLabel"] },
        { id: "sClass", label: "sClass", formatNormal: "sc_", splitType: "none", bindVars: ["sClass"] },
        { id: "sClassLabel", label: "sClassLabel", formatNormal: "", splitType: "none", bindVars: ["sClassLabel"] },
        { id: "p", label: "p", formatNormal: "", splitType: "none", bindVars: ["p"] },
        { id: "pLabel", label: "pLabel", formatNormal: "", splitType: "none", bindVars: ["pLabel"] },
        { id: "o", label: "o", formatNormal: "o_", splitType: "triple", bindVars: ["o"] },
        { id: "oLabel", label: "oLabel", formatNormal: "", splitType: "triple", bindVars: ["oLabel"] },
        { id: "oClass", label: "oClass", formatNormal: "oc_", splitType: "none", bindVars: ["oClass"] },
        { id: "oClassLabel", label: "oClassLabel", formatNormal: "", splitType: "none", bindVars: ["oClassLabel"] },
        { id: "stakeholder", label: "stakeholder", formatNormal: "st_", splitType: "none", bindVars: ["stakeholder"] },
        { id: "stakeholderLabel", label: "stakeholderLabel", formatNormal: "", splitType: "none", bindVars: ["stakeholderLabel"] },
        { id: "stClass", label: "stClass", formatNormal: "stc_", splitType: "none", bindVars: ["stClass"] },
        { id: "stClassLabel", label: "stClassLabel", formatNormal: "", splitType: "none", bindVars: ["stClassLabel"] },
        { id: "opinion", label: "opinion", formatNormal: "op_", splitType: "none", bindVars: ["opinion"] },
        { id: "opinionContent", label: "opinionContent", formatNormal: "", splitType: "none", bindVars: ["opinionContent"] },
        { id: "evidence", label: "evidence", formatNormal: "ev_", splitType: "none", bindVars: ["evidence"] },
        { id: "g", label: "g", formatNormal: "g_", splitType: "none", bindVars: ["g"] }
    ],

    // 2. 繋がり（エッジ）の初期設定ルールの記録
    // 💡 conditionScript にJavaScriptの論理式（&&, ||, !）を自由に書くことで、複雑な連動条件を設定できます
    defaultRules: [
        { ruleName: "sLabel-oLabel", from: "sLabel", relation: "pLabel", to: "oLabel", checked: true, conditionScript: "enablePredicate" },
        { ruleName: "trId-sLabel", from: "trId", relation: "主語", to: "sLabel", checked: true, conditionScript: "enableSubject" },
        { ruleName: "trId-oLabel", from: "trId", relation: "目的語", to: "oLabel", checked: true, conditionScript: "enableObject" },
        { ruleName: "sLabel-sClassLabel", from: "sLabel", relation: "sClass", to: "sClassLabel", checked: true, conditionScript: "enableSClass" },
        { ruleName: "oLabel-oClassLabel", from: "oLabel", relation: "oClass", to: "oClassLabel", checked: true, conditionScript: "enableOClass" },
        { ruleName: "trId-opinionContent", from: "trId", relation: "意見内容", to: "opinionContent", checked: true, conditionScript: "enableStakeholder" },
        { ruleName: "opinionContent-stakeholderLabel", from: "opinionContent", relation: "発話者", to: "stakeholderLabel", checked: true, conditionScript: "enableStakeholder" },
        { ruleName: "stakeholderLabel-stClassLabel", from: "stakeholderLabel", relation: "属性分類", to: "stClassLabel", checked: true, conditionScript: "enableStakeholder && enableStClass" },
        // ご要望の複雑な条件式の例: ステークホルダーがOFF、かつstClassがONの時にトリプルと直結するルール
        { ruleName: "trId-stClassLabel", from: "trId", relation: "発話者属性(直結)", to: "stClassLabel", checked: true, conditionScript: "!enableStakeholder && enableStClass" },
        { ruleName: "trId-evidence", from: "trId", relation: "根拠", to: "evidence", checked: true, conditionScript: "enableEvidence" }
    ]
};
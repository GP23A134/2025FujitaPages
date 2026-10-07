// stateManager.js

function createStateManager(docId) {
    const isAllDoc = (docId === "ALL_DOCUMENTS");

    const getChecked = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : true;
    };
    
    const config = {
        isSubjectEnabled: getChecked("enableSubject"),
        isPredicateEnabled: getChecked("enablePredicate"),
        isObjectEnabled: getChecked("enableObject"),
        isSClassEnabled: getChecked("enableSClass"),
        oClassEnabled: getChecked("enableOClass"),
        isStakeholderEnabled: getChecked("enableStakeholder"),
        isStClassEnabled: getChecked("enableStClass"),
        isOpinionEnabled: getChecked("enableOpinion"),
        isEvidenceEnabled: getChecked("enableEvidence")
    };

    return {
        isAllDoc,
        config,
        activeFiltersMap: {},
        currentActiveTab: "",
        network: null,
        targetStatElements: {}
    };
}
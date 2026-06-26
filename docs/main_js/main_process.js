const targetIds = [
    "enableSubject", "enableObject", "enablePredicate", 
    "enableSClass", "enableOClass", "enableClassLink", 
    "enableStakeholder", "enableStClass", "enableEvidence"
];

targetIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        // 💡 ここが問題です！
        el.addEventListener('change', splitAndProcessData);
    }
});
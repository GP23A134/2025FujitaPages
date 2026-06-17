// =================================================================
//        画面上のインタラクション、UIの有効・無効制御を担当
// =================================================================

/**
 * アコーディオンメニューの開閉制御
 */
export function setupAccordion(headerId, contentId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    const icon = header.querySelector(".toggle-icon");

    header.addEventListener("click", () => {
        const isOpen = content.classList.contains("open");
        if (isOpen) {
            content.classList.remove("open");
            icon.textContent = "▼";
        } else {
            content.classList.add("open");
            icon.textContent = "▲";
        }
    });
}

/**
 * 各種要素のチェック状態に応じて、関連するカラーピッカーや設定項目の有効/無効を制御
 */
export function updateUIControls() {
    let sEnabled = document.getElementById("enableSubject").checked;
    let oEnabled = document.getElementById("enableObject").checked;
    let pEnabled = document.getElementById("enablePredicate").checked;
    let sClassEnabled = document.getElementById("enableSClass").checked;
    let oClassEnabled = document.getElementById("enableOClass").checked;
    let classLinkEnabled = document.getElementById("enableClassLink").checked;
    
    const shEnabled = document.getElementById("enableStakeholder").checked;
    const stClassEnabled = document.getElementById("enableStClass").checked;
    const evEnabled = document.getElementById("enableEvidence").checked;

    const cbPredicate = document.getElementById("enablePredicate");
    if (!sEnabled || !oEnabled) {
        cbPredicate.disabled = true;
        cbPredicate.checked = false;
        pEnabled = false;
    } else {
        cbPredicate.disabled = false;
    }

    const cbClassLink = document.getElementById("enableClassLink");
    if (!sClassEnabled || !oClassEnabled) {
        cbClassLink.disabled = true;
        cbClassLink.checked = false;
        classLinkEnabled = false;
    } else {
        cbClassLink.disabled = false;
    }

    const cbSoNum = document.getElementById("enableSubjectObjectNumbering");
    if (!sEnabled && !oEnabled) {
        cbSoNum.disabled = true;
        cbSoNum.checked = false;
    } else {
        cbSoNum.disabled = false;
    }

    const toggleElementPalette = (id, enabled) => {
        const el = document.getElementById(id);
        el.disabled = !enabled;
        el.parentElement.style.opacity = enabled ? "1.0" : "0.3";
    };

    toggleElementPalette("cpSubject", sEnabled);
    toggleElementPalette("cpObject", oEnabled);
    toggleElementPalette("cpPredicate", pEnabled);
    toggleElementPalette("cpSClass", sClassEnabled);
    toggleElementPalette("cpOClass", oClassEnabled);
    toggleElementPalette("cpSClassEdge", classLinkEnabled);

    document.getElementById("enableStakeholderNumbering").disabled = !shEnabled;
    document.getElementById("enableStClass").disabled = !shEnabled;
    document.getElementById("secShColor").style.opacity = shEnabled ? "1.0" : "0.3";
    document.getElementsByName("shColorMode").forEach(r => r.disabled = !shEnabled);

    const selectedMode = document.querySelector('input[name="shColorMode"]:checked')?.value || "random";
    const isFixed = (selectedMode === "select");
    const isRandom = (selectedMode === "random");

    toggleElementPalette("cpStakeholder", shEnabled && isFixed);
    document.getElementById("shFixedColorRow").style.opacity = (shEnabled && isFixed) ? "1.0" : "0.3";

    const stClassActive = shEnabled && stClassEnabled && (isRandom || isFixed);
    toggleElementPalette("cpStClass", stClassActive);
    document.getElementById("stClassColorRow").style.opacity = stClassActive ? "1.0" : "0.3";

    toggleElementPalette("cpEvidence", evEnabled);
    document.getElementById("secEvColor").style.opacity = evEnabled ? "1.0" : "0.3";
}

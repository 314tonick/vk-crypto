const popupDialogs_checkbox = document.getElementById("popupDialogs_checkbox");

let showDialogs = false;
chrome.runtime.sendMessage({action: "get_settings"})
    .then(response => {
        console.log(response);
        showDialogs = response.popupDialogs;
        popupDialogs_checkbox.checked = response.popupDialogs;
    },
);

popupDialogs_checkbox.onchange = () => {
    chrome.runtime.sendMessage({action: "set",
        data: {popupDialogs: popupDialogs_checkbox.checked}
    });
    console.log("changed setting");
    showDialogs = popupDialogs_checkbox.checked;
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.update(tabs[0].id, {url: tabs[0].url});
})};

function alert_there(msg) {
    try {if (showDialogs) {
        alert(msg);
    }} catch(err) {}
}

function prompt_there(msg, dflt) {
    if (showDialogs) {
        try {return prompt(msg, dflt);} catch(err) {return "";}
    }
    console.log("Error. Need some text but dialogs are turned off.");
    return "";
}

function confirm_there(msg) {
    console.log("confirm?", showDialogs);
    if (showDialogs) {
        try {return confirm(msg);} catch(err) {return true;}
    }
    return true;
}

const pub_key_label = document.getElementById("pub_key_label");
const pub_key_button = document.getElementById("pub_key_button");
const version_label = document.getElementById("version_label");
version_label.textContent = "Версия " + chrome.runtime.getManifest().version;

chrome.runtime.sendMessage({action: "get_public_rsa_key"})
    .then(response => {
        console.log("Received: ", response);
        if (response["result"] == undefined) {
            pub_key_label.textContent = "Не сгенерирован."
            pub_key_label.style.color = "red";
            pub_key_label.title = pub_key_button.title = "Вам нужно сгенерировать ключ для работы расширения."
            return;
        }
        pub_key_label.textContent = "..." + response["result"].substring(50, 70) + "...";
        pub_key_button.onclick = () => {
            navigator.clipboard.writeText(response["result"]);
        }
    },
);
